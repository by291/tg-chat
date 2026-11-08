use sqlx::PgConnection;
use uuid::Uuid;

use crate::{
    accounts::AccountError,
    messages::{
        CommandAction,
        commands::CommandContext,
        content::{MessageContent, validate_content},
        history::parse_sequence,
        service::AcceptanceError,
    },
};

const MAX_PIN_RANK: i32 = 199;
const EXPIRY_POLICIES: &[i32] = &[0, 1, 7, 30];

async fn save_draft(
    connection: &mut PgConnection,
    context: &CommandContext<'_>,
) -> Result<(), AcceptanceError> {
    let CommandAction::Draft {
        expected_version,
        content,
        reply,
    } = &context.input.action
    else {
        return Ok(());
    };
    if let Some(reply) = reply {
        crate::messages::projection::validate_reply(
            connection,
            crate::messages::projection::ReplyCheck {
                user_id: context.actor.user_id,
                conversation_id: context.conversation.id,
                reply,
            },
        )
        .await?;
    }
    let expected_version = parse_sequence(expected_version)?;
    let content = content.clone().map(validate_content).transpose()?;
    let update = sqlx::query(
        "UPDATE conversation_members SET draft_version = draft_version + 1,
         draft_content = $4, draft_reply = $5
         WHERE conversation_id = $1 AND user_id = $2 AND draft_version = $3",
    )
    .bind(context.conversation.id)
    .bind(context.actor.user_id);
    let update = update
        .bind(expected_version)
        .bind(content.map(sqlx::types::Json))
        .bind(reply.as_ref().map(sqlx::types::Json));
    if update.execute(connection).await?.rows_affected() != 1 {
        return Err(AccountError::MessageConflict.into());
    }

    Ok(())
}

async fn advance_read(
    connection: &mut PgConnection,
    context: &CommandContext<'_>,
) -> Result<(), AcceptanceError> {
    let CommandAction::Read {
        through,
    } = &context.input.action
    else {
        return Ok(());
    };
    let sequence = parse_sequence(through)?;
    let last_sequence: i64 =
        sqlx::query_scalar("SELECT last_sequence FROM conversations WHERE id = $1")
            .bind(context.conversation.id)
            .fetch_one(&mut *connection)
            .await?;
    if sequence > last_sequence {
        return Err(AccountError::Validation("read cursor exceeds conversation history").into());
    }
    let update = sqlx::query(
        "UPDATE conversation_members SET read_through = greatest(read_through, $3),
         is_manually_unread = false WHERE conversation_id = $1 AND user_id = $2",
    )
    .bind(context.conversation.id)
    .bind(context.actor.user_id)
    .bind(sequence);
    update.execute(connection).await?;

    Ok(())
}

async fn preferences(
    connection: &mut PgConnection,
    context: &CommandContext<'_>,
) -> Result<(), AcceptanceError> {
    let CommandAction::Preferences {
        is_archived,
        is_hidden,
        is_manually_unread,
        pin_rank,
        muted_until,
        keep_archived,
    } = &context.input.action
    else {
        return Ok(());
    };
    if pin_rank.is_some_and(|rank| !(0..=MAX_PIN_RANK).contains(&rank)) {
        return Err(AccountError::Validation("pin rank is outside the supported directory").into());
    }
    let update = sqlx::query(
        "UPDATE conversation_members SET is_archived = $3, is_hidden = $4,
         is_manually_unread = $5, pin_rank = $6, muted_until = $7, keep_archived = $8
         WHERE conversation_id = $1 AND user_id = $2",
    )
    .bind(context.conversation.id)
    .bind(context.actor.user_id);
    let update = update.bind(is_archived).bind(is_hidden).bind(is_manually_unread);
    let update = update.bind(pin_rank).bind(muted_until).bind(keep_archived);
    update.execute(connection).await?;

    Ok(())
}

async fn clear_history(
    connection: &mut PgConnection,
    context: &CommandContext<'_>,
) -> Result<(), AcceptanceError> {
    let is_closing = matches!(context.input.action, CommandAction::Close);
    if is_closing && context.conversation.kind == "saved" {
        return Err(AccountError::Validation("Saved cannot be closed").into());
    }
    // Generation invalidates in-flight pages even when the feed contains no individual message IDs.
    let update = sqlx::query(
        "UPDATE conversation_members member SET clear_through = conversation.last_sequence,
         read_through = greatest(member.read_through, conversation.last_sequence),
         generation = member.generation + 1, unread_count = 0, is_manually_unread = false,
         directory_active = NOT $3
         FROM conversations conversation
         WHERE conversation.id = member.conversation_id
           AND member.conversation_id = $1 AND member.user_id = $2",
    )
    .bind(context.conversation.id)
    .bind(context.actor.user_id)
    .bind(is_closing);
    update.execute(connection).await?;

    Ok(())
}

async fn change_expiry(
    connection: &mut PgConnection,
    context: &CommandContext<'_>,
) -> Result<Uuid, AcceptanceError> {
    let CommandAction::Expiry {
        days,
    } = context.input.action
    else {
        return Err(AccountError::Validation("expected an expiry policy").into());
    };
    if !EXPIRY_POLICIES.contains(&days) {
        return Err(AccountError::Validation("unsupported expiry policy").into());
    }
    let sequence: i64 = sqlx::query_scalar(
        "UPDATE conversations SET expiry_days = $2, last_sequence = last_sequence + 1,
         updated_at = now() WHERE id = $1 RETURNING last_sequence",
    )
    .bind(context.conversation.id)
    .bind(days)
    .fetch_one(&mut *connection)
    .await?;
    let message_id = Uuid::new_v4();
    let identity = sqlx::query(
        "INSERT INTO message_identities (id, author_id, conversation_id, operation_id, payload_hash)
         VALUES ($1, $2, $3, $4, $5)",
    ).bind(message_id).bind(context.actor.user_id);
    let identity = identity
        .bind(context.conversation.id)
        .bind(context.input.operation_id)
        .bind(vec![0_u8; 32]);
    identity.execute(&mut *connection).await?;
    let text = if days == 0 {
        "Automatic message deletion disabled".to_owned()
    } else {
        format!("New messages expire after {days} day(s)")
    };
    let content = MessageContent {
        schema_version: 1,
        text,
        rich_text: None,
        custom_emoji: Vec::new(),
    };
    let insert = sqlx::query(
        "INSERT INTO messages (id, conversation_id, author_id, sequence, content, service_kind)
         VALUES ($1, $2, $3, $4, $5, 'expiry_changed')",
    )
    .bind(message_id)
    .bind(context.conversation.id);
    let insert = insert.bind(context.actor.user_id).bind(sequence).bind(sqlx::types::Json(content));
    insert.execute(connection).await?;

    Ok(message_id)
}

/// Apply an account-owned state change or an authorized conversation expiry policy.
pub(crate) async fn apply(
    connection: &mut PgConnection,
    context: &CommandContext<'_>,
) -> Result<Option<Uuid>, AcceptanceError> {
    match context.input.action {
        CommandAction::Draft {
            ..
        } => save_draft(connection, context).await?,
        CommandAction::Read {
            ..
        } => advance_read(connection, context).await?,
        CommandAction::Preferences {
            ..
        } => preferences(connection, context).await?,
        CommandAction::Clear | CommandAction::Close => clear_history(connection, context).await?,
        CommandAction::Expiry {
            ..
        } => return Ok(Some(change_expiry(connection, context).await?)),
        _ => return Err(AccountError::Validation("expected a conversation action").into()),
    }

    Ok(None)
}
