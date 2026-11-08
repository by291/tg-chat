use sqlx::PgPool;
use tg_chat::accounts::{
    AccountError, AccountService, AccountSettings, Login, Registration,
    operator::{OperatorCreation, PolicyChange, RegistrationPolicy, SuspensionChange, UserStatus},
};

#[sqlx::test]
#[ignore = "requires PostgreSQL"]
async fn trusted_operator_policy_and_suspension_are_audited_without_reviving_sessions(
    pool: PgPool,
) {
    let accounts = AccountService::new(pool.clone(), AccountSettings::default());
    accounts
        .create_operator(OperatorCreation {
            username: "admin".to_owned(),
            password: "operator initial password".to_owned(),
            display_name: "Operator".to_owned(),
        })
        .await
        .unwrap();
    let grant = accounts
        .register(Registration {
            username: "alice".to_owned(),
            password: "a complete password phrase".to_owned(),
            display_name: "Alice".to_owned(),
            device_name: "Browser".to_owned(),
        })
        .await
        .unwrap();

    accounts
        .set_registration_policy(PolicyChange {
            policy: RegistrationPolicy::Closed,
            reason: "maintenance".to_owned(),
        })
        .await
        .unwrap();
    let registration = accounts
        .register(Registration {
            username: "bobby".to_owned(),
            password: "a complete password phrase".to_owned(),
            display_name: "Bobby".to_owned(),
            device_name: "Browser".to_owned(),
        })
        .await;
    assert!(matches!(registration, Err(AccountError::RegistrationClosed)));

    accounts
        .set_user_status(SuspensionChange {
            username: "alice".to_owned(),
            status: UserStatus::Suspended,
            reason: "abuse report".to_owned(),
        })
        .await
        .unwrap();
    assert!(accounts.authenticate(&grant.token).await.is_err());
    accounts
        .set_user_status(SuspensionChange {
            username: "alice".to_owned(),
            status: UserStatus::Active,
            reason: "appeal accepted".to_owned(),
        })
        .await
        .unwrap();
    assert!(accounts.authenticate(&grant.token).await.is_err());
    assert!(
        accounts
            .login(Login {
                username: "alice".to_owned(),
                password: "a complete password phrase".to_owned(),
                device_name: "Browser".to_owned(),
            })
            .await
            .is_ok()
    );

    let audit_count: i64 =
        sqlx::query_scalar("SELECT count(*) FROM operator_audit").fetch_one(&pool).await.unwrap();
    assert_eq!(audit_count, 4);
    assert!(sqlx::query("DELETE FROM operator_audit").execute(&pool).await.is_err());
}
