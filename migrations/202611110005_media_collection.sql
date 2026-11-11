ALTER TABLE media_uploads ADD COLUMN cleanup_after timestamptz;
ALTER TABLE media_processing_attempts ADD COLUMN cleanup_after timestamptz;
ALTER TABLE media_files ADD COLUMN cleanup_after timestamptz;

CREATE INDEX media_files_collection ON media_files (ready_until) WHERE deleted_at IS NULL;
CREATE INDEX media_attempts_collection ON media_processing_attempts (created_at)
    WHERE released_at IS NULL;

CREATE VIEW media_live_file_references AS
    SELECT reference.file_id FROM media_message_references reference
    JOIN messages message ON message.id = reference.message_id
    JOIN conversations conversation ON conversation.id = message.conversation_id
    WHERE conversation.deleted_at IS NULL AND message.deleted_at IS NULL
      AND (message.expires_at IS NULL OR message.expires_at > now())
    UNION ALL
    SELECT avatar_file_id FROM users WHERE avatar_file_id IS NOT NULL
    UNION ALL
    SELECT avatar_file_id FROM conversations
    WHERE avatar_file_id IS NOT NULL AND deleted_at IS NULL;
