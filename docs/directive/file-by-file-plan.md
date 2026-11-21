# ZESCODE Integration Directive — File by File Plan

Path prefixes: `hub/` = `ZESCODE/zes-agent-hub`, `builder/` = `ZESCODE/zes-builder`.

## 1. Hub — workflow core

| File | Responsibility | State |
| --- | --- | --- |
| `hub/server/lib/workflows/contract.js` | Validates a definition against `zes.workflow/v1`: version, nodes, edges, cycle, node types, agent permissions, task types, tools, acceptance criteria | done |
| `hub/server/lib/workflows/node-types.js` | The 13 node types with agent, `requiredPermissions` and accepted tools; the tool registry and `toolPermissions` | done |
| `hub/server/lib/workflows/graph.js` | `topologicalOrder`, `dependenciesOf`, `materializeTasks`, the tool owner map | done |
| `hub/server/lib/workflows/definition-service.js` | Create, publish, version, delete a definition; materialise a job; resolve the graph snapshot | done |
| `hub/server/lib/workflows/engine.js` | Job and task transitions, approvals, artifacts, events, audit | reused from v1 |
| `hub/server/lib/workflows/conditions.js` | Evaluation of a condition node | done |
| `hub/server/lib/workflows/transitions.js` | Allowed job and task states | reused from v1 |
| `hub/server/lib/repositories/workflows.js` | Storage for definitions and runs | done |
| `hub/migrations/002_workflow_definitions.sql` | `workflow_definitions`, `workflow_runs`, four columns on `jobs` | done |

## 2. Hub — execution and governance

| File | Responsibility | State |
| --- | --- | --- |
| `hub/server/lib/tools/registry.js` | Tool catalogue, `canUse`, permission gate, `github.repository.read` with listing, `deployment.publish` | done |
| `hub/server/lib/agents/registry.js` | Agent roles and `permissionsForAgent` | done |
| `hub/server/lib/orchestrator/scheduler.js` | Claims tasks, runs tool, agent, approval and condition tasks, upstream and artifact context, retry after backoff, blocked tasks on denied tools | done |
| `hub/server/lib/orchestrator/model-runner.js` | Builds the prompt from the objective, the evidence and the artifacts; records the model usage | done |
| `hub/server/lib/providers/router.js` | Task type to model route; `knownTaskTypes` | done |
| `hub/server/pollinations-client.js` | Provider client, credit detection, free model fallback, request deadlines | done |
| `hub/server/lib/api/v1.js` | The API surface below | done |

### 2.1 API surface

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/v1/node-types` | Node type catalogue and tool list |
| `GET` | `/api/v1/workflows` | List definitions |
| `POST` | `/api/v1/workflows` | Create a draft version |
| `GET` | `/api/v1/workflows/:workflowId` | One definition with its versions |
| `POST` | `/api/v1/workflows/:workflowId/publish` | Publish a version |
| `DELETE` | `/api/v1/workflows/:workflowId` | Delete a workflow, detach its runs and jobs |
| `POST` | `/api/v1/jobs` | Start a job from a published definition |
| `GET` | `/api/v1/jobs/:jobId` | Job with its tasks |
| `GET` | `/api/v1/jobs/:jobId/graph` | The pinned graph snapshot |
| `POST` | `/api/v1/jobs/:jobId/plan` | Materialise the tasks |
| `POST` | `/api/v1/jobs/:jobId/run-next` | Run the next eligible task |
| `GET` | `/api/v1/jobs/:jobId/tasks` | Tasks of a job |
| `GET` | `/api/v1/jobs/:jobId/artifacts` | Artifacts of a job |
| `GET` | `/api/v1/jobs/:jobId/events` | Event timeline |
| `GET` | `/api/v1/jobs/:jobId/usage` | Model spend of a job |
| `POST` | `/api/v1/jobs/:jobId/pause` · `/resume` · `/cancel` | Job controls |
| `GET` | `/api/v1/approvals` | Open approvals |
| `POST` | `/api/v1/approvals/:id/approve` · `/reject` | Decide an approval |

## 3. Builder — contract and surfaces

| File | Responsibility | State |
| --- | --- | --- |
| `builder/app/lib/workflows/contract.ts` | The client mirror: `createDefinition`, `defaultConfigFor`, `validateDefinition`, `toHubPayload` | done |
| `builder/app/lib/workflows/scout.ts` | `parseRepoUrl`, `scoutWorkflowId`, `createScoutDefinition` | done |
| `builder/app/lib/hub.server.ts` | Server-side hub client; one function per hub call | done |
| `builder/app/lib/whop.server.ts` | The access gate | reused |
| `builder/app/components/zap/WorkflowLibrary.tsx` | The workflow list with status, versions, publish date, open, start, delete | done |
| `builder/app/components/zap/RunDetail.tsx` | Tasks, results, acceptance criteria, artifacts, event timeline, spend | done |
| `builder/app/components/zap/ScoutLauncher.tsx` | GitHub URL to a published workflow and a running job | done |
| `builder/app/routes/zap.tsx` | The workflow surface of the builder | done |
| `builder/app/routes/zap.canvas.tsx` | The canvas with the job overlay | done |
| `builder/app/routes.ts` | Route table | done |

### 3.1 Builder proxy routes

| File | Hub call |
| --- | --- |
| `builder/app/routes/api.zap.workflows.ts` | `GET /workflows` |
| `builder/app/routes/api.zap.workflows.$workflowId.ts` | `GET /workflows/:id`, `DELETE /workflows/:id` |
| `builder/app/routes/api.zap.workflows.$workflowId.publish.ts` | `POST /workflows/:id/publish` |
| `builder/app/routes/api.zap.jobs.create.ts` | `POST /jobs` |
| `builder/app/routes/api.zap.jobs.$jobId.ts` | `GET /jobs/:id` |
| `builder/app/routes/api.zap.jobs.$jobId.tasks.ts` | `GET /jobs/:id/tasks` |
| `builder/app/routes/api.zap.jobs.$jobId.artifacts.ts` | `GET /jobs/:id/artifacts` |
| `builder/app/routes/api.zap.jobs.$jobId.events.ts` | `GET /jobs/:id/events` |
| `builder/app/routes/api.zap.jobs.$jobId.control.ts` | `POST /jobs/:id/pause|resume|cancel` |
| `builder/app/routes/api.zap.approvals.ts` | `GET /approvals` |
| `builder/app/routes/api.zap.approvals.$approvalId.ts` | `POST /approvals/:id/approve|reject` |
| `builder/app/routes/api.zap.node-types.ts` | `GET /node-types` |

Every one of these routes calls `requireAccess` first, so the gate protects the data as
well as the pages.

## 4. Tests

| File | Covers |
| --- | --- |
| `hub/tests/unit/workflow-contract.test.js` | Contract rules and the Scout template against the hub registry |
| `hub/tests/unit/workflow-context.test.js` | The objective reaches every task |
| `hub/tests/unit/tool-permissions.test.js` | The permission gate and the tool owner map |
| `hub/tests/unit/github-tool.test.js` | The repository listing |
| `hub/tests/unit/pollinations-client.test.js` | The free model fallback (skipped without a key) |
| `hub/tests/unit/conditions.test.js`, `transitions.test.js`, `db-pool.test.js` | The reused v1 rules |
| `hub/tests/integration/workflow-api.test.js`, `api.test.js`, `orchestration.test.js`, `persistence.test.js`, `workflow-execution.test.js` | The API, the execution, the persistence |
| `builder/tests/unit/whop-gate.test.ts` | The gate on every route |
| `builder/tests/unit/workflow-contract.test.ts` | The client mirror and the payload mapping |
| `builder/tests/unit/scout-template.test.ts` | The Scout template |

## 5. Sequence that was followed

1. Contract and node types in the hub, then the client mirror in the builder.
2. Storage and the definition service, then the API.
3. The scheduler: planning, running, upstream context, retry, blocking.
4. The builder surfaces: library, run detail, overlay, approvals, controls.
5. The acceptance milestone: the Scout template, the launcher, the live run.
6. The hardening found by the live run: tool ownership, the GitHub listing, the credit
   fallback, the retry transition.
