CREATE TABLE media_message_references (
    message_id uuid NOT NULL REFERENCES messages (id),
    occurrence_id uuid NOT NULL,
    file_id uuid NOT NULL REFERENCES media_files (id),
    position smallint NOT NULL CHECK (position BETWEEN 1 AND 10),
    PRIMARY KEY (message_id, occurrence_id),
    UNIQUE (message_id, position)
);

CREATE INDEX media_message_references_file ON media_message_references (file_id);
