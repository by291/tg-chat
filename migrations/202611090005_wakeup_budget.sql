CREATE TABLE wakeup_queue_budget (
    singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
    capacity integer NOT NULL DEFAULT 10000 CHECK (capacity > 0)
);
INSERT INTO wakeup_queue_budget (singleton) VALUES (true);
CREATE FUNCTION enforce_wakeup_budget() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    maximum_pending integer;
BEGIN
    -- Serialize admission after ordered participant/head locks; publication only frees capacity.
    SELECT capacity INTO maximum_pending FROM wakeup_queue_budget FOR UPDATE;
    IF NOT EXISTS (SELECT 1 FROM sync_wakeups WHERE user_id = NEW.user_id)
        AND (SELECT count(*) FROM sync_wakeups) >= maximum_pending THEN
        RAISE EXCEPTION 'wakeup queue capacity reached' USING ERRCODE = '53000';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER sync_wakeup_budget BEFORE INSERT ON sync_wakeups
    FOR EACH ROW EXECUTE FUNCTION enforce_wakeup_budget();
