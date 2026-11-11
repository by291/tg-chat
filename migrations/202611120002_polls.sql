CREATE TABLE message_polls (
    message_id uuid PRIMARY KEY REFERENCES messages (id) ON DELETE CASCADE,
    definition jsonb NOT NULL,
    version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
    closes_at timestamptz,
    closed_at timestamptz,
    has_voted boolean NOT NULL DEFAULT false
);

CREATE INDEX message_polls_pending_deadline ON message_polls (closes_at, message_id)
    WHERE closes_at IS NOT NULL AND closed_at IS NULL;

CREATE TABLE message_poll_votes (
    message_id uuid NOT NULL REFERENCES message_polls (message_id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    option_ids uuid[] NOT NULL CHECK (cardinality(option_ids) BETWEEN 1 AND 12),
    PRIMARY KEY (message_id, user_id)
);
