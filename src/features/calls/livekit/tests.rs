use super::*;

fn settings_values() -> HashMap<String, String> {
    HashMap::from([
        ("TG_CHAT_CALLS_ENABLED".to_owned(), "true".to_owned()),
        ("TG_CHAT_PUBLIC_ORIGIN".to_owned(), "https://chat.example.test".to_owned()),
        ("TG_CHAT_LIVEKIT_INTERNAL_URL".to_owned(), "http://livekit:7880".to_owned()),
        ("TG_CHAT_LIVEKIT_PUBLIC_URL".to_owned(), "wss://chat.example.test".to_owned()),
        ("TG_CHAT_LIVEKIT_API_KEY".to_owned(), "fixture-key".to_owned()),
        ("TG_CHAT_LIVEKIT_API_SECRET".to_owned(), "fixture-only-secret".repeat(2)),
    ])
}

#[test]
fn enabled_calls_require_public_signaling_at_the_application_gateway() {
    let mut values = settings_values();
    values.insert("TG_CHAT_LIVEKIT_PUBLIC_URL".to_owned(), "wss://media.example.test".to_owned());

    assert!(LiveKit::from_values(&values).is_err());
    assert!(LiveKit::from_values(&HashMap::new()).unwrap().is_none());
}

#[test]
fn issued_credentials_only_allow_scoped_camera_and_microphone_media() {
    let provider = LiveKit::from_values(&settings_values()).unwrap().unwrap();
    let participant = Uuid::new_v4();
    let credentials = provider.issue("call-room", participant).unwrap();
    let claims = provider.verifier.verify(&credentials.token).unwrap();

    assert_eq!(credentials.url, "wss://chat.example.test/");
    assert_eq!(claims.sub, participant.to_string());
    assert_eq!(claims.video.room, "call-room");
    assert!(claims.video.room_join);
    assert!(!claims.video.room_create);
    assert!(!claims.video.room_admin);
    assert!(!claims.video.can_publish_data());
    assert_eq!(claims.video.can_publish_sources, ["microphone", "camera"]);
}
