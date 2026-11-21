# ZESCODE Integration Directive — Database Integration Plan

The hub stores everything in one Postgres database. The directive added two tables and
four columns to the v1 schema; no v1 table was dropped, renamed or changed in a way that
breaks an existing row.

## 1. Schema after the directive

```text
users
projects
jobs                -- v1 table, extended with four workflow columns
tasks               -- v1 table, used unchanged for workflow tasks
approvals           -- v1 table, used unchanged for approval gates
artifacts           -- v1 table, used unchanged for tool results and reports
agent_events        -- v1 table, the event timeline of a run
tool_executions     -- v1 table, one row per tool call
audit_logs          -- v1 table, the audit trail of a run
model_usage         -- v1 table, the spend of a run
workflow_definitions -- new: every version of every workflow
workflow_runs       -- new: the pinned graph snapshot of a job
```

## 2. New tables

### 2.1 `workflow_definitions`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | UUID | Primary key |
| `workflow_id` | TEXT | The stable identifier, for example `scout-zescode-zes-builder` |
| `version` | INTEGER | Monotonic per `workflow_id` |
| `name` | TEXT | Display name |
| `description` | TEXT | Optional |
| `status` | TEXT | `draft` or `published`; a published version is immutable |
| `contract_version` | TEXT | Always `zes.workflow/v1` |
| `definition` | JSONB | The canonical definition |
| `created_by` | UUID | References `users(id)` |
| `created_at`, `updated_at`, `published_at` | TIMESTAMPTZ | Bookkeeping |

Constraint: `UNIQUE (workflow_id, version)`.

### 2.2 `workflow_runs`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | UUID | Primary key |
| `job_id` | UUID | `UNIQUE REFERENCES jobs(id)` — one run per job |
| `workflow_definition_id` | UUID | References `workflow_definitions(id)` |
| `workflow_id` | TEXT | Denormalised for queries |
| `workflow_version` | INTEGER | The version the job runs |
| `contract_version` | TEXT | The contract of the snapshot |
| `graph_snapshot` | JSONB | The exact definition the job runs |
| `status` | TEXT | `planned`, `running`, `completed`, `failed` |
| `created_at`, `updated_at`, `completed_at` | TIMESTAMPTZ | Bookkeeping |

The snapshot is the reason a published version can never change the meaning of a running
job: the job reads its own copy.

### 2.3 Columns added to `jobs`

| Column | Type | Purpose |
| --- | --- | --- |
| `workflow_definition_id` | UUID | The definition the job came from |
| `workflow_id` | TEXT | The stable workflow identifier |
| `workflow_version` | INTEGER | The version the job pins |
| `workflow_run_id` | UUID | The run record with the graph snapshot |

All four are nullable, so a v1 job that was created without a workflow keeps working.

## 3. How a job is written

```text
POST /api/v1/jobs
  → workflow_runs row (graph_snapshot = the published definition)
  → jobs row (workflow_id, workflow_version, workflow_definition_id, workflow_run_id)
  → POST /api/v1/jobs/:id/plan
      → tasks rows, one per node, with node_id, node_type, task_kind,
        assigned_agent, priority and depends_on
```

## 4. Reading for the builder

| View | Query | Source |
| --- | --- | --- |
| Workflow library | definitions with their latest version and status | `workflow_definitions` |
| Versions | all versions of one `workflow_id` | `workflow_definitions` |
| Run detail | tasks of the job | `tasks` |
| Artifacts | tool results, verification report, final report | `artifacts` |
| Timeline | events of the job | `agent_events` |
| Spend | model calls and estimated cost | `model_usage` |
| Approvals | open approvals | `approvals` |

## 5. Deleting a workflow

`DELETE /api/v1/workflows/:workflowId` runs in one transaction:

1. `jobs.workflow_definition_id` and `jobs.workflow_run_id` are set to `NULL`.
2. The `workflow_runs` rows are deleted.
3. Every version of the definition is deleted.

A workflow that an **active** job still uses is not deleted: the service raises
`WorkflowInUseError` and the API answers `409`. The history of finished jobs stays
readable, because the job rows keep their objective, their tasks and their artifacts.

## 6. Migrations

| Migration | Content |
| --- | --- |
| `migrations/001_zap_v1.sql` | The v1 foundation, unchanged |
| `migrations/002_workflow_definitions.sql` | The two tables and the four columns |

Migrations are applied by `server/lib/db/migrate.js` on start. Both use
`CREATE TABLE IF NOT EXISTS` and `ADD COLUMN IF NOT EXISTS`, so applying them twice is
safe.

## 7. Growth and safety

- A task row is written once per node and updated through its state machine; the
  `locked_by` and `locked_until` columns are the lease that prevents two workers from
  running the same task.
- Tool calls are idempotent per `(job, node, tool)`: `tool_executions` holds the
  idempotency key and the result, so a replayed task does not call the tool twice.
- The audit trail and the event timeline are append only.
- The database connection pool is configured through `DATABASE_URL` and lives in the
  Render and Vercel environments; no credential is stored in the repository.
