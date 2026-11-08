ALTER TABLE conversation_members
    ADD COLUMN draft_version bigint NOT NULL DEFAULT 0,
    ADD COLUMN draft_content jsonb,
    ADD COLUMN draft_reply jsonb,
    ADD COLUMN keep_archived boolean NOT NULL DEFAULT false;
