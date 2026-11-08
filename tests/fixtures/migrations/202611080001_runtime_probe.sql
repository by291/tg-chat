CREATE TABLE runtime_probe (
    id integer PRIMARY KEY,
    value text NOT NULL
);

INSERT INTO runtime_probe (id, value)
VALUES (1, 'preserved across migrations');
