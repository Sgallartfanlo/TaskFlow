
-- ==========================================
-- TASKFLOW 2.9
-- FASE B: FITXERS ADJUNTS
-- ==========================================

BEGIN;

CREATE TABLE IF NOT EXISTS task_attachments (
    id SERIAL PRIMARY KEY,

    task_id INTEGER NOT NULL
        REFERENCES tasks(id)
        ON DELETE CASCADE,

    uploaded_by INTEGER NOT NULL
        REFERENCES users(id),

    original_filename VARCHAR(255) NOT NULL,

    stored_filename VARCHAR(255) NOT NULL UNIQUE,

    content_type VARCHAR(150) NOT NULL,

    file_size BIGINT NOT NULL,

    created_at TIMESTAMPTZ NOT NULL
        DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT chk_attachment_size
        CHECK (file_size > 0),

    CONSTRAINT chk_attachment_filename
        CHECK (
            length(btrim(original_filename)) > 0
            AND length(btrim(stored_filename)) > 0
        )
);

-- Consultar els adjunts d'una tasca.

CREATE INDEX IF NOT EXISTS idx_task_attachments_task
ON task_attachments(task_id, created_at DESC);

-- Consultar els fitxers pujats per un usuari.

CREATE INDEX IF NOT EXISTS idx_task_attachments_user
ON task_attachments(uploaded_by);

COMMIT;
