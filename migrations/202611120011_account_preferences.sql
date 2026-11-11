ALTER TABLE users ADD COLUMN account_settings_version BIGINT NOT NULL DEFAULT 1;

CREATE TABLE account_preferences (
    user_id UUID PRIMARY KEY REFERENCES users (id),
    notification_defaults JSONB NOT NULL,
    sticker_pack_ids TEXT[] NOT NULL
);

-- Keep all writers of account-owned settings on one revision, including email confirmation.
CREATE FUNCTION advance_account_settings_version() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    NEW.account_settings_version := OLD.account_settings_version + 1;
    RETURN NEW;
END;
$$;

CREATE TRIGGER account_settings_version_on_change
BEFORE UPDATE OF display_name, biography, phone, avatar_file_id, direct_message_audience,
    call_audience, presence_audience, verified_email ON users
FOR EACH ROW WHEN (
    ROW(NEW.display_name, NEW.biography, NEW.phone, NEW.avatar_file_id,
        NEW.direct_message_audience, NEW.call_audience, NEW.presence_audience, NEW.verified_email)
    IS DISTINCT FROM
    ROW(OLD.display_name, OLD.biography, OLD.phone, OLD.avatar_file_id,
        OLD.direct_message_audience, OLD.call_audience, OLD.presence_audience, OLD.verified_email)
)
EXECUTE FUNCTION advance_account_settings_version();
