use sqlx::PgConnection;

use super::RelationshipChange;
use crate::accounts::{AccountError, AccountService, sessions::lock_actor};

const MAX_CONTACTS: i64 = 1000;
const MAX_BLOCKS: i64 = 1000;

struct RelationshipTable {
    name: &'static str,
    count: &'static str,
    insert: &'static str,
    delete: &'static str,
    capacity: i64,
}

const CONTACTS: RelationshipTable = RelationshipTable {
    name: "contacts",
    count: "SELECT count(*), coalesce(bool_or(target_id = $2), false)
            FROM contacts WHERE owner_id = $1",
    insert: "INSERT INTO contacts (owner_id, target_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
    delete: "DELETE FROM contacts WHERE owner_id = $1 AND target_id = $2",
    capacity: MAX_CONTACTS,
};
const BLOCKS: RelationshipTable = RelationshipTable {
    name: "blocks",
    count: "SELECT count(*), coalesce(bool_or(target_id = $2), false)
            FROM blocks WHERE owner_id = $1",
    insert: "INSERT INTO blocks (owner_id, target_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
    delete: "DELETE FROM blocks WHERE owner_id = $1 AND target_id = $2",
    capacity: MAX_BLOCKS,
};

async fn lock_relationship_users(
    connection: &mut PgConnection,
    input: &RelationshipChange,
) -> Result<(), AccountError> {
    // Lock both identities in UUID order before checking blocks or inserting foreign keys.
    // This serializes reciprocal changes without an owner/target lock inversion.
    let identities = [input.actor.user_id, input.target_id];
    sqlx::query("SELECT id FROM users WHERE id = ANY($1) ORDER BY id FOR UPDATE")
        .bind(identities.as_slice())
        .fetch_all(connection)
        .await?;

    Ok(())
}

async fn ensure_target(
    connection: &mut PgConnection,
    input: &RelationshipChange,
) -> Result<(), AccountError> {
    if input.actor.user_id == input.target_id {
        return Err(AccountError::Validation("an account cannot target itself"));
    }
    let is_available: bool = sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM users WHERE id = $1 AND NOT is_suspended)",
    )
    .bind(input.target_id)
    .fetch_one(connection)
    .await?;
    if !is_available {
        return Err(AccountError::NotFound);
    }

    Ok(())
}

impl AccountService {
    /// Save a directional contact if neither account has blocked direct interaction.
    pub async fn add_contact(&self, input: RelationshipChange) -> Result<(), AccountError> {
        self.add_relationship(input, CONTACTS).await
    }

    /// Idempotently remove a saved contact without changing the other account's relationships.
    pub async fn remove_contact(&self, input: RelationshipChange) -> Result<(), AccountError> {
        self.remove_relationship(input, CONTACTS).await
    }

    /// Block future direct interactions without changing shared-group visibility.
    pub async fn add_block(&self, input: RelationshipChange) -> Result<(), AccountError> {
        self.add_relationship(input, BLOCKS).await
    }

    /// Remove only the block owned by the caller.
    pub async fn remove_block(&self, input: RelationshipChange) -> Result<(), AccountError> {
        self.remove_relationship(input, BLOCKS).await
    }

    async fn add_relationship(
        &self,
        input: RelationshipChange,
        table: RelationshipTable,
    ) -> Result<(), AccountError> {
        let mut transaction = self.pool.begin().await?;
        lock_relationship_users(&mut transaction, &input).await?;
        lock_actor(&mut transaction, &input.actor, &self.settings).await?;
        ensure_target(&mut transaction, &input).await?;
        if table.name == "contacts" {
            let is_blocked: bool = sqlx::query_scalar(
                "SELECT EXISTS (SELECT 1 FROM blocks
                 WHERE (owner_id = $1 AND target_id = $2) OR (owner_id = $2 AND target_id = $1))",
            )
            .bind(input.actor.user_id)
            .bind(input.target_id)
            .fetch_one(&mut *transaction)
            .await?;
            if is_blocked {
                return Err(AccountError::Forbidden);
            }
        }
        let count_query =
            sqlx::query_as(table.count).bind(input.actor.user_id).bind(input.target_id);
        let (count, is_existing): (i64, bool) = count_query.fetch_one(&mut *transaction).await?;
        if count >= table.capacity && !is_existing {
            return Err(AccountError::QuotaExceeded);
        }
        let insert = sqlx::query(table.insert).bind(input.actor.user_id).bind(input.target_id);
        insert.execute(&mut *transaction).await?;
        transaction.commit().await?;

        Ok(())
    }

    async fn remove_relationship(
        &self,
        input: RelationshipChange,
        table: RelationshipTable,
    ) -> Result<(), AccountError> {
        let mut transaction = self.pool.begin().await?;
        lock_relationship_users(&mut transaction, &input).await?;
        lock_actor(&mut transaction, &input.actor, &self.settings).await?;
        let delete = sqlx::query(table.delete).bind(input.actor.user_id).bind(input.target_id);
        delete.execute(&mut *transaction).await?;
        transaction.commit().await?;

        Ok(())
    }
}
