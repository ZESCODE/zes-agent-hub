# Phase 2 Task A — Local Repository Assessment

Reference: <https://github.com/vercel-labs/workflow-builder-template>
Assessment date: 2026-11-21
Scope: read-only assessment of the two authoritative working trees. No production code, schema or deployment was modified while producing this document.

## 1. Method and authority

The directive states that the **local working trees are authoritative**. Every statement below was
verified against the checked-out files, not against a GitHub snapshot:

- `git status --short` and `git rev-parse` for both trees.
- Direct reads of the hub workflow engine, scheduler, registries, API and migrations.
- Direct reads of the builder routes, canvas, store, contract and server-side proxy.
- The Vercel template was read from the local read-only clone at
  `/data/data/com.termux/files/home/tmp/workflow-builder-template`.

Both working trees were clean at inspection time, so there is no uncommitted work that differs from
what the plan is built against.

## 2. Repository states

| Tree | Path | Branch | HEAD | Upstream | Dirty |
| --- | --- | --- | --- | --- | --- |
| Hub | `/data/data/com.termux/files/home/tmp/zes-agent-hub` | `docs/workflow-builder-phase2-plan` (branched from `docs/vercel-template-assessment`) | `7d346d8` | `origin/main` = `2fa27c1`, `origin/docs/vercel-template-assessment` = `7d346d8` | No |
| Builder | `/data/data/com.termux/files/home/tmp/zes-builder` | `main` | `b23e7a1` | `origin/main` = `b23e7a1` | No |

The hub's `origin/main` is behind the local branch by exactly the Phase 1 assessment commit, which
is still an open pull request (#26). The builder `main` is identical to its upstream. Neither tree
has a stash entry.

## 3. Hub architecture as implemented

### 3.1 Shape

The hub is a single Node.js ESM service with no build step and no client bundle.

| Layer | Files | Responsibility |
| --- | --- | --- |
| Entry point | `server/index.js` | Express wiring, CORS, JSON body parsing, admin-key middleware, `/ws` WebSocket server, scheduler boot (`server/index.js:32`, `server/index.js:129`, `server/index.js:489`) |
| API | `server/lib/api/v1.js` | 31 route registrations over 27 paths: jobs, tasks, agents, approvals, tools, node types, workflow definitions |
| Contract | `server/lib/workflows/contract.js` | `zes.workflow/v1` schema and semantic validation (`contract.js:18`, `contract.js:95`, `contract.js:145`) |
| Node registry | `server/lib/workflows/node-types.js` | 13 node types, per-type config schemas, agent bindings, required permissions, protected action types (`node-types.js:9`, `node-types.js:96`, `node-types.js:195`, `node-types.js:197`) |
| Engine | `server/lib/workflows/engine.js` | Job and task lifecycle, transitions, approvals, artifacts, tool execution records, completion rules (`engine.js:18`, `engine.js:36`, `engine.js:64`, `engine.js:105`, `engine.js:193`, `engine.js:236`) |
| Scheduler | `server/lib/orchestrator/scheduler.js` | The executor. Task claiming with leases, agent tasks, tool tasks, condition branching, approval tasks, backoff and retry, upstream context, budget checks (`scheduler.js:137`, `scheduler.js:184`, `scheduler.js:271`, `scheduler.js:359`, `scheduler.js:497`, `scheduler.js:531`, `scheduler.js:615`) |
| Definitions | `server/lib/workflows/definition-service.js` | Draft versions, publish, resolve, attach to job (`definition-service.js:10`, `definition-service.js:128`, `definition-service.js:178`) |
| Security | `server/lib/agents/registry.js`, `server/lib/tools/registry.js` | `PERMISSION_BY_AGENT` (`agents/registry.js:44`), `canUse` and `ToolPermissionError` (`tools/registry.js:201`, `tools/registry.js:227`) |
| Persistence | `server/lib/repositories/workflows.js`, `migrations/001_zap_v1.sql`, `migrations/002_workflow_definitions.sql` | Jobs, tasks, events, artifacts, approvals, workflow definitions, workflow runs with pinned `graph_snapshot` (`repositories/workflows.js:168`, `002_workflow_definitions.sql:27`) |

### 3.2 What the hub already owns

1. **The contract.** `validateWorkflowDefinition()` rejects browser-supplied `config.model` and
   `config.permissions` (`contract.js:169`, `contract.js:173`), enforces the castor entry node and
   the output node, checks agent bindings and agent permissions, checks that a tool's permissions
   fit the node type, validates condition handles, detects cycles, requires an approval for every
   protected action, requires a verifier node when acceptance criteria exist, and requires a cost
   or call budget (`contract.js:153`, `contract.js:190`, `contract.js:229`, `contract.js:257`,
   `contract.js:290`, `contract.js:296`, `contract.js:309`, `contract.js:329`, `contract.js:345`).
2. **The node catalogue.** 13 node types with labels, categories, agent bindings, default routing
   policies and required permissions, exposed to the builder by `GET /api/v1/node-types`
   (`api/v1.js:462`, `node-types.js:238`).
3. **Execution.** The scheduler is the only thing that advances a job. It reads the definition
   pinned on the job run (`definition-service.js:178`), evaluates conditions server-side, enforces
   approvals, checks tool permissions before every tool execution and threads upstream results into
   agent prompts (`scheduler.js:497`).
4. **Versioning.** Drafts are versioned, published versions are immutable and every job run stores
   the exact `graph_snapshot` it executes.

### 3.3 What the hub does not have

| Gap | Evidence | Consequence |
| --- | --- | --- |
| No event stream | Only `GET /api/v1/jobs/:jobId/events` polling with an `after` cursor (`api/v1.js:157`) | The builder has to poll to show live progress |
| No workflow event socket | `/ws` is the Agora seat channel, it broadcasts seat messages and has no authentication (`server/index.js:32`, `server/index.js:302`, `server/index.js:472`) | It must not be reused for workflow events without adding auth and scoping |
| Node descriptors are shallow | `describeNodeTypes()` returns labels and permission lists but no per-field configuration descriptors (`node-types.js:238`) | The builder hand-writes a config panel per node type |
| No shared condition dialect documentation | `server/lib/workflows/conditions.js` evaluates expressions; the builder has a separate client-side validator | Two dialects can drift |
| No export/codegen endpoint | No endpoint returns a portable representation of a definition | The builder cannot export a workflow as code |

## 4. Builder architecture as implemented

### 4.1 Shape

The builder is a React Router 8 application that targets Cloudflare Workers and renders a
React Flow canvas. It owns presentation and nothing else.

| Area | Files | Responsibility |
| --- | --- | --- |
| ZAP surface | `app/routes/zap.tsx` (519 lines), `app/routes/zap.canvas.tsx`, `app/routes/zap.canvas.$workflowId.tsx` | Job list, approvals, launchers, canvas routes |
| Canvas | `app/components/zap/canvas/WorkflowCanvas.tsx`, `store.ts`, `ConfigPanel.tsx`, `NodePalette.tsx`, `WorkflowNodeView.tsx` | React Flow editing, zustand store, hand-written config panel |
| Contract mirror | `app/lib/workflows/contract.ts` (397 lines) | `CONTRACT_VERSION = 'zes.workflow/v1'`, node and config types, `validateDefinition()`, `toHubPayload()`, `nextNodeId()` (`contract.ts:7`, `contract.ts:195`, `contract.ts:355`) |
| Server-only proxy | `app/lib/hub.server.ts` (210 lines) | All hub calls, bearer `AGORA_HUB_ADMIN_KEY` (`hub.server.ts:17`, `hub.server.ts:33`) |
| Access control | `app/lib/whop.server.ts` | `readSession()` and `requireAccess()` gate every ZAP API route (`whop.server.ts:130`, `whop.server.ts:267`) |
| API routes | `app/routes/api.zap.*.ts` (18 files, registered in `app/routes.ts:55`) | Whop-gated proxies to the hub |
| Run view | `app/components/zap/RunDetail.tsx` | Fetches tasks, artifacts and events in parallel (`RunDetail.tsx:81`) |
| Templates | `app/lib/workflows/scout.ts`, `app/components/zap/ScoutLauncher.tsx` | The one-click Scout workflow, the only production template |

### 4.2 What the builder already owns

1. **A working React Flow editor.** `@xyflow/react` is declared as `^12.9.2` and installed as
   `12.12.1`, with a peer requirement of React `>=17`; the builder runs React `19.3.1`. The
   template's editor and the builder's editor use the same library at a compatible version, so the
   canvas layer can be ported without a dependency migration.
2. **A save and publish path.** `WorkflowCanvas.tsx` saves a draft through the Whop-gated proxy and
   publishes it (`WorkflowCanvas.tsx:149`, `WorkflowCanvas.tsx:155`, `WorkflowCanvas.tsx:174`).
3. **A client-side mirror of the contract** that converts builder state to the hub payload
   (`contract.ts:355`), including the acceptance-criteria conversion to `criterion_<n>` objects.
4. **A working production path.** The Scout template was exercised end to end against the deployed
   hub; the acceptance run reached verifier PASS and job completion.

### 4.3 What the builder does not have

| Gap | Evidence | Consequence |
| --- | --- | --- |
| Hand-written config UI | `ConfigPanel.tsx` (282 lines) branches per node type | Every new node type needs bespoke UI code |
| No declarative field descriptors | `NodeTypeDescriptor` carries label, category, agent and permissions only (`contract.ts:117`) | The palette cannot describe fields |
| Polling only | `RunDetail.tsx:81` fetches once per refresh, no stream | Live progress is manual |
| No workflow export | No route returns a portable definition | Users cannot take a workflow elsewhere |
| No unified condition lint | Client validation is structural only (`contract.ts:195`) | Invalid expressions are only caught by the hub at save time |

## 5. Requirement coverage

| Directive requirement | State in the local trees | Evidence |
| --- | --- | --- |
| A. Assess the current repository structure | Done in this document | Sections 3 and 4 |
| B. Node configuration patterns | Partial. The hub owns a strict per-type schema; the builder hard-codes the UI | `node-types.js:76`, `ConfigPanel.tsx:29` |
| C. Versioned workflow format | Done. `zes.workflow/v1`, validated server-side, versioned, pinned per job | `contract.js:18`, `002_workflow_definitions.sql:27` |
| D. Builder talks to the Hub | Done through the server-only proxy, but no live event subscription | `hub.server.ts:17`, `api/v1.js:157` |
| E. Workflow DevKit evaluation | Done in Phase 1; the SDK requires Nitro v3 on both sides, which conflicts with the hub's no-build service and the builder's Workers target | `vercel-template-assessment.md` section 4 |
| F. Seven deliverables | This document plus six sibling documents | `docs/directive/` |

## 6. Gap register

| Id | Gap | Severity | Owner | Proposed phase |
| --- | --- | --- | --- | --- |
| G-01 | Node configuration fields are not described as data, only as a zod schema on the hub and bespoke UI in the builder | Medium | Builder + Hub | Phase 2 |
| G-02 | No live event subscription; the builder polls | Medium | Hub + Builder | Phase 2 |
| G-03 | No portable export of a workflow definition | Low | Builder | Phase 2 |
| G-04 | Client-side condition validation and hub-side evaluation are not proven equivalent | Medium | Hub + Builder | Phase 2 |
| G-05 | The Agora `/ws` socket is unauthenticated and broadcasts to every client | High, pre-existing | Hub | Phase 3, out of Phase 2 scope |
| G-06 | The builder mirrors the contract in TypeScript, so a hub change can drift from the builder | Medium | Builder + Hub | Phase 2, mitigated by field descriptors and fixtures |
| G-07 | `config.parameters` accepts an unbounded record, so a definition can carry a very large payload | Low | Hub | Phase 2, enforce a size cap |

## 7. Conclusions carried into the Phase 2 plan

1. The hub is already the single source of truth for the contract, the node catalogue, execution,
   permissions and versioning. Phase 2 must not create a second store, a second executor or a
   second copy of the contract rules.
2. The builder is already a capable React Flow editor with the same flow library version as the
   template. The reusable value from the template is in **declarative configuration, node visuals,
   run presentation, condition linting and export**, not in the editor framework.
3. The single most valuable structural change is to turn the node type registry into **declarative
   field descriptors** that the hub owns and the builder renders. That removes hand-written UI per
   node type and removes the contract drift risk in one step.
4. Live execution feedback requires a new authenticated event endpoint on the hub and a proxy route
   in the builder. The existing Agora socket must not be reused, because it is unauthenticated and
   unscoped (G-05).
5. The Vercel Workflow SDK stays out of scope. Adopting it would require Nitro v3 in the hub,
   which would replace a working no-build service with a built one and would move run state into
   the SDK, contradicting the requirement that the hub owns jobs.
