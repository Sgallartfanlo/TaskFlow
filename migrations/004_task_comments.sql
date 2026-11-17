
-- ==========================================
-- TASKFLOW 2.9
-- FASE A: COMENTARIS A LES TASQUES
-- ==========================================

BEGIN;

CREATE TABLE IF NOT EXISTS task_comments (
    id SERIAL PRIMARY KEY,

    task_id INTEGER NOT NULL
        REFERENCES tasks(id)
        ON DELETE CASCADE,

    user_id INTEGER NOT NULL
        REFERENCES users(id)
        ON DELETE CASCADE,

    content TEXT NOT NULL,

    created_at TIMESTAMPTZ NOT NULL
        DEFAULT CURRENT_TIMESTAMP,

    updated_at TIMESTAMPTZ,

    CONSTRAINT chk_comment_content
        CHECK (length(btrim(content)) > 0)
);

-- Consultar els comentaris d'una tasca
-- ordenats cronològicament.

CREATE INDEX IF NOT EXISTS idx_task_comments_task_date
ON task_comments(task_id, created_at, id);

-- Consultar els comentaris d'un usuari.

CREATE INDEX IF NOT EXISTS idx_task_comments_user
ON task_comments(user_id);

COMMIT;
