use std::collections::HashMap;

use tg_chat::config::{ServiceKind, Settings};

const DATABASE_SECRET: &str = "test-secret-never-log";

fn valid_values() -> HashMap<String, String> {
    HashMap::from([(
        "TG_CHAT_DATABASE_URL".to_owned(),
        format!("postgres://test:{DATABASE_SECRET}@localhost/tg_chat"),
    )])
}

#[test]
fn valid_database_configuration_uses_distinct_service_listeners() {
    let values = valid_values();

    let api = Settings::from_values(&values, ServiceKind::Api).expect("valid API settings");
    let worker =
        Settings::from_values(&values, ServiceKind::Worker).expect("valid Worker settings");

    assert_ne!(api.bind_address, worker.bind_address);
}

#[test]
fn missing_database_configuration_is_rejected() {
    let values = HashMap::new();

    let error = Settings::from_values(&values, ServiceKind::Api).expect_err("missing database URL");

    assert!(error.to_string().contains("TG_CHAT_DATABASE_URL"));
}

#[test]
fn malformed_database_configuration_does_not_disclose_credentials() {
    let mut values = valid_values();
    values.insert(
        "TG_CHAT_DATABASE_URL".to_owned(),
        format!("https://test:{DATABASE_SECRET}@localhost/database"),
    );

    let error = Settings::from_values(&values, ServiceKind::Api).expect_err("invalid URL scheme");
    let diagnostic = error.to_string();

    assert!(diagnostic.contains("TG_CHAT_DATABASE_URL"));
    assert!(!diagnostic.contains(DATABASE_SECRET));
}

#[test]
fn settings_debug_output_does_not_disclose_credentials() {
    let settings =
        Settings::from_values(&valid_values(), ServiceKind::Api).expect("valid settings");

    let diagnostic = format!("{settings:?}");

    assert!(!diagnostic.contains(DATABASE_SECRET));
}

#[test]
fn invalid_listener_address_is_rejected() {
    let mut values = valid_values();
    values.insert("TG_CHAT_BIND_ADDRESS".to_owned(), "not-an-address".to_owned());

    let error = Settings::from_values(&values, ServiceKind::Api).expect_err("invalid bind address");

    assert!(error.to_string().contains("TG_CHAT_BIND_ADDRESS"));
}

#[test]
fn zero_or_unbounded_pool_sizes_are_rejected() {
    for pool_size in ["0", "101", "invalid"] {
        let mut values = valid_values();
        values.insert("TG_CHAT_DB_MAX_CONNECTIONS".to_owned(), pool_size.to_owned());

        let error =
            Settings::from_values(&values, ServiceKind::Api).expect_err("invalid pool size");

        assert!(error.to_string().contains("TG_CHAT_DB_MAX_CONNECTIONS"));
    }
}

#[test]
fn log_configuration_cannot_enable_unfiltered_dependency_tracing() {
    let mut values = valid_values();
    values.insert("TG_CHAT_LOG_LEVEL".to_owned(), "sqlx=trace".to_owned());

    let error = Settings::from_values(&values, ServiceKind::Api).expect_err("invalid log level");

    assert!(error.to_string().contains("TG_CHAT_LOG_LEVEL"));
}
