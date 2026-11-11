ALTER TABLE personal_changes ADD COLUMN is_new_message boolean NOT NULL DEFAULT false;

CREATE TABLE push_subscriptions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id uuid NOT NULL UNIQUE REFERENCES sessions(id) ON DELETE CASCADE,
    endpoint text NOT NULL UNIQUE CHECK (octet_length(endpoint) <= 2048),
    p256dh bytea NOT NULL CHECK (octet_length(p256dh) = 65),
    auth bytea NOT NULL CHECK (octet_length(auth) = 16),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    expires_at timestamptz
);

CREATE FUNCTION detach_revoked_push_subscription() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    DELETE FROM push_subscriptions WHERE session_id = NEW.id;
    RETURN NEW;
END;
$$;

CREATE TRIGGER sessions_detach_push
AFTER UPDATE OF revoked_at ON sessions
FOR EACH ROW WHEN (OLD.revoked_at IS NULL AND NEW.revoked_at IS NOT NULL)
EXECUTE FUNCTION detach_revoked_push_subscription();

CREATE TABLE push_intents (
    message_id uuid PRIMARY KEY REFERENCES messages(id),
    recipient_ids uuid[] NOT NULL,
    created_at timestamptz NOT NULL,
    expires_at timestamptz NOT NULL,
    last_subscription_id uuid,
    fanned_at timestamptz
);

CREATE INDEX push_intents_pending ON push_intents (created_at, message_id) WHERE fanned_at IS NULL;
CREATE INDEX push_intents_expiry ON push_intents (expires_at, message_id);

CREATE TABLE push_deliveries (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id uuid NOT NULL REFERENCES messages(id),
    -- Keep queued IDs stable while revocation removes endpoint credentials in constant time.
    subscription_id uuid NOT NULL,
    expires_at timestamptz NOT NULL,
    available_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    status text NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'running', 'sent', 'suppressed', 'exhausted')),
    attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    lease_id uuid,
    lease_until timestamptz,
    finished_at timestamptz,
    UNIQUE (message_id, subscription_id),
    CHECK ((lease_id IS NULL) = (lease_until IS NULL))
);

CREATE INDEX push_deliveries_pending ON push_deliveries (available_at, id)
    WHERE status IN ('pending', 'running');
CREATE INDEX push_deliveries_expiry ON push_deliveries (expires_at, id);
CREATE INDEX push_deliveries_exhausted ON push_deliveries (finished_at DESC, id)
    WHERE status = 'exhausted';
