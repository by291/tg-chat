ALTER TABLE conversations DROP CONSTRAINT conversations_kind_check;
ALTER TABLE conversations DROP CONSTRAINT conversations_check;
ALTER TABLE conversations ALTER COLUMN participant_low DROP NOT NULL;
ALTER TABLE conversations ALTER COLUMN participant_high DROP NOT NULL;
ALTER TABLE conversations ADD COLUMN owner_id uuid REFERENCES users (id)
    DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE conversations ADD COLUMN title text NOT NULL DEFAULT '';
ALTER TABLE conversations ADD COLUMN description text NOT NULL DEFAULT '';
ALTER TABLE conversations ADD COLUMN public_handle text;
ALTER TABLE conversations ADD COLUMN is_public boolean NOT NULL DEFAULT false;
ALTER TABLE conversations ADD COLUMN requires_approval boolean NOT NULL DEFAULT false;
ALTER TABLE conversations ADD COLUMN is_quarantined boolean NOT NULL DEFAULT false;
ALTER TABLE conversations ADD COLUMN deleted_at timestamptz;
ALTER TABLE conversations ADD CONSTRAINT conversations_kind_check
    CHECK (kind IN ('direct', 'saved', 'group', 'channel'));
ALTER TABLE conversations ADD CONSTRAINT conversations_shape_check CHECK (
    (kind = 'saved' AND participant_low = participant_high AND participant_low IS NOT NULL)
    OR (kind = 'direct' AND participant_low < participant_high AND participant_low IS NOT NULL
        AND participant_high IS NOT NULL)
    OR (kind IN ('group', 'channel') AND participant_low IS NULL AND participant_high IS NULL
        AND owner_id IS NOT NULL AND char_length(title) BETWEEN 1 AND 128)
);
ALTER TABLE conversations ADD CONSTRAINT conversations_public_handle_check CHECK (
    (public_handle IS NULL OR public_handle ~ '^[a-z0-9_]{3,32}$')
    AND (NOT is_public OR public_handle IS NOT NULL)
);
ALTER TABLE conversations ADD CONSTRAINT conversations_description_check
    CHECK (char_length(description) <= 2000);
CREATE UNIQUE INDEX conversations_public_handle ON conversations (public_handle)
    WHERE deleted_at IS NULL;

ALTER TABLE conversation_members ADD COLUMN role text NOT NULL DEFAULT 'member'
    CHECK (role IN ('owner', 'admin', 'member'));
ALTER TABLE conversation_members ADD COLUMN posting_muted_until timestamptz;
ALTER TABLE conversation_members ADD COLUMN is_banned boolean NOT NULL DEFAULT false;
