# ZESCODE Workflow Designer v1 — implementation report

Scope: the workflow designer described in the Phase 1 directive, delivered as
two changesets — the hub (contract, ownership, execution) and the builder
(canvas, validation preview, run overlay). Nothing was deployed or published;
both changesets are waiting for review.

- Hub: `feat/workflow-designer-v1` (base `2fa27c1`, `origin/main`)
- Builder: `feat/workflow-designer-v1` (base `b23e7a1`, `origin/main`)
- Contract: `zes.workflow/v1`, unchanged version, new node types only

## What the user can do now

1. Open `/zap/canvas`, drag a node from the palette, connect it, edit it.
2. Press **Publish** — a validation preview shows every check, the failing ones
   are listed, and publishing is blocked until they are fixed. Publishing stores
   an immutable version on the hub.
3. Press **Run** — the builder creates a hub job for the published version and
   stays on the canvas. The banner and the node badges show the state the hub
   persisted; the canvas never invents it.
4. Another user cannot read, edit, publish, delete or run that workflow. The
   hub answers 404 on reads and 403 on writes for a workflow owned by somebody
   else.

## Screenshots

| File | What it shows |
| --- | --- |
| `screenshots/01-workflow-canvas.png` | The canvas with a published workflow: start → castor → john → verifier → report |
| `screenshots/02-validation-preview.png` | Validation preview before publishing, all checks green |
| `screenshots/03-validation-issues.png` | Validation preview with a missing result node — publish is blocked |
| `screenshots/04-run-state.png` | Run overlay: hub job id, job status, workflow version, per-node task status |
| `screenshots/05-zap-dashboard.png` | `/zap` with the workflow list and the running job |

They were taken against the real hub running locally on PGlite and the real
builder build, with a headless Chromium.

## Hub — file by file

### `server/lib/workflows/node-types.js`
- Added `start` (control): `{ trigger: 'manual' | 'api', objective? }`. It marks
  the entry of a workflow and does not materialise a task.
- Added `report` (sink): alias of `output` with a `reportName`; it produces the
  output task and ends the run.
- `NODE_TYPES` now lists 15 types. Each new type has a schema and a definition
  with label, category, description and default config.

### `server/lib/workflows/contract.js`
- The sink rule is now "output **or** report" (`A workflow needs an output or
  report node`).
- At most one `start` node is allowed.
- A `start` node cannot be the target of an edge.

### `server/lib/workflows/graph.js`
- `materializeTasks` skips the `start` node — it is a marker, not work.
- A `report` node materialises as the output task, so the run still ends with a
  result.

### `server/lib/orchestrator/scheduler.js`
- `JOB_PHASE_BY_NODE_TYPE.report = 'completed'`, so a report node closes the
  job.

### `server/lib/workflows/definition-service.js`
- `WorkflowAccessError` (with a `status` field) is raised instead of returning
  a definition the caller may not touch.
- `canAccess` / `assertAccess`: the owner may do everything; a workflow with no
  owner is platform-shared; a mismatch is 404 on read and 403 on write.
- `ownerPrincipal` is threaded through create, update, delete, publish,
  resolve and attach.
- `resolveDefinition` accepts an `action` (`'run'` and friends) so the same
  definition can be resolved for editing or for execution.
- `materializeJob` uses the start node's `objective` when the node has one; it
  overrides the objective of the run.

### `server/lib/repositories/workflows.js`
- `ownerPrincipal` is written on create.
- `list({ ownerPrincipal })` returns the caller's workflows plus the
  platform-shared ones: `owner_principal = $x OR owner_principal IS NULL`.
- `runs.listByWorkflow` returns the runs of a workflow.

### `server/lib/api/v1.js`
- `callerPrincipal(req)` reads `x-zes-user`. Absent means an internal call.
- Workflow routes enforce the owner: list is scoped, GET is 404 for somebody
  else's workflow, PUT/DELETE/publish are 403, versions are 404.
- `POST /api/v1/jobs` resolves the workflow **before** the job is created. An
  unauthorised workflow is 403 (`You are not allowed to run this workflow`) and
  no job is created. If the attach fails after the job exists, the job is
  transitioned to `failed` — never deleted, because `repos.jobs.remove` would
  break the events foreign key.
- `/api/v1/jobs/:jobId/graph` and `/api/v1/node-types` are unchanged in shape.

### `migrations/003_workflow_ownership.sql`
- `workflow_definitions.owner_principal TEXT`, an index on it, and a backfill
  from `users.email` through `created_by`, so existing definitions keep their
  owner.

### Tests
| File | What it covers |
| --- | --- |
| `tests/unit/workflow-contract.test.js` | 25 tests: the new sink rule, start/report acceptance, one start node, no incoming edge to a start node, start materialises no task, report materialises the output task |
| `tests/integration/workflow-ownership.test.js` | 11 tests: owner recorded on create, shared workflows visible to everyone, owner can read/edit/publish, another user cannot read (404), edit, publish, delete (403) or run (403), list is scoped, the owner survives a new version |
| `tests/integration/workflow-api.test.js` | 14 workflow API tests including the private-workflow cases and the job pinned to the exact published version and graph snapshot |
| `tests/integration/workflow-persistence.test.js` | 2 tests: definition, owner and published status survive a close/reopen of the PGlite data directory; the run and its snapshot survive too |
| `tests/integration/persistence.test.js` | 13 tests, extended: events are bound to the right job, no cross-job event ids |

Hub suite: **130 tests, 15 files, all green**. `eslint .` and `tsc --noEmit`
are clean.

## Builder — file by file

### `app/lib/workflows/contract.ts`
- `NodeType` and `NODE_TYPES` now include `start` and `report`.
- `StartNodeConfig` (`trigger`, `objective`) and `defaultConfigFor('start')`.
- `validateDefinition` rejects unsupported node types, requires castor,
  requires an output **or** report node, allows one start node, and rejects an
  incoming edge to a start node.
- `hasTerminalNode` accepts `output` or `report`.
- `toCriterionLines` converts the hub's criterion objects into the lines of
  text the canvas edits — the only place the two shapes meet.

### `app/components/zap/canvas/NodePalette.tsx`
- The palette groups by the descriptor category instead of a hard-coded list
  that did not know about the hub's `sink` category. Output and Report were
  invisible before this fix; the order is control, agent, tool, sink, output.

### `app/components/zap/canvas/WorkflowNodeView.tsx`
- Added the `sink` tone, so report and output nodes are drawn in emerald like
  the palette says.

### `app/components/zap/canvas/ConfigPanel.tsx`
- Start node: trigger (`manual` / `api`) and objective, with a note that the
  objective overrides the objective of the run.
- Output and Report nodes: artifact types and report name.

### `app/components/zap/canvas/ValidationPreview.tsx` (new)
- The publish preview: five checks (graph shape, entry and orchestration, result
  node, permissions, budget), the failing issues with their path, and a
  **Publish version** button that is disabled while an issue is open.
- `validationChecks` is exported so the mapping from contract issues to checks
  is unit tested.

### `app/components/zap/canvas/WorkflowCanvas.tsx`
- **Publish** opens the validation preview instead of publishing directly. The
  preview confirms the save plus publish.
- **Run** requires a published workflow and sends `workflowId` and
  `workflowVersion` to `POST /api/zap/jobs/create`. The canvas stays open — it
  no longer redirects to `/zap?job=…`.
- A polling effect reads `/api/zap/jobs/:jobId` and
  `/api/zap/jobs/:jobId/tasks` every three seconds and writes the persisted
  job status, workflow version and per-node task status into the store.
- The loader merges the hub's workflow record over its definition, so a
  published workflow opens as published.

### `app/components/zap/canvas/store.ts`
- `runJobId`, `runJobStatus` and `runJobVersion` hold the persisted state of the
  run; `setRunJob` and `setRunStatus` update it.
- `loadDefinition` normalises acceptance criteria to text.

### `app/lib/workflows/run-state.ts` (new)
- `parseRunState` projects the hub's job and task rows onto the canvas state.
  It accepts the builder proxy shape and the raw hub shape.

### `app/lib/whop.server.ts`
- `callerPrincipal(request)` returns `whop:<userId>` (lower case) for a signed
  session, or `null` when there is no session.

### `app/lib/hub.server.ts`
- `hubFetch`, `hubGet` and the workflow helpers accept a principal and send it
  as `x-zes-user`. No principal means no header, which the hub treats as an
  internal call.

### Routes
- `api.zap.workflows.ts`, `api.zap.workflows.$workflowId.ts`,
  `api.zap.workflows.$workflowId.publish.ts`,
  `api.zap.workflows.$workflowId.versions.ts` and `api.zap.jobs.create.ts`
  relay the principal of the caller to the hub.

### Tests
| File | What it covers |
| --- | --- |
| `tests/unit/workflow-contract.test.ts` | extended: report as a result node, one start node, a second start node rejected, an incoming edge to a start node rejected |
| `tests/unit/workflow-validation-preview.test.ts` | new: every check green for a valid definition, result check fails without a sink, orchestration check fails without castor, permissions check fails on browser-supplied permissions, graph shape check fails on a cycle, report accepted as the result node |
| `tests/unit/workflow-run-state.test.ts` | new: job status and version from both payload shapes, task status mapped onto node ids, tasks embedded in the job payload, empty projection for an unknown payload |
| `tests/unit/workflow-principal.test.ts` | new: no session gives no principal, a signed session gives `whop:<id>`, a forged cookie gives no principal, the hub request carries `x-zes-user`, and omits it when there is no principal |

Builder workflow suite: **36 tests, 4 files, all green**. `tsc --noEmit` is
clean, `eslint` is clean on every touched file, and `VERCEL=1 react-router
build` succeeds.

## Known limits

- The builder suite has 18 failures in files that this work did not touch
  (performance budgets, a marketplace archive test, a message-parser
  benchmark, a chat-history test). They fail on this Android device and are
  unrelated to the designer.
- The browser cannot choose a model or a permission. The contract rejects those
  fields and the hub resolves the model itself.
- The hub is the only authority on job state. The canvas shows what the hub
  persisted and nothing else.
- A workflow with no owner is platform-shared and visible to every caller.
  Owners are only set when a signed-in session exists.
