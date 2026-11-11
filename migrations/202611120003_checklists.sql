CREATE TABLE message_checklists (
    message_id uuid PRIMARY KEY REFERENCES messages (id) ON DELETE CASCADE,
    title text NOT NULL CHECK (title <> ''),
    can_others_complete boolean NOT NULL,
    can_others_append boolean NOT NULL,
    list_version bigint NOT NULL DEFAULT 1 CHECK (list_version > 0)
);

CREATE TABLE message_checklist_tasks (
    message_id uuid NOT NULL REFERENCES message_checklists (message_id) ON DELETE CASCADE,
    id uuid NOT NULL,
    text text CHECK (text <> ''),
    position integer CHECK (position BETWEEN 1 AND 10),
    version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
    is_complete boolean NOT NULL DEFAULT false,
    completed_by uuid REFERENCES users (id) ON DELETE SET NULL,
    PRIMARY KEY (message_id, id),
    UNIQUE (message_id, position) DEFERRABLE INITIALLY DEFERRED,
    CHECK ((position IS NULL) = (text IS NULL)),
    CHECK (position IS NOT NULL OR NOT is_complete),
    CHECK (is_complete OR completed_by IS NULL)
);
