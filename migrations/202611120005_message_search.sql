CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Only canonical text and captions enter the index. Structured bodies are stored separately.
CREATE INDEX messages_search_text
    ON messages USING gin (normalize(content->>'text', NFC) gin_trgm_ops)
    WHERE deleted_at IS NULL;

-- Candidate order matches the short search budget and the public search cursor.
CREATE INDEX messages_search_conversation_order
    ON messages (conversation_id, created_at DESC, id DESC)
    INCLUDE (sequence)
    WHERE deleted_at IS NULL;
