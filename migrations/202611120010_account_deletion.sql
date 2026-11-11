ALTER TABLE users ADD COLUMN deleted_at timestamptz;
ALTER TABLE users DROP CONSTRAINT users_username_check;
ALTER TABLE users DROP CONSTRAINT users_username_key;
ALTER TABLE users ADD CONSTRAINT users_identity_check CHECK (
    (deleted_at IS NULL AND username ~ '^[a-z0-9_]{3,32}$')
    OR (deleted_at IS NOT NULL AND username = '' AND password_hash = '' AND is_suspended)
);

CREATE UNIQUE INDEX users_username_key ON users (username) WHERE deleted_at IS NULL;
CREATE INDEX conversations_live_owner ON conversations (owner_id, id)
    WHERE owner_id IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX messages_author_conversations ON messages (author_id, conversation_id);
CREATE INDEX conversation_members_account ON conversation_members (user_id, conversation_id);
CREATE INDEX community_invitations_creator ON community_invitations (created_by, id)
    WHERE revoked_at IS NULL;
CREATE INDEX community_join_requests_account ON community_join_requests (user_id, conversation_id);
CREATE INDEX community_join_requests_invitation ON community_join_requests (invitation_id)
    WHERE invitation_id IS NOT NULL;
CREATE INDEX contacts_target ON contacts (target_id, owner_id);
CREATE INDEX blocks_target ON blocks (target_id, owner_id);
CREATE INDEX email_challenges_account_cleanup ON email_challenges (user_id, id);
CREATE INDEX mail_jobs_challenge ON mail_jobs (challenge_id);
CREATE INDEX sessions_account_cleanup ON sessions (user_id, id);

CREATE TABLE account_cleanup_jobs (
    user_id uuid PRIMARY KEY REFERENCES users(id),
    operation_id uuid NOT NULL,
    created_at timestamptz NOT NULL,
    last_conversation_id uuid,
    completed_at timestamptz
);

CREATE INDEX account_cleanup_jobs_pending ON account_cleanup_jobs (created_at, user_id)
    WHERE completed_at IS NULL;
