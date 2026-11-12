use livekit_api::services::room::{CreateRoomOptions, RoomClient};
use url::{Host, Url};
use uuid::Uuid;

const MAX_CALL_PARTICIPANTS: u32 = 2;

fn required_setting(name: &str) -> String {
    std::env::var(name)
        .ok()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| panic!("Set {name} for the disposable LiveKit integration runtime"))
}

fn provider_url() -> Url {
    let name = "TG_CHAT_LIVEKIT_INTERNAL_URL";
    let value = required_setting(name);
    let url = Url::parse(&value).unwrap_or_else(|_| panic!("{name} must be a valid URL"));
    let is_loopback = match url.host() {
        Some(Host::Ipv4(address)) => address.is_loopback(),
        Some(Host::Ipv6(address)) => address.is_loopback(),
        Some(Host::Domain(domain)) => domain == "localhost",
        None => false,
    };
    assert!(
        url.scheme() == "http" && is_loopback,
        "{name} must point to the disposable loopback LiveKit runtime",
    );

    url
}

#[tokio::test]
#[ignore = "requires a disposable LiveKit calls profile"]
async fn explicitly_created_room_can_be_listed_and_deleted() {
    let url = provider_url();
    let key = required_setting("TG_CHAT_LIVEKIT_API_KEY");
    let secret = required_setting("TG_CHAT_LIVEKIT_API_SECRET");
    let client = RoomClient::with_api_key(url.as_str(), &key, &secret);
    let room_name = format!("contract-{}", Uuid::new_v4());

    let room = client
        .create_room(
            &room_name,
            CreateRoomOptions {
                max_participants: MAX_CALL_PARTICIPANTS,
                ..CreateRoomOptions::default()
            },
        )
        .await
        .expect("explicit room creation should succeed");
    let listed_rooms = client.list_rooms(vec![room_name.clone()]).await;
    client.delete_room(&room_name).await.expect("room deletion should succeed");
    let remaining_rooms = client
        .list_rooms(vec![room_name.clone()])
        .await
        .expect("room listing after deletion should succeed");

    assert_eq!(room.name, room_name);
    assert!(!room.sid.is_empty());
    assert_eq!(room.max_participants, MAX_CALL_PARTICIPANTS);
    let listed_rooms = listed_rooms.expect("room listing before deletion should succeed");
    assert_eq!(listed_rooms.len(), 1);
    assert_eq!(listed_rooms[0].sid, room.sid);
    assert!(remaining_rooms.is_empty());
}
