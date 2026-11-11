ALTER TABLE messages ADD COLUMN body jsonb;

CREATE FUNCTION message_body_preview(body jsonb) RETURNS text
LANGUAGE sql IMMUTABLE STRICT
AS $$
    SELECT CASE body->>'kind'
        WHEN 'sticker' THEN 'Sticker'
        WHEN 'contact' THEN 'Contact: ' || (body->>'display_name')
    END
$$;
