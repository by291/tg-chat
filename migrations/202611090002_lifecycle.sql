ALTER TABLE conversations ADD COLUMN expiry_days integer NOT NULL DEFAULT 0
    CHECK (expiry_days IN (0, 1, 7, 30));
ALTER TABLE messages
    ADD COLUMN deleted_at timestamptz,
    ADD COLUMN expires_at timestamptz,
    ADD COLUMN edited_at timestamptz,
    ADD COLUMN interaction_version bigint NOT NULL DEFAULT 1,
    ADD COLUMN is_pinned boolean NOT NULL DEFAULT false,
    ADD COLUMN reply_id uuid REFERENCES message_identities (id),
    ADD COLUMN reply_quote text,
    ADD COLUMN service_kind text;
CREATE INDEX messages_expiry ON messages (expires_at) WHERE deleted_at IS NULL;
CREATE TABLE hidden_messages (
    user_id uuid NOT NULL REFERENCES users (id),
    message_id uuid NOT NULL REFERENCES message_identities (id),
    PRIMARY KEY (user_id, message_id)
);
CREATE TABLE message_reactions (
    message_id uuid NOT NULL REFERENCES message_identities (id),
    user_id uuid NOT NULL REFERENCES users (id),
    emoji text NOT NULL,
    PRIMARY KEY (message_id, user_id, emoji)
);
CREATE TABLE command_receipts (
    actor_id uuid NOT NULL REFERENCES users (id),
    operation_id uuid NOT NULL,
    payload_hash bytea NOT NULL,
    conversation_id uuid NOT NULL REFERENCES conversations (id),
    message_id uuid REFERENCES message_identities (id),
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (actor_id, operation_id)
);
CREATE INDEX command_receipts_retention ON command_receipts (created_at);
