CREATE TYPE media_upload_purpose AS ENUM ('image', 'video', 'document', 'voice', 'avatar');
CREATE TYPE media_upload_state AS ENUM (
    'reserved', 'uploaded', 'processing', 'ready', 'rejected', 'cancelled', 'expired'
);

-- Admissions share this row so separate account locks cannot overbook deployment storage.
CREATE TABLE media_quota_lock (
    singleton boolean PRIMARY KEY CHECK (singleton)
);

INSERT INTO media_quota_lock (singleton) VALUES (true);

CREATE TABLE media_uploads (
    id uuid PRIMARY KEY,
    owner_id uuid NOT NULL REFERENCES users (id),
    session_id uuid NOT NULL REFERENCES sessions (id),
    purpose media_upload_purpose NOT NULL,
    file_name text NOT NULL,
    size_bytes bigint NOT NULL CHECK (size_bytes > 0),
    sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
    state media_upload_state NOT NULL DEFAULT 'reserved',
    expires_at timestamptz NOT NULL,
    released_at timestamptz,
    last_write_expires_at timestamptz,
    multipart_id text,
    claim_id uuid,
    claim_until timestamptz,
    file_id uuid,
    error_code text,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK ((claim_id IS NULL) = (claim_until IS NULL))
);

CREATE INDEX media_uploads_charged_owner ON media_uploads (owner_id)
    WHERE released_at IS NULL;

CREATE INDEX media_uploads_cleanup ON media_uploads (expires_at)
    WHERE released_at IS NULL;

CREATE TABLE media_preparation_jobs (
    upload_id uuid PRIMARY KEY REFERENCES media_uploads (id),
    available_at timestamptz NOT NULL DEFAULT now(),
    lease_id uuid,
    lease_until timestamptz,
    attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    CHECK ((lease_id IS NULL) = (lease_until IS NULL))
);

CREATE INDEX media_preparation_jobs_due ON media_preparation_jobs (available_at);
