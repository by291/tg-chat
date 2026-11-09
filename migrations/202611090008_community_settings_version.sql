-- Chat activity must not create metadata-edit conflicts, and stale forms must not undo privacy.
ALTER TABLE conversations ADD COLUMN settings_version bigint NOT NULL DEFAULT 1;
