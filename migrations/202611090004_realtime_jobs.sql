ALTER TABLE sync_wakeups
    ADD COLUMN status text NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'running', 'exhausted')),
    ADD COLUMN attempts integer NOT NULL DEFAULT 0,
    ADD COLUMN available_at timestamptz NOT NULL DEFAULT now(),
    ADD COLUMN lease_token uuid,
    ADD COLUMN lease_until timestamptz,
    ADD COLUMN last_error text;
CREATE INDEX sync_wakeups_due ON sync_wakeups (available_at) WHERE status <> 'exhausted';
CREATE INDEX personal_changes_retention ON personal_changes (created_at, user_id);
CREATE TABLE realtime_connections (
    client_id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users (id),
    session_id uuid NOT NULL REFERENCES sessions (id),
    expires_at timestamptz NOT NULL
);
CREATE INDEX realtime_connections_session ON realtime_connections (session_id);
