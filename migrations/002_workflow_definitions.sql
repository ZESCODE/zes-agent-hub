-- ZESCODE workflow definitions (zes.workflow/v1)
-- The hub owns workflow definitions and the snapshot each job runs against.

CREATE TABLE IF NOT EXISTS workflow_definitions (
  id UUID PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  contract_version TEXT NOT NULL,
  definition JSONB NOT NULL,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  published_at TIMESTAMPTZ,
  UNIQUE (workflow_id, version)
);

CREATE TABLE IF NOT EXISTS workflow_runs (
  id UUID PRIMARY KEY,
  job_id UUID NOT NULL UNIQUE REFERENCES jobs(id),
  workflow_definition_id UUID NOT NULL REFERENCES workflow_definitions(id),
  workflow_id TEXT NOT NULL,
  workflow_version INTEGER NOT NULL,
  contract_version TEXT NOT NULL,
  graph_snapshot JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'planned',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

ALTER TABLE jobs ADD COLUMN IF NOT EXISTS workflow_definition_id UUID REFERENCES workflow_definitions(id);
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS workflow_id TEXT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS workflow_version INTEGER;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS workflow_run_id UUID REFERENCES workflow_runs(id);

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS node_id TEXT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS node_type TEXT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS task_kind TEXT NOT NULL DEFAULT 'agent';
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS depends_on JSONB NOT NULL DEFAULT '[]';
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS next_attempt_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_workflow_definitions_workflow ON workflow_definitions(workflow_id, version DESC);
CREATE INDEX IF NOT EXISTS idx_workflow_definitions_status ON workflow_definitions(status);
CREATE INDEX IF NOT EXISTS idx_workflow_runs_job ON workflow_runs(job_id);
CREATE INDEX IF NOT EXISTS idx_tasks_node ON tasks(job_id, node_id);
CREATE INDEX IF NOT EXISTS idx_tasks_ready ON tasks(job_id, status, next_attempt_at);
