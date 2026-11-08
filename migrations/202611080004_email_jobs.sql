ALTER TABLE users
    ADD COLUMN verified_email TEXT UNIQUE,
    ADD COLUMN email_version BIGINT NOT NULL DEFAULT 1;

CREATE TABLE email_challenges (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id),
    purpose TEXT NOT NULL CHECK (purpose IN ('verification', 'recovery')),
    target_email TEXT NOT NULL,
    token_hash BYTEA NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
    credential_version BIGINT NOT NULL,
    email_version BIGINT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX email_challenges_user ON email_challenges (user_id, purpose)
WHERE consumed_at IS NULL;

-- Serialize queue admission without locking jobs while the Worker talks to SMTP.
CREATE TABLE mail_queue_budget (
    singleton BOOLEAN PRIMARY KEY DEFAULT true CHECK (singleton)
);
INSERT INTO mail_queue_budget (singleton) VALUES (true);

CREATE TABLE mail_jobs (
    id UUID PRIMARY KEY,
    challenge_id UUID NOT NULL REFERENCES email_challenges(id),
    ciphertext BYTEA NOT NULL,
    nonce BYTEA NOT NULL CHECK (octet_length(nonce) = 12),
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'running', 'sent', 'discarded', 'exhausted')),
    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
    available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    lease_token UUID,
    lease_until TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at TIMESTAMPTZ
);

CREATE INDEX mail_jobs_available ON mail_jobs (available_at, created_at)
WHERE status IN ('pending', 'running');
