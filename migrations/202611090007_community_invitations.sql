CREATE TABLE community_invitations (
    id uuid PRIMARY KEY,
    conversation_id uuid NOT NULL REFERENCES conversations (id),
    created_by uuid NOT NULL REFERENCES users (id),
    target_id uuid REFERENCES users (id),
    token_hash bytea UNIQUE,
    expires_at timestamptz NOT NULL,
    max_uses bigint CHECK (max_uses BETWEEN 1 AND 500),
    uses bigint NOT NULL DEFAULT 0 CHECK (uses >= 0),
    revoked_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK ((target_id IS NULL) <> (token_hash IS NULL)),
    CHECK (token_hash IS NULL OR octet_length(token_hash) = 32),
    CHECK (max_uses IS NULL OR uses <= max_uses)
);
CREATE INDEX community_invitations_owner ON community_invitations (conversation_id, id);
CREATE INDEX community_invitations_inbox ON community_invitations (target_id, id)
    WHERE revoked_at IS NULL;

CREATE TABLE community_join_requests (
    conversation_id uuid NOT NULL REFERENCES conversations (id),
    user_id uuid NOT NULL REFERENCES users (id),
    invitation_id uuid REFERENCES community_invitations (id),
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (conversation_id, user_id)
);
