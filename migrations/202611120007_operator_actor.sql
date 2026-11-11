-- Keep historical rows intact. Legacy targets remain available in target_user_id.
ALTER TABLE operator_audit
    ADD COLUMN actor_user_id UUID REFERENCES users (id),
    ADD COLUMN target_kind TEXT,
    ADD COLUMN target_id UUID,
    ADD COLUMN outcome TEXT NOT NULL DEFAULT 'succeeded',
    ADD CONSTRAINT operator_audit_origin CHECK (
        (actor = 'trusted_cli' AND actor_user_id IS NULL)
        OR (actor = 'browser' AND actor_user_id IS NOT NULL)
    ),
    ADD CONSTRAINT operator_audit_target_kind CHECK (target_kind IS NOT NULL) NOT VALID;

CREATE TABLE operator_command_receipts (
    actor_user_id UUID NOT NULL REFERENCES users (id),
    operation_id UUID NOT NULL,
    payload_hash BYTEA NOT NULL,
    PRIMARY KEY (actor_user_id, operation_id)
);
