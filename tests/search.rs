#[allow(dead_code)]
mod support;

use chrono::{Days, Utc};
use serde_json::json;
use sqlx::PgPool;
use support::messaging::{command, fixture, send_input};
use tg_chat::{
    accounts::{AccountError, Actor},
    messages::{
        HistoryQuery, MessageKind, MessageService, SearchQuery, SendReceipt,
        bodies::MessageBodyInput,
    },
};
use uuid::Uuid;

struct SendText<'a> {
    actor: Actor,
    recipient: Uuid,
    text: &'a str,
}

async fn send_text(service: &MessageService, message: SendText<'_>) -> SendReceipt {
    let mut input = send_input(message.recipient);
    input.content.text = message.text.to_owned();
    service.send(message.actor, input).await.unwrap()
}

#[sqlx::test]
#[ignore = "requires PostgreSQL"]
async fn chinese_and_english_queries_match_literal_substrings(pool: PgPool) {
    let (service, alice, bobby) = fixture(pool).await;
    let matching = send_text(
        &service,
        SendText {
            actor: alice.clone(),
            recipient: bobby.user_id,
            text: r"简体中文 Mixed CASE 100%_\ example",
        },
    )
    .await;
    send_text(
        &service,
        SendText {
            actor: alice,
            recipient: bobby.user_id,
            text: r"100XYZ\ example",
        },
    )
    .await;

    for (query, expected_behavior) in [
        ("体中文", "Chinese substring"),
        ("xed case", "case-insensitive English substring"),
        (r"%_\", "literal SQL pattern metacharacters"),
    ] {
        let page = service
            .search(
                bobby.clone(),
                SearchQuery {
                    query: query.to_owned(),
                    ..Default::default()
                },
            )
            .await
            .unwrap();
        assert_eq!(page.hits.len(), 1, "{expected_behavior}");
        assert_eq!(page.hits[0].id, matching.message.id);
    }
}

#[sqlx::test]
#[ignore = "requires PostgreSQL"]
async fn short_queries_are_bounded_without_leaking_hidden_rows(pool: PgPool) {
    let (service, alice, bobby) = fixture(pool.clone()).await;
    let matching = send_text(
        &service,
        SendText {
            actor: alice.clone(),
            recipient: bobby.user_id,
            text: "甲乙",
        },
    )
    .await;
    let conversation_id = matching.conversation.id;
    let hidden = send_text(
        &service,
        SendText {
            actor: alice.clone(),
            recipient: bobby.user_id,
            text: "甲丙",
        },
    )
    .await;
    service
        .command(
            bobby.clone(),
            command(
                conversation_id,
                json!({"kind": "hide_message", "message_id": hidden.message.id}),
            ),
        )
        .await
        .unwrap();

    let query = SearchQuery {
        query: "甲".to_owned(),
        date_from: Utc::now().checked_sub_days(Days::new(60)),
        conversation_id: Some(conversation_id),
        ..Default::default()
    };
    let page = service.search(bobby.clone(), query.clone()).await.unwrap();
    assert_eq!(page.hits.len(), 1);
    assert_eq!(page.hits[0].id, matching.message.id);
    assert_eq!(page.date_to.unwrap() - page.date_from.unwrap(), chrono::TimeDelta::days(30));
    assert!(!page.is_truncated);
    assert!(matches!(
        service
            .search(
                bobby.clone(),
                SearchQuery {
                    conversation_id: None,
                    ..query.clone()
                },
            )
            .await,
        Err(AccountError::Validation(_))
    ));

    // Dense recent traffic must exhaust the bounded scan even when no recent row matches.
    let insert = sqlx::query(
        r#"WITH recent AS (
            SELECT gen_random_uuid() AS id, sequence
            FROM generate_series(3, 5002) AS sequence
         ), identities AS (
            INSERT INTO message_identities (id, author_id, conversation_id, operation_id,
                                            payload_hash)
            SELECT id, $1, $2, gen_random_uuid(), decode(repeat('00', 32), 'hex') FROM recent
         )
         INSERT INTO messages (id, conversation_id, author_id, sequence, content)
         SELECT id, $2, $1, sequence, '{"schema_version":1,"text":"Other","custom_emoji":[]}'
         FROM recent"#,
    )
    .bind(alice.user_id)
    .bind(conversation_id);
    insert.execute(&pool).await.unwrap();

    let page = service.search(bobby, query).await.unwrap();
    assert!(page.is_truncated);
    assert!(page.hits.is_empty());
    assert!(page.next_cursor.is_none());
}

#[sqlx::test]
#[ignore = "requires PostgreSQL"]
async fn tied_timestamps_page_without_duplicates_or_cross_filter_cursors(pool: PgPool) {
    let (service, alice, bobby) = fixture(pool.clone()).await;
    let input = || SendText {
        actor: alice.clone(),
        recipient: bobby.user_id,
        text: "Pagination match",
    };
    let first = send_text(&service, input()).await;
    let second = send_text(&service, input()).await;
    let tie = sqlx::query("UPDATE messages SET created_at = $1 WHERE conversation_id = $2")
        .bind(first.message.created_at)
        .bind(first.conversation.id);
    tie.execute(&pool).await.unwrap();

    let mut query = SearchQuery {
        query: "pagination".to_owned(),
        limit: Some(1),
        ..Default::default()
    };
    let page = service.search(bobby.clone(), query.clone()).await.unwrap();
    assert_eq!(page.hits[0].id, first.message.id.max(second.message.id));
    query.cursor = page.next_cursor;

    let page = service.search(bobby.clone(), query.clone()).await.unwrap();
    assert_eq!(page.hits[0].id, first.message.id.min(second.message.id));
    assert!(page.next_cursor.is_none());

    query.sender_id = Some(alice.user_id);
    assert!(matches!(service.search(bobby, query).await, Err(AccountError::Validation(_))));
}

#[sqlx::test]
#[ignore = "requires PostgreSQL"]
async fn revoked_search_hits_cannot_be_opened(pool: PgPool) {
    let (service, alice, bobby) = fixture(pool.clone()).await;
    let sent = send_text(
        &service,
        SendText {
            actor: alice,
            recipient: bobby.user_id,
            text: "Previously accessible",
        },
    )
    .await;
    let query = SearchQuery {
        query: "accessible".to_owned(),
        ..Default::default()
    };
    let page = service.search(bobby.clone(), query.clone()).await.unwrap();
    assert_eq!(page.hits[0].id, sent.message.id);

    let revoke = sqlx::query(
        "UPDATE conversation_members SET directory_active = false
         WHERE conversation_id = $1 AND user_id = $2",
    )
    .bind(sent.conversation.id)
    .bind(bobby.user_id);
    revoke.execute(&pool).await.unwrap();

    let page = service.search(bobby.clone(), query).await.unwrap();
    assert!(page.hits.is_empty());
    assert!(matches!(service.message(bobby, sent.message.id).await, Err(AccountError::NotFound)));
}

#[sqlx::test]
#[ignore = "requires PostgreSQL"]
async fn search_excludes_contact_details_but_finds_the_caption(pool: PgPool) {
    let (service, alice, bobby) = fixture(pool).await;
    let mut contact = send_input(bobby.user_id);
    contact.content.text = "Personal recommendation".to_owned();
    contact.body = Some(MessageBodyInput::Contact {
        display_name: "Private name".to_owned(),
        account_id: None,
        phone: Some("5557391".to_owned()),
    });
    let sent = service.send(alice, contact).await.unwrap();

    for text in ["Private name", "5557391"] {
        let page = service
            .search(
                bobby.clone(),
                SearchQuery {
                    query: text.to_owned(),
                    ..Default::default()
                },
            )
            .await
            .unwrap();
        assert!(page.hits.is_empty());
    }

    let page = service
        .search(
            bobby,
            SearchQuery {
                query: "recommendation".to_owned(),
                kind: Some(MessageKind::Contact),
                ..Default::default()
            },
        )
        .await
        .unwrap();
    assert_eq!(page.hits.len(), 1);
    assert_eq!(page.hits[0].id, sent.message.id);
}

#[sqlx::test]
#[ignore = "requires PostgreSQL"]
async fn empty_link_search_browses_only_links_in_the_selected_chat(pool: PgPool) {
    let (service, alice, bobby) = fixture(pool).await;
    let mut rich_link = send_input(bobby.user_id);
    rich_link.content.text = "Visit the site".to_owned();
    rich_link.content.rich_text =
        Some(r#"<p><a href="https://example.com/path">Visit the site</a></p>"#.to_owned());
    let rich = service.send(alice.clone(), rich_link).await.unwrap();
    let plain = send_text(
        &service,
        SendText {
            actor: alice.clone(),
            recipient: bobby.user_id,
            text: "More at https://example.com/other",
        },
    )
    .await;
    send_text(
        &service,
        SendText {
            actor: alice,
            recipient: bobby.user_id,
            text: "Unrelated text",
        },
    )
    .await;

    let page = service
        .search(
            bobby,
            SearchQuery {
                conversation_id: Some(rich.conversation.id),
                kind: Some(MessageKind::Link),
                ..Default::default()
            },
        )
        .await
        .unwrap();
    let matches: Vec<_> = page.hits.iter().map(|message| message.id).collect();
    assert_eq!(matches, vec![plain.message.id, rich.message.id]);
}

#[sqlx::test]
#[ignore = "requires PostgreSQL"]
async fn media_filter_uses_attachment_kind_and_preserves_caption_matches(pool: PgPool) {
    let (service, alice, bobby) = fixture(pool.clone()).await;
    let photo = send_text(
        &service,
        SendText {
            actor: alice.clone(),
            recipient: bobby.user_id,
            text: "Shared trip album",
        },
    )
    .await;
    send_text(
        &service,
        SendText {
            actor: alice.clone(),
            recipient: bobby.user_id,
            text: "Trip directions",
        },
    )
    .await;

    // Search needs canonical attachment references, without transferring fixture bytes to S3.
    let attach = sqlx::query(
        "WITH upload AS (
            INSERT INTO media_uploads (
                id, owner_id, session_id, purpose, file_name, size_bytes, sha256, state, expires_at
            )
            VALUES (
                gen_random_uuid(), $1, $2, 'image', 'trip.jpg', 1, repeat('a', 64), 'ready', now()
            )
            RETURNING id
         ), attempt AS (
            INSERT INTO media_processing_attempts (id, upload_id)
            SELECT gen_random_uuid(), id FROM upload RETURNING id, upload_id
         ), file AS (
            INSERT INTO media_files (id, upload_id, size_bytes, width, height, ready_until)
            SELECT id, upload_id, 1, 1, 1, now() FROM attempt RETURNING id
         )
         INSERT INTO media_message_references (message_id, occurrence_id, file_id, position)
         SELECT $3, gen_random_uuid(), id, 1 FROM file",
    )
    .bind(alice.user_id)
    .bind(alice.session_id)
    .bind(photo.message.id);
    attach.execute(&pool).await.unwrap();

    let query = SearchQuery {
        conversation_id: Some(photo.conversation.id),
        query: "trip".to_owned(),
        kind: Some(MessageKind::PhotoVideo),
        ..Default::default()
    };
    let page = service.search(bobby.clone(), query.clone()).await.unwrap();
    assert_eq!(page.hits.len(), 1);
    assert_eq!(page.hits[0].id, photo.message.id);
    assert_eq!(page.hits[0].attachments.len(), 1);

    let documents = SearchQuery {
        kind: Some(MessageKind::File),
        ..query
    };
    let page = service.search(bobby, documents).await.unwrap();
    assert!(page.hits.is_empty());
}

#[sqlx::test]
#[ignore = "requires PostgreSQL"]
async fn date_anchor_skips_expired_messages_and_falls_back_to_earlier_history(pool: PgPool) {
    let (service, alice, bobby) = fixture(pool.clone()).await;
    let outgoing = |text| SendText {
        actor: alice.clone(),
        recipient: bobby.user_id,
        text,
    };
    let earlier = send_text(&service, outgoing("Earlier message")).await;
    let expired = send_text(&service, outgoing("Expired message")).await;
    let later = send_text(&service, outgoing("Later message")).await;
    let expire = sqlx::query("UPDATE messages SET expires_at = now() WHERE id = $1")
        .bind(expired.message.id);
    expire.execute(&pool).await.unwrap();

    let query = HistoryQuery {
        conversation_id: earlier.conversation.id,
        date_at: Some(expired.message.created_at),
        ..Default::default()
    };
    let page = service.history(bobby.clone(), query).await.unwrap();
    assert_eq!(page.anchor_id, Some(later.message.id));
    let ids: Vec<_> = page.messages.iter().map(|message| message.id).collect();
    assert_eq!(ids, vec![earlier.message.id, later.message.id]);

    let query = HistoryQuery {
        conversation_id: earlier.conversation.id,
        date_at: Some(Utc::now()),
        ..Default::default()
    };
    let page = service.history(bobby, query).await.unwrap();
    assert_eq!(page.anchor_id, Some(later.message.id));
}

#[sqlx::test]
#[ignore = "requires PostgreSQL"]
async fn filtered_history_applies_kind_and_pin_visibility_to_both_edges(pool: PgPool) {
    let (service, alice, bobby) = fixture(pool).await;
    let outgoing = |text| SendText {
        actor: alice.clone(),
        recipient: bobby.user_id,
        text,
    };
    let older = send_text(&service, outgoing("https://example.com/older")).await;
    let newer = send_text(&service, outgoing("https://example.com/newer")).await;
    let unrelated = send_text(&service, outgoing("Pinned without a link")).await;
    send_text(&service, outgoing("https://example.com/unpinned")).await;
    for (message_id, is_pinned) in
        [(older.message.id, true), (newer.message.id, true), (unrelated.message.id, true)]
    {
        let pin = command(
            older.conversation.id,
            json!({"kind": "pin", "message_id": message_id, "is_pinned": is_pinned}),
        );
        service.command(alice.clone(), pin).await.unwrap();
    }

    let query = HistoryQuery {
        conversation_id: older.conversation.id,
        limit: Some(1),
        pinned: Some(true),
        kind: Some(MessageKind::Link),
        ..Default::default()
    };
    let page = service.history(bobby.clone(), query).await.unwrap();
    assert_eq!(page.messages[0].id, newer.message.id);
    assert_eq!(page.preceding_message.unwrap().id, older.message.id);
    assert!(page.has_older);
    assert!(!page.has_newer);

    let missing = HistoryQuery {
        conversation_id: older.conversation.id,
        around: Some(unrelated.message.id),
        kind: Some(MessageKind::Link),
        ..Default::default()
    };
    assert!(matches!(service.history(bobby, missing).await, Err(AccountError::NotFound)));
}

#[sqlx::test]
#[ignore = "requires PostgreSQL"]
async fn canonical_equivalents_share_the_short_search_budget(pool: PgPool) {
    let (service, alice, bobby) = fixture(pool).await;
    let sent = send_text(
        &service,
        SendText {
            actor: alice,
            recipient: bobby.user_id,
            text: "각 문자",
        },
    )
    .await;

    // The three jamo compose to one Hangul syllable before the indexed substring match.
    let decomposed = "\u{1100}\u{1161}\u{11a8}";
    let query = SearchQuery {
        query: decomposed.to_owned(),
        ..Default::default()
    };
    assert!(matches!(
        service.search(bobby.clone(), query.clone()).await,
        Err(AccountError::Validation(_))
    ));

    let scoped = SearchQuery {
        conversation_id: Some(sent.conversation.id),
        ..query
    };
    let page = service.search(bobby, scoped).await.unwrap();
    assert_eq!(page.hits[0].id, sent.message.id);
    assert!(page.date_from.is_some());
    assert!(page.date_to.is_some());
}
