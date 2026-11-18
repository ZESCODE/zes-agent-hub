-- ZESCODE Agent Orchestration Protocol v1 — foundation schema
-- Applied by server/lib/db/migrate.js

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  display_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS projects (
  id UUID PRIMARY KEY,
  owner_id UUID NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  description TEXT,
  repository_url TEXT,
  default_branch TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS jobs (
  id UUID PRIMARY KEY,
  project_id UUID REFERENCES projects(id),
  owner_id UUID NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  objective TEXT NOT NULL,
  workflow_type TEXT NOT NULL,
  status TEXT NOT NULL,
  current_phase TEXT,
  current_agent TEXT,
  approval_required BOOLEAN NOT NULL DEFAULT FALSE,
  retry_count INTEGER NOT NULL DEFAULT 0,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS tasks (
  id UUID PRIMARY KEY,
  job_id UUID NOT NULL REFERENCES jobs(id),
  parent_task_id UUID REFERENCES tasks(id),
  assigned_agent TEXT NOT NULL,
  task_type TEXT NOT NULL,
  objective TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  priority INTEGER NOT NULL DEFAULT 5,
  attempt INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  input JSONB NOT NULL DEFAULT '{}',
  expected_outputs JSONB NOT NULL DEFAULT '[]',
  acceptance_criteria JSONB NOT NULL DEFAULT '[]',
  result JSONB,
  locked_by TEXT,
  locked_until TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS approvals (
  id UUID PRIMARY KEY,
  job_id UUID NOT NULL REFERENCES jobs(id),
  task_id UUID REFERENCES tasks(id),
  requested_by TEXT NOT NULL,
  action_type TEXT NOT NULL,
  action_description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  requested_payload JSONB NOT NULL DEFAULT '{}',
  decided_by UUID REFERENCES users(id),
  decision_reason TEXT,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  decided_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS artifacts (
  id UUID PRIMARY KEY,
  job_id UUID NOT NULL REFERENCES jobs(id),
  task_id UUID REFERENCES tasks(id),
  artifact_type TEXT NOT NULL,
  name TEXT NOT NULL,
  storage_uri TEXT NOT NULL,
  content_type TEXT,
  checksum TEXT,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS agent_events (
  id UUID PRIMARY KEY,
  job_id UUID NOT NULL REFERENCES jobs(id),
  task_id UUID REFERENCES tasks(id),
  agent_id TEXT,
  event_type TEXT NOT NULL,
  event_version INTEGER NOT NULL DEFAULT 1,
  payload JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tool_executions (
  id UUID PRIMARY KEY,
  job_id UUID NOT NULL REFERENCES jobs(id),
  task_id UUID REFERENCES tasks(id),
  tool_name TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  requested_by TEXT NOT NULL,
  status TEXT NOT NULL,
  input JSONB NOT NULL DEFAULT '{}',
  result JSONB,
  error_code TEXT,
  error_message TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY,
  owner_id UUID REFERENCES users(id),
  job_id UUID REFERENCES jobs(id),
  actor_type TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL,
  resource_type TEXT,
  resource_id TEXT,
  details JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS model_usage (
  id UUID PRIMARY KEY,
  job_id UUID NOT NULL REFERENCES jobs(id),
  task_id UUID REFERENCES tasks(id),
  agent_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  input_tokens INTEGER,
  output_tokens INTEGER,
  estimated_cost NUMERIC(12, 6),
  latency_ms INTEGER,
  success BOOLEAN NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_jobs_owner_status ON jobs(owner_id, status);
CREATE INDEX IF NOT EXISTS idx_tasks_job_status ON tasks(job_id, status);
CREATE INDEX IF NOT EXISTS idx_tasks_agent_status ON tasks(assigned_agent, status);
CREATE INDEX IF NOT EXISTS idx_approvals_pending ON approvals(status, expires_at);
CREATE INDEX IF NOT EXISTS idx_agent_events_job_created ON agent_events(job_id, created_at);
CREATE INDEX IF NOT EXISTS idx_tool_executions_idempotency ON tool_executions(idempotency_key);
CREATE INDEX IF NOT EXISTS idx_audit_logs_job_created ON audit_logs(job_id, created_at);
CREATE INDEX IF NOT EXISTS idx_model_usage_job_created ON model_usage(job_id, created_at);
