-- Attempts register their object namespace before making any externally visible writes.
CREATE TABLE media_processing_attempts (
    id uuid PRIMARY KEY,
    upload_id uuid NOT NULL REFERENCES media_uploads (id),
    created_at timestamptz NOT NULL DEFAULT now(),
    variant_bytes bigint NOT NULL DEFAULT 0 CHECK (variant_bytes >= 0),
    released_at timestamptz
);

CREATE INDEX media_processing_attempts_upload ON media_processing_attempts (upload_id);

CREATE TABLE media_files (
    id uuid PRIMARY KEY REFERENCES media_processing_attempts (id),
    upload_id uuid UNIQUE NOT NULL REFERENCES media_uploads (id),
    size_bytes bigint NOT NULL CHECK (size_bytes > 0),
    width integer CHECK (width > 0),
    height integer CHECK (height > 0),
    duration_ms bigint CHECK (duration_ms > 0),
    waveform smallint[],
    ready_until timestamptz NOT NULL,
    deleting_at timestamptz,
    deleted_at timestamptz,
    CHECK ((width IS NULL) = (height IS NULL))
);

ALTER TABLE media_uploads ADD FOREIGN KEY (file_id) REFERENCES media_files (id);
ALTER TABLE media_uploads ADD COLUMN staging_released_at timestamptz;

CREATE TYPE media_variant_kind AS ENUM ('original', 'thumbnail', 'poster', 'playback');

CREATE TABLE media_variants (
    file_id uuid NOT NULL REFERENCES media_files (id),
    kind media_variant_kind NOT NULL,
    mime_type text NOT NULL,
    size_bytes bigint NOT NULL CHECK (size_bytes > 0),
    PRIMARY KEY (file_id, kind)
);
