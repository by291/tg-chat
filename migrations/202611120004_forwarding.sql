ALTER TABLE conversations
    ADD COLUMN forwarding_enabled boolean NOT NULL DEFAULT true,
    ADD COLUMN forwarding_low_consent boolean NOT NULL DEFAULT false,
    ADD COLUMN forwarding_high_consent boolean NOT NULL DEFAULT false;

ALTER TABLE messages ADD COLUMN forwarded_from text;

CREATE TABLE message_forward_batches (
    actor_id uuid NOT NULL REFERENCES users (id),
    operation_id uuid NOT NULL,
    payload_hash bytea NOT NULL CHECK (octet_length(payload_hash) = 32),
    conversation_id uuid NOT NULL REFERENCES conversations (id),
    message_ids uuid[] NOT NULL CHECK (cardinality(message_ids) BETWEEN 1 AND 20),
    PRIMARY KEY (actor_id, operation_id)
);
