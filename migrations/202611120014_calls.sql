CREATE TABLE calls (
    id uuid PRIMARY KEY,
    conversation_id uuid NOT NULL REFERENCES conversations (id),
    caller_id uuid NOT NULL REFERENCES users (id),
    recipient_id uuid NOT NULL REFERENCES users (id),
    caller_session_id uuid NOT NULL REFERENCES sessions (id),
    accepting_session_id uuid REFERENCES sessions (id),
    mode text NOT NULL CHECK (mode IN ('voice', 'video')),
    phase text NOT NULL CHECK (phase IN ('ringing', 'connecting', 'active', 'ended')),
    revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
    created_at timestamptz NOT NULL,
    ringing_deadline timestamptz NOT NULL,
    accepted_at timestamptz,
    setup_deadline timestamptz,
    active_at timestamptz,
    ended_at timestamptz,
    end_reason text CHECK (end_reason IN (
        'declined', 'cancelled', 'missed', 'completed', 'permission_denied',
        'transport_failed', 'access_revoked'
    )),
    CHECK (caller_id <> recipient_id),
    CHECK ((accepting_session_id IS NULL) = (accepted_at IS NULL)),
    CHECK ((accepting_session_id IS NULL) = (setup_deadline IS NULL)),
    CHECK (phase NOT IN ('connecting', 'active') OR accepting_session_id IS NOT NULL),
    CHECK (phase <> 'active' OR active_at IS NOT NULL),
    CHECK ((phase = 'ended') = (ended_at IS NOT NULL)),
    CHECK ((phase = 'ended') = (end_reason IS NOT NULL))
);

CREATE INDEX calls_caller_admission ON calls (caller_id, created_at DESC);
CREATE INDEX calls_ringing_deadlines ON calls (ringing_deadline, id) WHERE phase = 'ringing';
CREATE INDEX calls_setup_deadlines ON calls (setup_deadline, id) WHERE phase = 'connecting';

CREATE TABLE call_slots (
    user_id uuid PRIMARY KEY REFERENCES users (id),
    call_id uuid NOT NULL REFERENCES calls (id)
);

CREATE INDEX call_slots_by_call ON call_slots (call_id);

-- Taking this row only for new calls serializes deployment-wide capacity across API replicas.
CREATE TABLE call_admission (
    singleton boolean PRIMARY KEY CHECK (singleton)
);

INSERT INTO call_admission (singleton) VALUES (true);

CREATE TABLE call_operation_receipts (
    user_id uuid NOT NULL REFERENCES users (id),
    operation_id uuid NOT NULL,
    session_id uuid NOT NULL REFERENCES sessions (id),
    call_id uuid NOT NULL REFERENCES calls (id),
    request jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (user_id, operation_id)
);

CREATE INDEX call_operation_receipts_expiry ON call_operation_receipts (user_id, created_at);
