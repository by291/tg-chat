CREATE TABLE call_rooms (
    call_id uuid PRIMARY KEY REFERENCES calls (id),
    room_name text NOT NULL UNIQUE,
    caller_identity uuid NOT NULL UNIQUE,
    recipient_identity uuid NOT NULL UNIQUE,
    provider_sid text,
    create_after timestamptz NOT NULL DEFAULT clock_timestamp(),
    create_lease_id uuid,
    create_lease_until timestamptz,
    cleanup_safe_at timestamptz,
    CHECK (caller_identity <> recipient_identity),
    CHECK ((create_lease_id IS NULL) = (create_lease_until IS NULL))
);

CREATE INDEX call_rooms_create_due ON call_rooms (create_after, call_id)
    WHERE provider_sid IS NULL;

ALTER TABLE call_room_cleanup
    ADD COLUMN lease_id uuid,
    ADD COLUMN lease_until timestamptz,
    ADD CHECK ((lease_id IS NULL) = (lease_until IS NULL));
