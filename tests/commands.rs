use std::process::Command;

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
