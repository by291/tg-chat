use std::process::Command;

use sqlx::{ConnectOptions, PgPool};

#[test]
fn openapi_export_does_not_require_runtime_credentials() {
    let mut command = Command::new(env!("CARGO_BIN_EXE_api"));
    command.arg("openapi").env_remove("TG_CHAT_DATABASE_URL");

    let output = command.output().expect("run OpenAPI export");

    assert!(output.status.success());
    let document: serde_json::Value = serde_json::from_slice(&output.stdout).expect("OpenAPI JSON");
    assert!(document["paths"]["/health/live"]["get"].is_object());
    assert!(document["paths"]["/health/ready"]["get"]["responses"]["503"].is_object());
}

#[test]
fn invalid_configuration_exits_without_printing_credentials() {
    let mut command = Command::new(env!("CARGO_BIN_EXE_api"));
    command
        .arg("serve")
        .env("TG_CHAT_DATABASE_URL", "https://owner:command-private-password@localhost/database");

    let output = command.output().expect("run invalid configuration");

    assert!(!output.status.success());
    let diagnostic = String::from_utf8_lossy(&output.stderr);
    assert!(diagnostic.contains("TG_CHAT_DATABASE_URL"));
    assert!(!diagnostic.contains("command-private-password"));
}

#[sqlx::test(migrations = false)]
#[ignore = "requires an isolated PostgreSQL instance through DATABASE_URL"]
async fn migration_command_reports_completion_without_credentials(pool: PgPool) {
    let connection_url = pool.connect_options().to_url_lossy();
    let mut command = Command::new(env!("CARGO_BIN_EXE_api"));
    command
        .arg("migrate")
        .env("TG_CHAT_DATABASE_URL", connection_url.as_str())
        .env("TG_CHAT_LOG_LEVEL", "info");

    let output = command.output().expect("run migration command");
    assert!(output.status.success());
    let diagnostic = String::from_utf8_lossy(&output.stderr);
    let has_completion_event = diagnostic.lines().any(|line| {
        let event: serde_json::Value = serde_json::from_str(line).expect("structured event");
        event["fields"]["message"] == "migrations_applied"
    });

    assert!(has_completion_event, "successful migration must emit its completion event");
    assert!(!diagnostic.contains(connection_url.as_str()));

    if let Some(password) = connection_url.password() {
        assert!(!diagnostic.contains(password));
    }
}
