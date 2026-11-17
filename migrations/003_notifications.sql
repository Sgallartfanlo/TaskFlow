
-- ==========================================
-- TASKFLOW 2.8
-- SISTEMA DE NOTIFICACIONS
-- ==========================================

BEGIN;

-- Crear la taula de notificacions

CREATE TABLE IF NOT EXISTS notifications (
    id SERIAL PRIMARY KEY,

    user_id INTEGER NOT NULL
        REFERENCES users(id)
        ON DELETE CASCADE,

    project_id INTEGER
        REFERENCES projects(id)
        ON DELETE CASCADE,

    task_id INTEGER
        REFERENCES tasks(id)
        ON DELETE SET NULL,

    type VARCHAR(50) NOT NULL,

    title VARCHAR(200) NOT NULL,

    message TEXT NOT NULL,

    is_read BOOLEAN NOT NULL DEFAULT FALSE,

    created_at TIMESTAMPTZ NOT NULL
        DEFAULT CURRENT_TIMESTAMP
);

-- Índex per consultar notificacions
-- d'un usuari de manera eficient

CREATE INDEX IF NOT EXISTS idx_notifications_user
ON notifications(user_id);

-- Índex per consultar primer les
-- notificacions més recents

CREATE INDEX IF NOT EXISTS idx_notifications_user_created
ON notifications(user_id, created_at DESC);

-- Índex per gestionar les
-- notificacions no llegides

CREATE INDEX IF NOT EXISTS idx_notifications_unread
ON notifications(user_id)
WHERE is_read = FALSE;

COMMIT;
