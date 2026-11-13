use sqlx::PgPool;
use tg_chat::features::{
    accounts::{
        AccountError, AccountService, AccountSettings, Actor, Registration, profile::ProfileUpdate,
    },
    contacts::{Audience, DirectoryQuery, PrivacySettings, RelationshipChange},
};
use uuid::Uuid;

async fn register(accounts: &AccountService, username: &str) -> Actor {
    let grant = accounts
        .register(Registration {
            username: username.to_owned(),
            password: "a complete password phrase".to_owned(),
            display_name: username.to_owned(),
            device_name: "Browser".to_owned(),
        })
        .await
        .unwrap();

    accounts.authenticate(&grant.token).await.unwrap()
}

fn first_page() -> DirectoryQuery {
    DirectoryQuery {
        search: None,
        cursor: None,
        limit: Some(20),
        linkable_only: None,
    }
}

#[sqlx::test]
#[ignore = "requires PostgreSQL"]
async fn directory_filters_suspensions_and_exposes_only_public_profile_fields(pool: PgPool) {
    let accounts = AccountService::new(pool.clone(), AccountSettings::default());
    let alice = register(&accounts, "alice").await;
    let bobby = register(&accounts, "bobby").await;
    let profile = accounts
        .update_profile(
            &alice,
            ProfileUpdate {
                version: "1".to_owned(),
                display_name: "Alice Example".to_owned(),
                biography: "A public biography".to_owned(),
                phone: Some("private-phone".to_owned()),
            },
        )
        .await
        .unwrap();
    assert_eq!(profile.phone.as_deref(), Some("private-phone"));
    let stale = accounts
        .update_profile(
            &alice,
            ProfileUpdate {
                version: "1".to_owned(),
                display_name: "Outdated".to_owned(),
                biography: String::new(),
                phone: None,
            },
        )
        .await;
    assert!(matches!(stale, Err(AccountError::Conflict)));
    let page = accounts
        .discover(
            &bobby,
            DirectoryQuery {
                search: Some("Alice".to_owned()),
                cursor: None,
                limit: Some(20),
                linkable_only: None,
            },
        )
        .await
        .unwrap();
    assert_eq!(page.users.len(), 1);
    let public = serde_json::to_value(&page.users[0]).unwrap();
    assert!(public.get("phone").is_none());
    assert!(public.get("email").is_none());
    assert_eq!(public["display_name"], "Alice Example");

    sqlx::query("UPDATE users SET is_suspended = true WHERE id = $1")
        .bind(alice.user_id)
        .execute(&pool)
        .await
        .unwrap();
    let page = accounts
        .discover(
            &bobby,
            DirectoryQuery {
                search: Some("alice".to_owned()),
                cursor: None,
                limit: Some(20),
                linkable_only: None,
            },
        )
        .await
        .unwrap();
    assert!(page.users.is_empty());
    let invalid = accounts
        .discover(
            &bobby,
            DirectoryQuery {
                search: Some("alice".to_owned()),
                cursor: Some("invalid-cursor".to_owned()),
                limit: Some(20),
                linkable_only: None,
            },
        )
        .await;
    assert!(matches!(invalid, Err(AccountError::Validation(_))));
}

#[sqlx::test]
#[ignore = "requires PostgreSQL"]
async fn contacts_are_directional_and_blocks_prevent_new_direct_relationships(pool: PgPool) {
    let accounts = AccountService::new(pool, AccountSettings::default());
    let alice = register(&accounts, "alice").await;
    let bobby = register(&accounts, "bobby").await;
    accounts
        .add_contact(RelationshipChange {
            actor: alice.clone(),
            target_id: bobby.user_id,
        })
        .await
        .unwrap();
    assert_eq!(accounts.contacts(&alice, first_page()).await.unwrap().users.len(), 1);
    assert!(accounts.contacts(&bobby, first_page()).await.unwrap().users.is_empty());
    assert!(matches!(
        accounts
            .add_contact(RelationshipChange {
                actor: alice.clone(),
                target_id: alice.user_id,
            })
            .await,
        Err(AccountError::Validation(_))
    ));

    accounts
        .add_block(RelationshipChange {
            actor: bobby.clone(),
            target_id: alice.user_id,
        })
        .await
        .unwrap();
    assert!(matches!(
        accounts
            .add_contact(RelationshipChange {
                actor: alice.clone(),
                target_id: bobby.user_id,
            })
            .await,
        Err(AccountError::Forbidden)
    ));
    assert!(accounts.blocks(&alice, first_page()).await.unwrap().users.is_empty());
    assert_eq!(accounts.blocks(&bobby, first_page()).await.unwrap().users.len(), 1);
    accounts
        .remove_block(RelationshipChange {
            actor: bobby.clone(),
            target_id: alice.user_id,
        })
        .await
        .unwrap();
    accounts
        .remove_contact(RelationshipChange {
            actor: alice.clone(),
            target_id: bobby.user_id,
        })
        .await
        .unwrap();
    assert!(accounts.contacts(&alice, first_page()).await.unwrap().users.is_empty());
}

#[sqlx::test]
#[ignore = "requires PostgreSQL"]
async fn suspended_saved_targets_remain_listed_until_the_owner_removes_them(pool: PgPool) {
    let accounts = AccountService::new(pool.clone(), AccountSettings::default());
    let alice = register(&accounts, "alice").await;
    let bobby = register(&accounts, "bobby").await;
    accounts
        .add_contact(RelationshipChange {
            actor: alice.clone(),
            target_id: bobby.user_id,
        })
        .await
        .unwrap();
    accounts
        .add_block(RelationshipChange {
            actor: alice.clone(),
            target_id: bobby.user_id,
        })
        .await
        .unwrap();

    sqlx::query("UPDATE users SET is_suspended = true WHERE id = $1")
        .bind(bobby.user_id)
        .execute(&pool)
        .await
        .unwrap();
    let contacts = accounts.contacts(&alice, first_page()).await.unwrap();
    let blocks = accounts.blocks(&alice, first_page()).await.unwrap();
    assert_eq!(contacts.users.len(), 1);
    assert_eq!(blocks.users.len(), 1);
    assert_eq!(contacts.users[0].id, bobby.user_id);
    assert_eq!(blocks.users[0].id, bobby.user_id);

    accounts
        .remove_contact(RelationshipChange {
            actor: alice.clone(),
            target_id: bobby.user_id,
        })
        .await
        .unwrap();
    accounts
        .remove_block(RelationshipChange {
            actor: alice.clone(),
            target_id: bobby.user_id,
        })
        .await
        .unwrap();
    assert!(accounts.contacts(&alice, first_page()).await.unwrap().users.is_empty());
    assert!(accounts.blocks(&alice, first_page()).await.unwrap().users.is_empty());
}

#[sqlx::test]
#[ignore = "requires PostgreSQL"]
async fn concurrent_contact_admission_preserves_the_capacity_boundary(pool: PgPool) {
    let accounts = AccountService::new(pool.clone(), AccountSettings::default());
    let alice = register(&accounts, "alice").await;
    let bobby = register(&accounts, "bobby").await;
    let carol = register(&accounts, "carol").await;
    // Seed unrelated existing contacts without paying password-hash costs for directory fixtures.
    let owners: Vec<Uuid> = sqlx::query_scalar(
        "INSERT INTO users (id, username, password_hash, display_name)
         SELECT gen_random_uuid(), 'fixture_' || sequence, 'unused', 'Fixture'
         FROM generate_series(1, 999) AS sequence RETURNING id",
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    sqlx::query("INSERT INTO contacts (owner_id, target_id) SELECT $1, unnest($2::uuid[])")
        .bind(alice.user_id)
        .bind(owners)
        .execute(&pool)
        .await
        .unwrap();
    let (first, second) = tokio::join!(
        accounts.add_contact(RelationshipChange {
            actor: alice.clone(),
            target_id: bobby.user_id,
        }),
        accounts.add_contact(RelationshipChange {
            actor: alice.clone(),
            target_id: carol.user_id,
        }),
    );
    assert_ne!(first.is_ok(), second.is_ok());
    let rejection = first.err().or(second.err()).unwrap();
    assert!(matches!(rejection, AccountError::QuotaExceeded));
    let first = accounts
        .contacts(
            &alice,
            DirectoryQuery {
                limit: Some(50),
                ..first_page()
            },
        )
        .await
        .unwrap();
    assert_eq!(first.users.len(), 50);
    let next = accounts
        .contacts(
            &alice,
            DirectoryQuery {
                cursor: first.next_cursor,
                limit: Some(50),
                search: None,
                linkable_only: None,
            },
        )
        .await
        .unwrap();
    assert!(
        next.users.iter().all(|user| !first.users.iter().any(|previous| previous.id == user.id))
    );
}

#[sqlx::test]
#[ignore = "requires PostgreSQL"]
async fn privacy_defaults_and_updates_remain_owned_by_each_account(pool: PgPool) {
    let accounts = AccountService::new(pool, AccountSettings::default());
    let alice = register(&accounts, "alice").await;
    let bobby = register(&accounts, "bobby").await;
    let defaults = accounts.privacy(&alice).await.unwrap();
    assert_eq!(defaults.direct_messages, Audience::Everyone);
    assert_eq!(defaults.calls, Audience::Contacts);
    assert_eq!(defaults.presence, Audience::Contacts);
    accounts
        .update_privacy(
            &alice,
            PrivacySettings {
                direct_messages: Audience::Nobody,
                calls: Audience::Nobody,
                presence: Audience::Nobody,
            },
        )
        .await
        .unwrap();
    assert_eq!(accounts.privacy(&alice).await.unwrap().calls, Audience::Nobody);
    assert_eq!(accounts.privacy(&bobby).await.unwrap().calls, Audience::Contacts);
}

#[sqlx::test]
#[ignore = "requires PostgreSQL"]
async fn reciprocal_contact_updates_finish_without_deadlocks(pool: PgPool) {
    let accounts = AccountService::new(pool, AccountSettings::default());
    let alice = register(&accounts, "alice").await;
    let bobby = register(&accounts, "bobby").await;
    let (first, second) = tokio::join!(
        accounts.add_contact(RelationshipChange {
            actor: alice.clone(),
            target_id: bobby.user_id,
        }),
        accounts.add_contact(RelationshipChange {
            actor: bobby.clone(),
            target_id: alice.user_id,
        }),
    );
    first.unwrap();
    second.unwrap();
}

#[sqlx::test]
#[ignore = "requires PostgreSQL"]
async fn linkable_discovery_excludes_accounts_blocked_in_either_direction(pool: PgPool) {
    use serde_json::{from_value, json};

    let accounts = AccountService::new(pool, AccountSettings::default());
    let reader = register(&accounts, "reader").await;
    let incoming_block = register(&accounts, "contact_incoming").await;
    let outgoing_block = register(&accounts, "contact_outgoing").await;
    let available = register(&accounts, "contact_available").await;

    accounts
        .add_block(RelationshipChange {
            actor: incoming_block.clone(),
            target_id: reader.user_id,
        })
        .await
        .unwrap();
    accounts
        .add_block(RelationshipChange {
            actor: reader.clone(),
            target_id: outgoing_block.user_id,
        })
        .await
        .unwrap();

    let default_query = from_value(json!({ "search": "contact_" })).unwrap();
    let normal = accounts.discover(&reader, default_query).await.unwrap();
    assert_eq!(normal.users.len(), 3);

    let linkable_query =
        from_value(json!({ "search": "contact_", "linkable_only": true })).unwrap();
    let linkable = accounts.discover(&reader, linkable_query).await.unwrap();
    let linkable_ids: Vec<_> = linkable.users.iter().map(|user| user.id).collect();
    assert_eq!(linkable_ids, vec![available.user_id]);

    for blocked in [incoming_block, outgoing_block] {
        let profile = accounts.directory_profile(&reader, blocked.user_id).await;
        assert!(matches!(profile, Err(AccountError::NotFound)));
    }
}
