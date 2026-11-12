ALTER TABLE calls ADD COLUMN reconnect_deadline timestamptz;
CREATE INDEX calls_reconnect_deadlines ON calls (reconnect_deadline, id)
    WHERE phase = 'active' AND reconnect_deadline IS NOT NULL;

ALTER TABLE call_rooms
    ADD COLUMN probe_after timestamptz NOT NULL DEFAULT clock_timestamp(),
    ADD COLUMN probe_started_at timestamptz,
    ADD COLUMN probe_lease_id uuid,
    ADD COLUMN probe_lease_until timestamptz,
    ADD CHECK ((probe_lease_id IS NULL) = (probe_lease_until IS NULL));

CREATE INDEX call_rooms_probe_due ON call_rooms (probe_after, call_id)
    WHERE provider_sid IS NOT NULL;

CREATE TABLE call_webhook_receipts (
    event_id text PRIMARY KEY,
    call_id uuid NOT NULL REFERENCES calls (id),
    received_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
