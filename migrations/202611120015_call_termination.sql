-- Server events have a message identity but no user-controlled send operation.
ALTER TABLE message_identities ALTER COLUMN operation_id DROP NOT NULL;

CREATE TABLE call_termination_intents (
    call_id uuid PRIMARY KEY REFERENCES calls (id),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX call_termination_intents_created ON call_termination_intents (created_at, call_id);

CREATE TABLE call_history_work (
    call_id uuid PRIMARY KEY REFERENCES calls (id),
    revision bigint NOT NULL CHECK (revision > 0),
    message_id uuid NOT NULL UNIQUE,
    available_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    published_at timestamptz
);
CREATE INDEX call_history_work_pending ON call_history_work (available_at, call_id)
    WHERE published_at IS NULL;

CREATE TABLE call_room_cleanup (
    call_id uuid PRIMARY KEY REFERENCES calls (id),
    revision bigint NOT NULL CHECK (revision > 0),
    available_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX call_room_cleanup_pending ON call_room_cleanup (available_at, call_id);

-- Policy changes already own their account, session or conversation locks.
-- Write intent here so the Worker can acquire the conversation lock first.
CREATE FUNCTION invalidate_calls_for_account() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO call_termination_intents (call_id)
    SELECT call.id FROM call_slots slot JOIN calls call ON call.id = slot.call_id
    WHERE slot.user_id = NEW.id AND call.phase <> 'ended'
      AND ((NEW.is_suspended AND NOT OLD.is_suspended)
        OR (NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL)
        OR (NEW.call_audience <> OLD.call_audience AND call.phase = 'ringing'
            AND call.recipient_id = NEW.id AND (NEW.call_audience = 'nobody'
              OR (NEW.call_audience = 'contacts' AND NOT EXISTS (
                  SELECT 1 FROM contacts
                  WHERE owner_id = NEW.id AND target_id = call.caller_id
              )))))
    ON CONFLICT DO NOTHING;
    RETURN NEW;
END;
$$;

CREATE TRIGGER calls_account_policy AFTER UPDATE OF is_suspended, deleted_at, call_audience
    ON users FOR EACH ROW EXECUTE FUNCTION invalidate_calls_for_account();

CREATE FUNCTION invalidate_calls_for_session() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO call_termination_intents (call_id)
    SELECT call.id FROM call_slots slot JOIN calls call ON call.id = slot.call_id
    WHERE slot.user_id = NEW.user_id AND call.phase <> 'ended'
      AND (call.caller_session_id = NEW.id OR call.accepting_session_id = NEW.id)
    ON CONFLICT DO NOTHING;
    RETURN NEW;
END;
$$;

CREATE TRIGGER calls_session_revocation AFTER UPDATE OF revoked_at ON sessions
    FOR EACH ROW WHEN (OLD.revoked_at IS NULL AND NEW.revoked_at IS NOT NULL)
    EXECUTE FUNCTION invalidate_calls_for_session();

CREATE FUNCTION invalidate_calls_for_block() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO call_termination_intents (call_id)
    SELECT call.id FROM call_slots slot JOIN calls call ON call.id = slot.call_id
    WHERE slot.user_id = NEW.owner_id AND call.phase <> 'ended'
      AND ((call.caller_id = NEW.owner_id AND call.recipient_id = NEW.target_id)
        OR (call.recipient_id = NEW.owner_id AND call.caller_id = NEW.target_id))
    ON CONFLICT DO NOTHING;
    RETURN NEW;
END;
$$;

CREATE TRIGGER calls_block AFTER INSERT ON blocks
    FOR EACH ROW EXECUTE FUNCTION invalidate_calls_for_block();

CREATE FUNCTION invalidate_calls_for_contact_removal() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO call_termination_intents (call_id)
    SELECT call.id FROM call_slots slot JOIN calls call ON call.id = slot.call_id
    JOIN users recipient ON recipient.id = call.recipient_id
    WHERE slot.user_id = OLD.owner_id AND call.phase = 'ringing'
      AND call.recipient_id = OLD.owner_id AND call.caller_id = OLD.target_id
      AND recipient.call_audience = 'contacts'
    ON CONFLICT DO NOTHING;
    RETURN OLD;
END;
$$;

CREATE TRIGGER calls_contact_removal AFTER DELETE ON contacts
    FOR EACH ROW EXECUTE FUNCTION invalidate_calls_for_contact_removal();

CREATE INDEX calls_live_conversation ON calls (conversation_id) WHERE phase <> 'ended';

CREATE FUNCTION invalidate_calls_for_conversation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO call_termination_intents (call_id)
    SELECT id FROM calls WHERE conversation_id = NEW.id AND phase <> 'ended'
    ON CONFLICT DO NOTHING;
    RETURN NEW;
END;
$$;

CREATE TRIGGER calls_conversation_access AFTER UPDATE OF is_quarantined, deleted_at ON conversations
    FOR EACH ROW WHEN ((NEW.is_quarantined AND NOT OLD.is_quarantined)
                    OR (NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL))
    EXECUTE FUNCTION invalidate_calls_for_conversation();

-- The same eligibility test is used after locking and while selecting due Worker candidates.
CREATE FUNCTION call_access_invalidated(call_uuid uuid, idle_days bigint, observed_at timestamptz)
RETURNS boolean LANGUAGE sql STABLE AS $$
    SELECT EXISTS (SELECT 1 FROM call_termination_intents WHERE call_id = call_uuid)
      OR EXISTS (
        SELECT 1 FROM calls call
        JOIN sessions caller ON caller.id = call.caller_session_id
        LEFT JOIN sessions recipient ON recipient.id = call.accepting_session_id
        WHERE call.id = call_uuid AND (
          caller.revoked_at IS NOT NULL OR caller.expires_at <= observed_at
          OR caller.last_seen_at <= observed_at - idle_days * interval '1 day'
          OR recipient.revoked_at IS NOT NULL OR recipient.expires_at <= observed_at
          OR recipient.last_seen_at <= observed_at - idle_days * interval '1 day'
        )
      )
$$;
