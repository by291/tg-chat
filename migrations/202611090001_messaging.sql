CREATE TABLE deployment_identity (
    singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
    id uuid NOT NULL DEFAULT gen_random_uuid()
);
INSERT INTO deployment_identity (singleton) VALUES (true);

CREATE TABLE conversations (
    id uuid PRIMARY KEY,
    kind text NOT NULL CHECK (kind IN ('direct', 'saved')),
    -- Defer these checks: acceptance locks the conversation before its participant accounts.
    participant_low uuid NOT NULL REFERENCES users (id) DEFERRABLE INITIALLY DEFERRED,
    participant_high uuid NOT NULL REFERENCES users (id) DEFERRABLE INITIALLY DEFERRED,
    last_sequence bigint NOT NULL DEFAULT 0 CHECK (last_sequence >= 0),
    version bigint NOT NULL DEFAULT 1,
    summary_text text NOT NULL DEFAULT '',
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (kind, participant_low, participant_high),
    CHECK ((kind = 'saved' AND participant_low = participant_high)
        OR (kind = 'direct' AND participant_low < participant_high))
);

CREATE TABLE conversation_members (
    conversation_id uuid NOT NULL REFERENCES conversations (id),
    user_id uuid NOT NULL REFERENCES users (id),
    directory_active boolean NOT NULL DEFAULT true,
    generation bigint NOT NULL DEFAULT 1,
    unread_count bigint NOT NULL DEFAULT 0,
    read_through bigint NOT NULL DEFAULT 0,
    clear_through bigint NOT NULL DEFAULT 0,
    is_archived boolean NOT NULL DEFAULT false,
    is_hidden boolean NOT NULL DEFAULT false,
    is_manually_unread boolean NOT NULL DEFAULT false,
    pin_rank integer,
    muted_until timestamptz,
    PRIMARY KEY (conversation_id, user_id)
);
CREATE INDEX conversation_members_directory ON conversation_members (user_id, conversation_id)
    WHERE directory_active;

-- Identity bindings survive message deletion and receipt retention cleanup.
CREATE TABLE message_identities (
    id uuid PRIMARY KEY,
    author_id uuid NOT NULL REFERENCES users (id),
    conversation_id uuid NOT NULL REFERENCES conversations (id),
    operation_id uuid NOT NULL,
    payload_hash bytea NOT NULL CHECK (octet_length(payload_hash) = 32),
    UNIQUE (author_id, operation_id)
);
CREATE TABLE messages (
    id uuid PRIMARY KEY REFERENCES message_identities (id),
    conversation_id uuid NOT NULL REFERENCES conversations (id),
    author_id uuid NOT NULL REFERENCES users (id),
    sequence bigint NOT NULL CHECK (sequence > 0),
    version bigint NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    content jsonb NOT NULL,
    UNIQUE (conversation_id, sequence)
);
CREATE TABLE operation_receipts (
    actor_id uuid NOT NULL REFERENCES users (id),
    operation_id uuid NOT NULL,
    message_id uuid NOT NULL REFERENCES message_identities (id),
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (actor_id, operation_id)
);

CREATE TABLE sync_heads (
    user_id uuid PRIMARY KEY REFERENCES users (id),
    position bigint NOT NULL DEFAULT 0,
    retained_floor bigint NOT NULL DEFAULT 0
);
INSERT INTO sync_heads (user_id) SELECT id FROM users;
CREATE FUNCTION initialize_sync_head() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO sync_heads (user_id) VALUES (NEW.id);
    RETURN NEW;
END;
$$;
CREATE TRIGGER users_sync_head AFTER INSERT ON users
    FOR EACH ROW EXECUTE FUNCTION initialize_sync_head();

CREATE TABLE personal_changes (
    user_id uuid NOT NULL REFERENCES users (id),
    position bigint NOT NULL,
    conversation_id uuid NOT NULL REFERENCES conversations (id),
    message_id uuid REFERENCES message_identities (id),
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, position)
);
CREATE TABLE sync_wakeups (
    user_id uuid PRIMARY KEY REFERENCES users (id),
    position bigint NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
);
