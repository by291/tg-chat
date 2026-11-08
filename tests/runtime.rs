use std::collections::HashMap;

use axum::{body::Body, http::Request};
use http_body_util::BodyExt;
use sqlx::{PgPool, migrate::Migrator};
use tg_chat::{
    config::{ServiceKind, Settings},
    database::{MIGRATOR, connect_pool, migrate},
    http::{ApplicationState, router},
};
use tower::ServiceExt;

static FIXTURE_MIGRATOR: Migrator = sqlx::migrate!("./tests/fixtures/migrations");
static FAILED_MIGRATOR: Migrator = sqlx::migrate!("./tests/fixtures/failed-migrations");

fn unreachable_database() -> PgPool {
    let values = HashMap::from([(
        "TG_CHAT_DATABASE_URL".to_owned(),
        "postgres://test:private-test-password@127.0.0.1:1/unreachable".to_owned(),
    )]);
    let settings = Settings::from_values(&values, ServiceKind::Api).expect("valid settings");

    connect_pool(&settings.database)
}

async fn get_response(pool: &PgPool, path: &str) -> axum::response::Response {
    let application = router(ApplicationState {
        pool: pool.clone(),
        service: ServiceKind::Api,
    });
    let request = Request::builder().uri(path).body(Body::empty()).expect("valid request");

    application.oneshot(request).await.expect("HTTP response")
}

#[tokio::test]
async fn liveness_survives_an_unavailable_database() {
    let pool = unreachable_database();

    let response = get_response(&pool, "/health/live").await;

    assert_eq!(response.status(), 200);
    assert!(response.headers().contains_key("x-request-id"));
}

#[tokio::test]
async fn readiness_returns_a_correlated_error_without_database_credentials() {
    let pool = unreachable_database();

    let response = get_response(&pool, "/health/ready?password=private-query-password").await;

    assert_eq!(response.status(), 503);
    let request_header = &response.headers()["x-request-id"];
    let request_id = request_header.to_str().expect("request ID").to_owned();
    let collected = response.into_body().collect().await.expect("response body");
    let bytes = collected.to_bytes();
    let body: serde_json::Value = serde_json::from_slice(&bytes).expect("JSON error");

    assert_eq!(body["error"]["request_id"], request_id);
    assert_eq!(body["error"]["code"], "dependency_unavailable");
    assert!(!String::from_utf8_lossy(&bytes).contains("private-"));
}

#[tokio::test]
async fn unknown_routes_return_the_shared_error_contract() {
    let pool = unreachable_database();

    let response = get_response(&pool, "/api/v1/unknown?token=private-token").await;

    assert_eq!(response.status(), 404);
    let collected = response.into_body().collect().await.expect("response body");
    let bytes = collected.to_bytes();
    let body: serde_json::Value = serde_json::from_slice(&bytes).expect("JSON error");

    assert_eq!(body["error"]["code"], "not_found");
    assert!(!String::from_utf8_lossy(&bytes).contains("private-token"));
}

#[sqlx::test(migrations = false)]
#[ignore = "requires an isolated PostgreSQL instance through DATABASE_URL"]
async fn readiness_requires_migration_and_recovers_after_database_initialization(pool: PgPool) {
    assert_eq!(get_response(&pool, "/health/ready").await.status(), 503);

    migrate(&pool, &MIGRATOR).await.expect("initialize migration metadata");

    assert_eq!(get_response(&pool, "/health/ready").await.status(), 200);

    pool.close().await;

    assert_eq!(get_response(&pool, "/health/ready").await.status(), 503);
    assert_eq!(get_response(&pool, "/health/live").await.status(), 200);
}

#[sqlx::test(migrations = false)]
#[ignore = "requires an isolated PostgreSQL instance through DATABASE_URL"]
async fn concurrent_migrators_apply_non_idempotent_changes_once(pool: PgPool) {
    let (first, second) =
        tokio::join!(migrate(&pool, &FIXTURE_MIGRATOR), migrate(&pool, &FIXTURE_MIGRATOR),);

    first.expect("first migration succeeds");
    second.expect("second migration succeeds");
    let stored_value: String = sqlx::query_scalar("SELECT value FROM runtime_probe")
        .fetch_one(&pool)
        .await
        .expect("persisted value");

    assert_eq!(stored_value, "preserved across migrations");
}

#[sqlx::test(migrations = false)]
#[ignore = "requires an isolated PostgreSQL instance through DATABASE_URL"]
async fn failed_migration_rolls_back_partial_changes(pool: PgPool) {
    let outcome = migrate(&pool, &FAILED_MIGRATOR).await;

    assert!(outcome.is_err());
    let has_rolled_back: bool = sqlx::query_scalar("SELECT to_regclass('partial_probe') IS NULL")
        .fetch_one(&pool)
        .await
        .expect("rollback inspection");

    assert!(has_rolled_back);

    let retry =
        tokio::time::timeout(std::time::Duration::from_secs(3), migrate(&pool, &FIXTURE_MIGRATOR))
            .await
            .expect("failed migration releases its session lock");

    retry.expect("a corrected migration can run on a new connection");
}
