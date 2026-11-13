#[allow(dead_code)]
mod support;

use serde_json::json;
use sqlx::PgPool;
use tg_chat::features::{
    accounts::{AccountService, AccountSettings, Actor},
    messages::{HistoryQuery, MessageService, SendMessage},
};
use uuid::Uuid;

async fn community(pool: &PgPool, owner: &Actor, kind: &str) -> Uuid {
    let id = Uuid::new_v4();
    let insert = sqlx::query(
        "INSERT INTO conversations (id, kind, owner_id, title) VALUES ($1, $2, $3, 'Reading club')",
    )
    .bind(id)
    .bind(kind)
    .bind(owner.user_id);
    insert.execute(pool).await.unwrap();
    let member = sqlx::query(
        "INSERT INTO conversation_members (conversation_id, user_id, role)
         VALUES ($1, $2, 'owner')",
    )
    .bind(id)
    .bind(owner.user_id);
    member.execute(pool).await.unwrap();
    id
}

fn message(conversation_id: Uuid) -> SendMessage {
    serde_json::from_value(json!({
        "operation_id": Uuid::new_v4(),
        "message_id": Uuid::new_v4(),
        "destination": {"kind": "conversation", "conversation_id": conversation_id},
        "content": {"schema_version": 1, "text": "Retained history", "custom_emoji": []}
    }))
    .unwrap()
}

#[sqlx::test]
#[ignore = "requires PostgreSQL"]
async fn group_history_requires_current_membership_and_respects_quarantine(pool: PgPool) {
    let accounts = AccountService::new(pool.clone(), AccountSettings::default());
    let owner = support::account(&accounts, "owner").await;
    let member = support::account(&accounts, "member").await;
    let service = MessageService::new(accounts);
    let id = community(&pool, &owner, "group").await;
    let sent = service.send(owner.clone(), message(id)).await.unwrap();
    assert!(service.message(member.clone(), sent.message.id).await.is_err());

    let admit =
        sqlx::query("INSERT INTO conversation_members (conversation_id, user_id) VALUES ($1, $2)")
            .bind(id)
            .bind(member.user_id);
    admit.execute(&pool).await.unwrap();
    let history = service
        .history(
            member.clone(),
            HistoryQuery {
                conversation_id: id,
                ..Default::default()
            },
        )
        .await
        .unwrap();
    assert_eq!(history.messages[0].id, sent.message.id);

    let quarantine =
        sqlx::query("UPDATE conversations SET is_quarantined = true WHERE id = $1").bind(id);
    quarantine.execute(&pool).await.unwrap();
    assert!(service.message(member.clone(), sent.message.id).await.is_err());
    assert!(service.send(owner, message(id)).await.is_err());
    let bootstrap = service.bootstrap(member).await.unwrap();
    assert!(!bootstrap.conversations.iter().any(|entry| entry.id == id));
}

#[sqlx::test]
#[ignore = "requires PostgreSQL"]
async fn channel_subscribers_read_but_cannot_publish_and_group_mutes_block_posting(pool: PgPool) {
    let accounts = AccountService::new(pool.clone(), AccountSettings::default());
    let owner = support::account(&accounts, "owner").await;
    let member = support::account(&accounts, "member").await;
    let service = MessageService::new(accounts);
    for kind in ["channel", "group"] {
        let id = community(&pool, &owner, kind).await;
        let admit = sqlx::query(
            "INSERT INTO conversation_members (conversation_id, user_id, posting_muted_until)
             VALUES ($1, $2, now() + interval '1 day')",
        )
        .bind(id)
        .bind(member.user_id);
        admit.execute(&pool).await.unwrap();
        let sent = service.send(owner.clone(), message(id)).await.unwrap();
        assert!(service.message(member.clone(), sent.message.id).await.is_ok());
        assert!(service.send(member.clone(), message(id)).await.is_err());
        let bootstrap = service.bootstrap(member.clone()).await.unwrap();
        let projection = bootstrap.conversations.iter().find(|entry| entry.id == id).unwrap();
        assert!(!projection.can_post);
        assert!(projection.posting_muted_until.is_some());
        let expire_mute = sqlx::query(
            "UPDATE conversation_members SET posting_muted_until = now() - interval '1 second'
             WHERE conversation_id = $1 AND user_id = $2",
        )
        .bind(id)
        .bind(member.user_id);
        expire_mute.execute(&pool).await.unwrap();
        let after_expiry = service.send(member.clone(), message(id)).await;
        assert_eq!(after_expiry.is_ok(), kind == "group");
        if kind == "channel" {
            assert_eq!(sent.message.author_name, "Reading club");
        }
    }
}

#[sqlx::test]
#[ignore = "requires PostgreSQL"]
async fn community_moderation_requires_a_manager_without_granting_author_edit_rights(pool: PgPool) {
    let accounts = AccountService::new(pool.clone(), AccountSettings::default());
    let owner = support::account(&accounts, "owner").await;
    let member = support::account(&accounts, "member").await;
    let service = MessageService::new(accounts);
    let id = community(&pool, &owner, "group").await;
    let admit =
        sqlx::query("INSERT INTO conversation_members (conversation_id, user_id) VALUES ($1, $2)")
            .bind(id)
            .bind(member.user_id);
    admit.execute(&pool).await.unwrap();
    let sent = service.send(member.clone(), message(id)).await.unwrap();
    let pin = support::messaging::command(
        id,
        json!({
            "kind": "pin",
            "message_id": sent.message.id,
            "is_pinned": true
        }),
    );
    assert!(service.command(member.clone(), pin.clone()).await.is_err());
    assert!(service.command(owner.clone(), pin).await.is_ok());
    let edit = support::messaging::command(
        id,
        json!({
            "kind": "edit",
            "message_id": sent.message.id,
            "expected_version": "1",
            "content": {"schema_version": 1, "text": "Impersonation", "custom_emoji": []}
        }),
    );
    assert!(service.command(owner.clone(), edit).await.is_err());
    let expiry = support::messaging::command(id, json!({"kind": "expiry", "days": 1}));
    assert!(service.command(member, expiry).await.is_err());
    let delete = support::messaging::command(
        id,
        json!({
            "kind": "delete",
            "message_id": sent.message.id
        }),
    );
    assert!(service.command(owner, delete).await.is_ok());
}

fn create_input() -> tg_chat::features::conversations::CreateCommunity {
    serde_json::from_value(json!({
        "operation_id": Uuid::new_v4(),
        "conversation_id": Uuid::new_v4(),
        "kind": "group",
        "title": "Book club",
        "description": "Discuss books",
        "public_handle": "Book_Club",
        "is_public": true,
        "requires_approval": false
    }))
    .unwrap()
}

fn community_command(
    id: Uuid,
    action: serde_json::Value,
) -> tg_chat::features::conversations::CommunityCommand {
    serde_json::from_value(json!({
        "operation_id": Uuid::new_v4(),
        "conversation_id": id,
        "action": action
    }))
    .unwrap()
}

#[sqlx::test]
#[ignore = "requires PostgreSQL"]
async fn ownership_and_bans_survive_leave_rejoin_and_stale_role_commands(pool: PgPool) {
    let accounts = AccountService::new(pool.clone(), AccountSettings::default());
    let owner = support::account(&accounts, "owner").await;
    let member = support::account(&accounts, "member").await;
    let service = MessageService::new(accounts);
    let input = create_input();
    let id = input.conversation_id;
    service.create_community(owner.clone(), input.clone()).await.unwrap();
    service.create_community(owner.clone(), input).await.unwrap();
    let join = community_command(id, json!({"kind": "join"}));
    service.community_command(member.clone(), join).await.unwrap();
    let leave = community_command(id, json!({"kind": "leave"}));
    assert!(service.community_command(owner.clone(), leave.clone()).await.is_err());
    let transfer = community_command(id, json!({"kind": "transfer", "user_id": member.user_id}));
    service.community_command(owner.clone(), transfer).await.unwrap();
    let stale_role = community_command(
        id,
        json!({
            "kind": "role",
            "user_id": member.user_id,
            "role": "member"
        }),
    );
    assert!(service.community_command(owner.clone(), stale_role).await.is_err());
    service.community_command(owner.clone(), leave.clone()).await.unwrap();
    service.community_command(owner.clone(), leave).await.unwrap();
    let ban = community_command(id, json!({"kind": "ban", "user_id": owner.user_id}));
    service.community_command(member.clone(), ban).await.unwrap();
    let join = community_command(id, json!({"kind": "join"}));
    assert!(service.community_command(owner.clone(), join.clone()).await.is_err());
    let unban = community_command(id, json!({"kind": "unban", "user_id": owner.user_id}));
    service.community_command(member, unban).await.unwrap();
    service.community_command(owner, join).await.unwrap();
}

#[sqlx::test]
#[ignore = "requires PostgreSQL"]
async fn public_handles_are_normalized_and_removed_members_receive_access_removal(pool: PgPool) {
    let accounts = AccountService::new(pool.clone(), AccountSettings::default());
    let owner = support::account(&accounts, "owner").await;
    let member = support::account(&accounts, "member").await;
    let service = MessageService::new(accounts);
    let input = create_input();
    let id = input.conversation_id;
    let created = service.create_community(owner.clone(), input).await.unwrap();
    assert_eq!(created.conversation.unwrap().public_handle.as_deref(), Some("book_club"));
    assert!(service.create_community(owner.clone(), create_input()).await.is_err());
    let join = community_command(id, json!({"kind": "join"}));
    service.community_command(member.clone(), join).await.unwrap();
    let sent = service.send(owner.clone(), message(id)).await.unwrap();
    let before = service.bootstrap(member.clone()).await.unwrap();
    let remove = community_command(id, json!({"kind": "remove", "user_id": member.user_id}));
    service.community_command(owner, remove).await.unwrap();
    assert!(service.message(member.clone(), sent.message.id).await.is_err());
    let changes = service
        .sync(
            member,
            tg_chat::features::sync::SyncQuery {
                cursor: before.cursor,
                limit: None,
            },
        )
        .await
        .unwrap();
    assert!(
        changes
            .groups
            .iter()
            .any(|group| group.conversation_id == id && group.conversation.is_none())
    );
}

#[sqlx::test]
#[ignore = "requires PostgreSQL"]
async fn membership_caps_reject_without_consuming_a_directory_slot(pool: PgPool) {
    let accounts = AccountService::new(pool.clone(), AccountSettings::default());
    let owner = support::account(&accounts, "owner").await;
    let member = support::account(&accounts, "member").await;
    let service = MessageService::new(accounts);
    for (kind, limit) in [("group", 200_i64), ("channel", 500_i64)] {
        let mut input = create_input();
        input.kind = kind.to_owned();
        input.settings.public_handle = Some(format!("{kind}_capacity"));
        let id = input.conversation_id;
        service.create_community(owner.clone(), input).await.unwrap();
        let fill = sqlx::query(
            "WITH fixtures AS (
                INSERT INTO users (id, username, password_hash, display_name)
                SELECT gen_random_uuid(), $2 || '_' || ordinal, 'fixture', 'Capacity fixture'
                FROM generate_series(1, $3) ordinal RETURNING id
             ) INSERT INTO conversation_members (conversation_id, user_id) SELECT $1, id FROM fixtures",
        )
        .bind(id)
        .bind(kind)
        .bind(limit - 1);
        fill.execute(&pool).await.unwrap();
        let join = community_command(id, json!({"kind": "join"}));
        assert!(service.community_command(member.clone(), join.clone()).await.is_err());
        let release = sqlx::query(
            "UPDATE conversation_members SET directory_active = false WHERE conversation_id = $1
             AND user_id = (SELECT user_id FROM conversation_members WHERE conversation_id = $1
                 AND role = 'member' ORDER BY user_id LIMIT 1)",
        )
        .bind(id);
        release.execute(&pool).await.unwrap();
        service.community_command(member.clone(), join).await.unwrap();
    }
}

#[sqlx::test]
#[ignore = "requires PostgreSQL"]
async fn join_and_leave_serialize_with_publication_and_preserve_personal_clear(pool: PgPool) {
    let accounts = AccountService::new(pool.clone(), AccountSettings::default());
    let owner = support::account(&accounts, "owner").await;
    let member = support::account(&accounts, "member").await;
    let service = MessageService::new(accounts);
    let input = create_input();
    let id = input.conversation_id;
    service.create_community(owner.clone(), input).await.unwrap();
    let join = community_command(id, json!({"kind": "join"}));
    let (joined, sent) = tokio::join!(
        service.community_command(member.clone(), join),
        service.send(owner.clone(), message(id)),
    );
    joined.unwrap();
    let sent = sent.unwrap();
    assert!(service.message(member.clone(), sent.message.id).await.is_ok());
    let clear = support::messaging::command(id, json!({"kind": "clear"}));
    service.command(member.clone(), clear).await.unwrap();
    let leave = community_command(id, json!({"kind": "leave"}));
    let (left, concurrent_send) = tokio::join!(
        service.community_command(member.clone(), leave),
        service.send(member.clone(), message(id)),
    );
    left.unwrap();
    if let Ok(accepted) = concurrent_send {
        assert!(service.message(member.clone(), accepted.message.id).await.is_err());
    }
    assert!(service.send(member.clone(), message(id)).await.is_err());
    let join = community_command(id, json!({"kind": "join"}));
    service.community_command(member.clone(), join).await.unwrap();
    assert!(service.message(member, sent.message.id).await.is_err());
}

#[sqlx::test]
#[ignore = "requires PostgreSQL"]
async fn full_personal_directory_rejects_creation_and_join_without_partial_state(pool: PgPool) {
    let accounts = AccountService::new(pool.clone(), AccountSettings::default());
    let owner = support::account(&accounts, "owner").await;
    let member = support::account(&accounts, "member").await;
    let service = MessageService::new(accounts);
    let input = create_input();
    let id = input.conversation_id;
    service.create_community(owner.clone(), input).await.unwrap();
    let fill = sqlx::query(
        "WITH fixtures AS (
            INSERT INTO conversations (id, kind, owner_id, title)
            SELECT gen_random_uuid(), 'group', $1, 'Directory fixture' FROM generate_series(1, 200)
            RETURNING id
         ) INSERT INTO conversation_members (conversation_id, user_id) SELECT id, $2 FROM fixtures",
    )
    .bind(owner.user_id)
    .bind(member.user_id);
    fill.execute(&pool).await.unwrap();
    let join = community_command(id, json!({"kind": "join"}));
    assert!(service.community_command(member.clone(), join).await.is_err());
    let mut input = create_input();
    input.settings.public_handle = Some("full_account".to_owned());
    let rejected_id = input.conversation_id;
    assert!(service.create_community(member, input).await.is_err());
    let exists =
        sqlx::query_scalar::<_, bool>("SELECT EXISTS (SELECT 1 FROM conversations WHERE id = $1)")
            .bind(rejected_id);
    assert!(!exists.fetch_one(&pool).await.unwrap());
}

#[sqlx::test]
#[ignore = "requires PostgreSQL"]
async fn invite_last_use_is_atomic_and_revocation_blocks_stale_approval(pool: PgPool) {
    let accounts = AccountService::new(pool, AccountSettings::default());
    let owner = support::account(&accounts, "owner").await;
    let first = support::account(&accounts, "first").await;
    let second = support::account(&accounts, "second").await;
    let service = MessageService::new(accounts);
    let mut input = create_input();
    input.settings.is_public = false;
    let id = input.conversation_id;
    service.create_community(owner.clone(), input).await.unwrap();
    let invitation_id = Uuid::new_v4();
    let token = format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple());
    let invite = community_command(
        id,
        json!({
            "kind": "invite",
            "invitation_id": invitation_id,
            "token": token,
            "expires_at": chrono::Utc::now() + chrono::Duration::days(1),
            "max_uses": 1
        }),
    );
    service.community_command(owner.clone(), invite).await.unwrap();
    let preview = service.invite_preview(first.clone(), token.clone()).await.unwrap();
    assert_eq!(preview.id, id);
    let join_first = community_command(id, json!({"kind": "join", "token": token}));
    let join_second = community_command(id, json!({"kind": "join", "token": token}));
    let (first_result, second_result) = tokio::join!(
        service.community_command(first.clone(), join_first),
        service.community_command(second.clone(), join_second),
    );
    assert_ne!(first_result.is_ok(), second_result.is_ok());
    let applicant = if first_result.is_err() {
        first
    } else {
        second
    };
    let mut settings = create_input().settings;
    settings.is_public = false;
    settings.requires_approval = true;
    let settings = community_command(
        id,
        json!({"kind": "settings", "expected_version": "1", "settings": settings}),
    );
    service.community_command(owner.clone(), settings).await.unwrap();
    let invitation_id = Uuid::new_v4();
    let token = format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple());
    let invite = community_command(
        id,
        json!({
            "kind": "invite",
            "invitation_id": invitation_id,
            "token": token,
            "expires_at": chrono::Utc::now() + chrono::Duration::days(1),
            "max_uses": 1
        }),
    );
    service.community_command(owner.clone(), invite).await.unwrap();
    let request = community_command(id, json!({"kind": "join", "token": token}));
    let pending = service.community_command(applicant.clone(), request).await.unwrap();
    assert!(pending.conversation.is_none());
    let revoke =
        community_command(id, json!({"kind": "revoke_invite", "invitation_id": invitation_id}));
    service.community_command(owner.clone(), revoke).await.unwrap();
    let approve = community_command(id, json!({"kind": "approve", "user_id": applicant.user_id}));
    assert!(service.community_command(owner, approve).await.is_err());
}

#[sqlx::test]
#[ignore = "requires PostgreSQL"]
async fn discovery_and_subscriber_lists_obey_privacy_and_public_request_invalidation(pool: PgPool) {
    let accounts = AccountService::new(pool, AccountSettings::default());
    let owner = support::account(&accounts, "owner").await;
    let member = support::account(&accounts, "member").await;
    let outsider = support::account(&accounts, "outsider").await;
    let service = MessageService::new(accounts);
    let mut input = create_input();
    input.kind = "channel".to_owned();
    let id = input.conversation_id;
    service.create_community(owner.clone(), input).await.unwrap();
    let join = community_command(id, json!({"kind": "join"}));
    service.community_command(member.clone(), join).await.unwrap();
    let visible = service
        .community_members(
            member.clone(),
            tg_chat::features::conversations::CommunityPageQuery::new(id),
        )
        .await
        .unwrap();
    assert_eq!(visible.items.len(), 1);
    let details = service.community_details(member.clone(), id).await.unwrap();
    assert_eq!(details.member_count.as_deref(), Some("2"));
    assert!(
        service
            .community_members(
                outsider.clone(),
                tg_chat::features::conversations::CommunityPageQuery::new(id)
            )
            .await
            .is_err()
    );
    let search = tg_chat::features::conversations::CommunityDiscoveryQuery {
        search: Some("@book_club".to_owned()),
        kind: Some(tg_chat::features::conversations::CommunityDiscoveryKind::Channel),
        ..Default::default()
    };
    let found = service.discover_communities(outsider.clone(), search).await.unwrap();
    assert_eq!(found.items.len(), 1);
    assert_eq!(found.items[0].member_count, "2");
    assert!(!found.items[0].has_pending_request);
    let groups = tg_chat::features::conversations::CommunityDiscoveryQuery {
        kind: Some(tg_chat::features::conversations::CommunityDiscoveryKind::Group),
        ..Default::default()
    };
    let found = service.discover_communities(outsider.clone(), groups).await.unwrap();
    assert!(found.items.is_empty());
    let mut settings = create_input().settings;
    settings.requires_approval = true;
    let configure = community_command(
        id,
        json!({"kind": "settings", "expected_version": "1", "settings": settings}),
    );
    service.community_command(owner.clone(), configure).await.unwrap();
    let request = community_command(id, json!({"kind": "join"}));
    service.community_command(outsider.clone(), request).await.unwrap();
    let pending = service.discover_communities(outsider.clone(), Default::default()).await.unwrap();
    assert!(pending.items[0].has_pending_request);
    let other_view = service.discover_communities(member, Default::default()).await.unwrap();
    assert!(!other_view.items[0].has_pending_request);
    settings.is_public = false;
    let configure = community_command(
        id,
        json!({"kind": "settings", "expected_version": "2", "settings": settings}),
    );
    service.community_command(owner.clone(), configure).await.unwrap();
    let found = service.discover_communities(outsider, Default::default()).await.unwrap();
    assert!(found.items.is_empty());
    let requests = service
        .community_requests(owner, tg_chat::features::conversations::CommunityPageQuery::new(id))
        .await
        .unwrap();
    assert!(requests.items.is_empty());
}

#[sqlx::test]
#[ignore = "requires PostgreSQL"]
async fn targeted_invitations_require_acceptance_and_expired_links_cannot_be_used(pool: PgPool) {
    let accounts = AccountService::new(pool.clone(), AccountSettings::default());
    let owner = support::account(&accounts, "owner").await;
    let target = support::account(&accounts, "target").await;
    let outsider = support::account(&accounts, "outsider").await;
    let service = MessageService::new(accounts);
    let mut input = create_input();
    input.settings.is_public = false;
    let id = input.conversation_id;
    service.create_community(owner.clone(), input).await.unwrap();
    let invitation_id = Uuid::new_v4();
    let invite = community_command(
        id,
        json!({
            "kind": "invite",
            "invitation_id": invitation_id,
            "target_id": target.user_id,
            "expires_at": chrono::Utc::now() + chrono::Duration::days(1)
        }),
    );
    service.community_command(owner.clone(), invite).await.unwrap();
    assert!(service.community_details(target.clone(), id).await.is_err());
    let join = community_command(id, json!({"kind": "join", "invitation_id": invitation_id}));
    assert!(service.community_command(outsider.clone(), join.clone()).await.is_err());
    service.community_command(target.clone(), join).await.unwrap();
    let details = service.community_details(target, id).await.unwrap();
    assert_eq!(details.role, "member");

    let invitation_id = Uuid::new_v4();
    let token = format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple());
    let invite = community_command(
        id,
        json!({
            "kind": "invite",
            "invitation_id": invitation_id,
            "token": token,
            "expires_at": chrono::Utc::now() + chrono::Duration::days(1)
        }),
    );
    service.community_command(owner, invite).await.unwrap();
    let without_secret =
        community_command(id, json!({"kind": "join", "invitation_id": invitation_id}));
    assert!(service.community_command(outsider.clone(), without_secret).await.is_err());
    let expire = sqlx::query(
        "UPDATE community_invitations SET expires_at = now() - interval '1 second' WHERE id = $1",
    )
    .bind(invitation_id);
    expire.execute(&pool).await.unwrap();
    assert!(service.invite_preview(outsider.clone(), token.clone()).await.is_err());
    let join = community_command(id, json!({"kind": "join", "token": token}));
    assert!(service.community_command(outsider, join).await.is_err());
}

#[sqlx::test]
#[ignore = "requires PostgreSQL"]
async fn stale_settings_cannot_overwrite_newer_privacy_or_metadata(pool: PgPool) {
    let accounts = AccountService::new(pool, AccountSettings::default());
    let owner = support::account(&accounts, "owner").await;
    let service = MessageService::new(accounts);
    let input = create_input();
    let id = input.conversation_id;
    service.create_community(owner.clone(), input).await.unwrap();
    let mut settings = create_input().settings;
    settings.is_public = false;
    let first = community_command(
        id,
        json!({
            "kind": "settings",
            "expected_version": "1",
            "settings": settings
        }),
    );
    service.community_command(owner.clone(), first).await.unwrap();
    settings.is_public = true;
    settings.title = "Stale title".to_owned();
    let stale = community_command(
        id,
        json!({
            "kind": "settings",
            "expected_version": "1",
            "settings": settings
        }),
    );
    assert!(service.community_command(owner.clone(), stale).await.is_err());
    let current = service.community_details(owner, id).await.unwrap();
    assert!(!current.is_public);
    assert_eq!(current.title, "Book club");
}

#[sqlx::test]
#[ignore = "requires PostgreSQL"]
async fn demoting_channel_admin_invalidates_history_with_completion_attribution(pool: PgPool) {
    let accounts = AccountService::new(pool.clone(), AccountSettings::default());
    let owner = support::account(&accounts, "owner").await;
    let admin = support::account(&accounts, "moderator").await;
    let service = MessageService::new(accounts);
    let channel_id = community(&pool, &owner, "channel").await;
    let admit = sqlx::query(
        "INSERT INTO conversation_members (conversation_id, user_id, role)
         VALUES ($1, $2, 'admin')",
    );
    admit.bind(channel_id).bind(admin.user_id).execute(&pool).await.unwrap();

    let task_id = Uuid::new_v4();
    let mut input = message(channel_id);
    input.body = Some(
        serde_json::from_value(json!({
            "kind": "checklist",
            "title": "Opening tasks",
            "tasks": [{"id": task_id, "text": "Open the doors"}],
        }))
        .unwrap(),
    );
    let sent = service.send(owner.clone(), input).await.unwrap();
    let complete = support::messaging::command(
        channel_id,
        json!({
            "kind": "set_checklist_task",
            "message_id": sent.message.id,
            "task_id": task_id,
            "expected_task_version": "1",
            "is_complete": true,
        }),
    );
    service.command(owner.clone(), complete).await.unwrap();

    let history_query = || HistoryQuery {
        conversation_id: channel_id,
        ..Default::default()
    };
    let before = service.history(admin.clone(), history_query()).await.unwrap();
    let before_message = serde_json::to_value(&before.messages[0]).unwrap();
    let completer = &before_message["body"]["tasks"][0]["completed_by"]["user_id"];
    assert_eq!(completer, &json!(owner.user_id));

    let demote = community_command(
        channel_id,
        json!({"kind": "role", "user_id": admin.user_id, "role": "member"}),
    );
    service.community_command(owner, demote).await.unwrap();
    let after = service.history(admin.clone(), history_query()).await.unwrap();
    let after_message = serde_json::to_value(&after.messages[0]).unwrap();
    let task = &after_message["body"]["tasks"][0];
    assert_eq!(task["is_complete"], true);
    assert!(task.get("completed_by").is_none());
    assert_ne!(before.generation, after.generation);

    let changes = service
        .sync(
            admin,
            tg_chat::features::sync::SyncQuery {
                cursor: before.observation_cursor,
                limit: None,
            },
        )
        .await
        .unwrap();
    let notification = changes.groups.iter().find_map(|group| group.conversation.as_ref());
    assert_eq!(notification.unwrap().generation, after.generation);
}

#[sqlx::test]
#[ignore = "requires PostgreSQL"]
async fn transferring_channel_to_subscriber_invalidates_the_new_owners_history(pool: PgPool) {
    let accounts = AccountService::new(pool.clone(), AccountSettings::default());
    let owner = support::account(&accounts, "owner").await;
    let subscriber = support::account(&accounts, "subscriber").await;
    let service = MessageService::new(accounts);
    let channel_id = community(&pool, &owner, "channel").await;
    let admit =
        sqlx::query("INSERT INTO conversation_members (conversation_id, user_id) VALUES ($1, $2)");
    admit.bind(channel_id).bind(subscriber.user_id).execute(&pool).await.unwrap();

    let history_query = || HistoryQuery {
        conversation_id: channel_id,
        ..Default::default()
    };
    let subscriber_before = service.history(subscriber.clone(), history_query()).await.unwrap();
    let owner_before = service.history(owner.clone(), history_query()).await.unwrap();
    let transfer =
        community_command(channel_id, json!({"kind": "transfer", "user_id": subscriber.user_id}));
    service.community_command(owner.clone(), transfer).await.unwrap();

    let subscriber_after = service.history(subscriber, history_query()).await.unwrap();
    let owner_after = service.history(owner, history_query()).await.unwrap();
    assert_ne!(subscriber_before.generation, subscriber_after.generation);
    assert_eq!(owner_before.generation, owner_after.generation);
}
