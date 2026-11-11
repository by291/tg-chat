#[allow(dead_code)]
mod support;

use serde_json::json;
use sqlx::PgPool;
use tg_chat::{
    accounts::{AccountError, AccountService, AccountSettings, Actor},
    media::{MediaLimits, ReserveUpload, UploadPurpose, UploadReservations},
    messages::{HistoryQuery, MessageService},
};
use uuid::Uuid;

async fn operator(accounts: &AccountService, pool: &PgPool) -> Actor {
    let actor = support::account(accounts, "platform_operator").await;
    let privilege = sqlx::query("UPDATE users SET is_operator = true WHERE id = $1");
    privilege.bind(actor.user_id).execute(pool).await.unwrap();

    actor
}

#[sqlx::test]
#[ignore = "requires PostgreSQL"]
async fn restoration_invalidates_a_page_that_missed_quarantine(pool: PgPool) {
    let accounts = AccountService::new(pool.clone(), AccountSettings::default());
    let sender = support::account(&accounts, "quarantine_sender").await;
    let reader = support::account(&accounts, "quarantine_reader").await;
    let operator = operator(&accounts, &pool).await;

    let service = MessageService::new(accounts.clone());
    let input = support::messaging::send_input(reader.user_id);
    let sent = service.send(sender, input).await.unwrap();
    let direct_target = serde_json::from_value(json!({
        "operation_id": Uuid::new_v4(),
        "reason": "Attempt direct quarantine without case review",
        "action": {
            "kind": "set_quarantine",
            "target": {"kind": "community", "conversation_id": sent.conversation.id},
            "is_quarantined": true,
        },
    }))
    .unwrap();
    let denied = accounts.submit_operator_command(&operator, direct_target).await;
    assert!(matches!(denied, Err(AccountError::NotFound)));

    let report = serde_json::from_value(json!({
        "operation_id": Uuid::new_v4(),
        "reason": "spam",
    }))
    .unwrap();
    let case = accounts.report_message(reader.clone(), sent.message.id, report).await.unwrap();
    let history = || HistoryQuery {
        conversation_id: sent.conversation.id,
        ..Default::default()
    };
    let before = service.history(reader.clone(), history()).await.unwrap();

    for is_quarantined in [true, false] {
        let command = serde_json::from_value(json!({
            "operation_id": Uuid::new_v4(),
            "reason": "Review a reported conversation",
            "action": {
                "kind": "set_quarantine",
                "target": {"kind": "case", "case_id": case.case_id},
                "is_quarantined": is_quarantined,
            },
        }))
        .expect("decode an operator quarantine command");
        accounts.submit_operator_command(&operator, command).await.unwrap();

        if is_quarantined {
            let hidden = service.message(reader.clone(), sent.message.id).await;
            assert!(matches!(hidden, Err(AccountError::NotFound)));
        }
    }

    let restored = service.history(reader, history()).await.unwrap();
    assert_ne!(restored.generation, before.generation);
    assert_eq!(restored.messages[0].id, sent.message.id);
}

#[sqlx::test]
#[ignore = "requires PostgreSQL"]
async fn quota_and_job_actions_apply_to_new_work_and_replay_once(pool: PgPool) {
    let accounts = AccountService::new(pool.clone(), AccountSettings::default());
    let member = support::account(&accounts, "budget_member").await;
    let operator = operator(&accounts, &pool).await;

    let limit = serde_json::from_value(json!({
        "operation_id": Uuid::new_v4(),
        "reason": "Limit the account's test storage",
        "action": {
            "kind": "set_account_storage_limit",
            "user_id": member.user_id,
            "limit_bytes": "1024",
        },
    }))
    .unwrap();
    let reserves = UploadReservations::new(accounts.clone(), MediaLimits::default());
    let upload = ReserveUpload {
        upload_id: Uuid::new_v4(),
        purpose: UploadPurpose::Document,
        file_name: "over-limit.txt".to_owned(),
        size_bytes: 1025,
        sha256: "00".repeat(32),
    };
    let reservation = reserves.reserve(&member, upload.clone());
    let update = accounts.submit_operator_command(&operator, limit);
    let (reserved, updated) = tokio::join!(reservation, update);
    updated.unwrap();
    match reserved {
        Ok(_) => {
            // A reservation that wins the race remains valid under the new ceiling.
            reserves.status(&member, upload.upload_id).await.unwrap();
        }
        Err(error) => assert!(matches!(error, AccountError::QuotaExceeded)),
    }
    let next_upload = ReserveUpload {
        upload_id: Uuid::new_v4(),
        ..upload
    };
    let denied = reserves.reserve(&member, next_upload).await;
    assert!(matches!(denied, Err(AccountError::QuotaExceeded)));

    let exhaust = sqlx::query(
        "INSERT INTO sync_wakeups (user_id, position, status, attempts, last_error)
         VALUES ($1, 1, 'exhausted', 4, 'delivery_failed')",
    );
    exhaust.bind(member.user_id).execute(&pool).await.unwrap();
    let retry = json!({
        "operation_id": Uuid::new_v4(),
        "reason": "Retry after realtime recovery",
        "action": {
            "kind": "retry_job",
            "job_kind": "sync_wakeup",
            "job_id": member.user_id,
        },
    });
    for _ in 0..2 {
        let command = serde_json::from_value(retry.clone()).unwrap();
        accounts.submit_operator_command(&operator, command).await.unwrap();
    }

    let status = sqlx::query_scalar::<_, String>("SELECT status FROM sync_wakeups");
    assert_eq!(status.fetch_one(&pool).await.unwrap(), "pending");
    let audit = sqlx::query_scalar::<_, i64>(
        "SELECT count(*) FROM operator_audit WHERE action = 'exhausted_job_retried'",
    );
    assert_eq!(audit.fetch_one(&pool).await.unwrap(), 1);
}

#[sqlx::test]
#[ignore = "requires PostgreSQL"]
async fn evidence_extension_audits_both_deadlines_once_on_replay(pool: PgPool) {
    let accounts = AccountService::new(pool.clone(), AccountSettings::default());
    let sender = support::account(&accounts, "extension_sender").await;
    let reader = support::account(&accounts, "extension_reader").await;
    let operator = operator(&accounts, &pool).await;

    let service = MessageService::new(accounts.clone());
    let input = support::messaging::send_input(reader.user_id);
    let sent = service.send(sender, input).await.unwrap();
    let report = serde_json::from_value(json!({
        "operation_id": Uuid::new_v4(),
        "reason": "spam",
    }))
    .unwrap();
    let case = accounts.report_message(reader, sent.message.id, report).await.unwrap();

    let previous: chrono::DateTime<chrono::Utc> = sqlx::query_scalar(
        "UPDATE moderation_cases SET evidence_expires_at = now() + interval '1 day'
         WHERE id = $1 RETURNING evidence_expires_at",
    )
    .bind(case.case_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    let deadline = previous + chrono::TimeDelta::days(1);
    let payload = json!({
        "operation_id": Uuid::new_v4(),
        "reason": "More time to review the report",
        "action": {
            "kind": "extend_evidence",
            "case_id": case.case_id,
            "deadline": deadline,
        },
    });
    for _ in 0..2 {
        let command = serde_json::from_value(payload.clone()).unwrap();
        accounts.submit_operator_command(&operator, command).await.unwrap();
    }

    let audit = sqlx::query_scalar::<_, serde_json::Value>(
        "SELECT details FROM operator_audit WHERE target_id = $1 AND action = 'evidence_extended'",
    );
    let audit = audit.bind(case.case_id).fetch_all(&pool).await.unwrap();
    assert_eq!(
        audit,
        vec![json!({
            "previous_deadline": previous,
            "new_deadline": deadline,
        })],
    );
}
