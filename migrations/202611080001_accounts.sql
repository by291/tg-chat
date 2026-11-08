CREATE TABLE registration_policy (
    singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
    is_open boolean NOT NULL DEFAULT true
);

INSERT INTO registration_policy (singleton, is_open) VALUES (true, true);

CREATE TABLE users (
    id uuid PRIMARY KEY,
    username text NOT NULL UNIQUE CHECK (username ~ '^[a-z0-9_]{3,32}$'),
    password_hash text NOT NULL,
    credential_version bigint NOT NULL DEFAULT 1,
    display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 80),
    biography text NOT NULL DEFAULT '' CHECK (char_length(biography) <= 500),
    phone text CHECK (char_length(phone) <= 40),
    is_operator boolean NOT NULL DEFAULT false,
    is_suspended boolean NOT NULL DEFAULT false,
    profile_version bigint NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users (id),
    token_hash bytea NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
    device_name text NOT NULL CHECK (char_length(device_name) BETWEEN 1 AND 100),
    created_at timestamptz NOT NULL DEFAULT now(),
    last_seen_at timestamptz NOT NULL DEFAULT now(),
    authenticated_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    revoked_at timestamptz
);

CREATE INDEX sessions_active_user ON sessions (user_id, created_at DESC)
    WHERE revoked_at IS NULL;
