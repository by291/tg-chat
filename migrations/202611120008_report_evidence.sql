CREATE TABLE moderation_cases (
    id uuid PRIMARY KEY,
    reporter_id uuid NOT NULL REFERENCES users(id),
    conversation_id uuid NOT NULL REFERENCES conversations(id),
    message_id uuid NOT NULL,
    reported_author_id uuid NOT NULL REFERENCES users(id),
    reason text NOT NULL CHECK (reason IN ('spam', 'harassment', 'harmful_content', 'other')),
    created_at timestamptz NOT NULL,
    evidence_expires_at timestamptz NOT NULL,
    resolved_at timestamptz,
    UNIQUE (reporter_id, message_id),
    CHECK (evidence_expires_at > created_at)
);

CREATE INDEX moderation_cases_queue ON moderation_cases (created_at DESC, id DESC);
CREATE INDEX moderation_cases_reporter_limit ON moderation_cases (reporter_id, created_at DESC);
CREATE INDEX moderation_cases_evidence_deadline ON moderation_cases (evidence_expires_at, id);

CREATE TABLE moderation_evidence (
    case_id uuid PRIMARY KEY REFERENCES moderation_cases(id) ON DELETE CASCADE,
    message_version bigint NOT NULL CHECK (message_version > 0),
    message_text text NOT NULL,
    structured_body jsonb,
    reporter_note text NOT NULL DEFAULT ''
);

CREATE TABLE moderation_report_receipts (
    reporter_id uuid NOT NULL REFERENCES users(id),
    operation_id uuid NOT NULL,
    case_id uuid NOT NULL REFERENCES moderation_cases(id),
    payload_hash bytea NOT NULL CHECK (octet_length(payload_hash) = 32),
    PRIMARY KEY (reporter_id, operation_id)
);

CREATE TABLE media_evidence_references (
    case_id uuid NOT NULL REFERENCES moderation_evidence(case_id) ON DELETE CASCADE,
    occurrence_id uuid NOT NULL,
    file_id uuid NOT NULL REFERENCES media_files(id),
    position smallint NOT NULL CHECK (position BETWEEN 1 AND 10),
    PRIMARY KEY (case_id, occurrence_id),
    UNIQUE (case_id, position)
);

CREATE INDEX media_evidence_references_file ON media_evidence_references (file_id);

ALTER TABLE media_files ADD COLUMN derivatives_deleting_at timestamptz;
