-- TASKFLOW 3.0 · executar UNA SOLA VEGADA abans de reconstruir el backend
BEGIN;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS start_date DATE;

CREATE TABLE IF NOT EXISTS subtasks (
  id SERIAL PRIMARY KEY,
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  title VARCHAR(200) NOT NULL,
  is_done BOOLEAN NOT NULL DEFAULT FALSE,
  assignee_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_subtask_title CHECK (length(btrim(title)) > 0)
);
CREATE INDEX IF NOT EXISTS idx_subtasks_task ON subtasks(task_id, position);

CREATE TABLE IF NOT EXISTS task_dependencies (
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  depends_on_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, depends_on_id),
  CONSTRAINT chk_distinct_tasks CHECK (task_id <> depends_on_id)
);

CREATE TABLE IF NOT EXISTS activity_logs (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action VARCHAR(60) NOT NULL,
  description VARCHAR(500) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_activity_project ON activity_logs(project_id, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS recurrence_rules (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  title VARCHAR(200) NOT NULL,
  frequency VARCHAR(10) NOT NULL CHECK (frequency IN ('daily','weekly','monthly')),
  next_run DATE NOT NULL,
  priority VARCHAR(10) NOT NULL DEFAULT 'mitjana',
  assignee_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_recurrence_due ON recurrence_rules(enabled, next_run);

CREATE TABLE IF NOT EXISTS recurrence_runs (
  id SERIAL PRIMARY KEY,
  rule_id INTEGER NOT NULL REFERENCES recurrence_rules(id) ON DELETE CASCADE,
  scheduled_for DATE NOT NULL,
  task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
  CONSTRAINT uq_recurrence_occurrence UNIQUE(rule_id, scheduled_for)
);
COMMIT;
