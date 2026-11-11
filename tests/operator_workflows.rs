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
    accounts.submit_operator_command(&operator, limit).await.unwrap();

    let reserves = UploadReservations::new(accounts.clone(), MediaLimits::default());
    let upload = ReserveUpload {
        upload_id: Uuid::new_v4(),
        purpose: UploadPurpose::Document,
        file_name: "over-limit.txt".to_owned(),
        size_bytes: 1025,
        sha256: "00".repeat(32),
    };
    let denied = reserves.reserve(&member, upload).await;
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
