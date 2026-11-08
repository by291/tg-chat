CREATE TYPE privacy_audience AS ENUM ('everyone', 'contacts', 'nobody');

ALTER TABLE users
    ADD COLUMN direct_message_audience privacy_audience NOT NULL DEFAULT 'everyone',
    ADD COLUMN call_audience privacy_audience NOT NULL DEFAULT 'contacts',
    ADD COLUMN presence_audience privacy_audience NOT NULL DEFAULT 'contacts';

CREATE TABLE contacts (
    owner_id UUID NOT NULL REFERENCES users(id),
    target_id UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (owner_id, target_id),
    CHECK (owner_id <> target_id)
);

CREATE TABLE blocks (
    owner_id UUID NOT NULL REFERENCES users(id),
    target_id UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (owner_id, target_id),
    CHECK (owner_id <> target_id)
);
