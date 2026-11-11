ALTER TABLE messages
    ADD COLUMN disable_link_preview boolean NOT NULL DEFAULT false;

CREATE TABLE message_link_previews (
    message_id uuid PRIMARY KEY REFERENCES messages (id) ON DELETE CASCADE,
    content_version bigint NOT NULL CHECK (content_version > 0),
    target_url text NOT NULL CHECK (octet_length(target_url) BETWEEN 1 AND 8192),
    available_at timestamptz NOT NULL DEFAULT now(),
    attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    lease_token uuid,
    lease_until timestamptz,
    finished_at timestamptz,
    metadata jsonb,
    CHECK ((lease_token IS NULL) = (lease_until IS NULL)),
    CHECK (finished_at IS NULL OR lease_token IS NULL),
    CHECK (metadata IS NULL OR finished_at IS NOT NULL)
);

CREATE INDEX message_link_previews_available
    ON message_link_previews (available_at, message_id)
    WHERE finished_at IS NULL;
