CREATE TABLE account_storage_limits (
    user_id uuid PRIMARY KEY REFERENCES users (id),
    limit_bytes bigint NOT NULL CHECK (limit_bytes > 0)
);
