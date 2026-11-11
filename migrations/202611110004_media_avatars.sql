ALTER TABLE users ADD COLUMN avatar_file_id uuid REFERENCES media_files (id);
ALTER TABLE conversations ADD COLUMN avatar_file_id uuid REFERENCES media_files (id);

CREATE INDEX users_avatar_file ON users (avatar_file_id) WHERE avatar_file_id IS NOT NULL;
CREATE INDEX conversations_avatar_file ON conversations (avatar_file_id)
    WHERE avatar_file_id IS NOT NULL;

CREATE TABLE media_avatar_receipts (
    owner_id uuid NOT NULL REFERENCES users (id),
    operation_id uuid NOT NULL,
    expected_version bigint NOT NULL,
    file_id uuid REFERENCES media_files (id),
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (owner_id, operation_id)
);

CREATE INDEX media_avatar_receipts_retention ON media_avatar_receipts (created_at);
