CREATE TABLE operator_audit (
    id UUID PRIMARY KEY,
    actor TEXT NOT NULL,
    action TEXT NOT NULL,
    target_user_id UUID REFERENCES users(id),
    reason TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Ordinary SQL mutations must not silently erase the history of privileged changes.
CREATE FUNCTION reject_operator_audit_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'operator audit is append-only';
END;
$$;

CREATE TRIGGER operator_audit_append_only
BEFORE UPDATE OR DELETE OR TRUNCATE ON operator_audit
FOR EACH STATEMENT EXECUTE FUNCTION reject_operator_audit_mutation();
