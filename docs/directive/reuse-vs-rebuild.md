# ZESCODE Integration Directive — Reuse vs Rebuild

Every part of the ZAP v1 runtime was checked against the directive before a line was
written. The result: the runtime was reused wherever it already owned the concern, and
the workflow layer was added only where v1 had no equivalent.

## 1. Reused unchanged

| Component | Where | Why it was kept |
| --- | --- | --- |
| Job and task state machines | `server/lib/workflows/transitions.js`, `server/lib/workflows/engine.js` | The states, the allowed transitions and the audit trail already matched the directive |
| Postgres schema of v1 | `migrations/001_zap_v1.sql` | `jobs`, `tasks`, `approvals`, `artifacts`, `agent_events`, `tool_executions`, `audit_logs`, `model_usage` cover every run record the directive asks for |
| Agent registry and roles | `server/lib/agents/registry.js` | Castor, John, Siti, Laurent, Labu and the verifier already existed with their roles |
| Model router | `server/lib/providers/router.js` | The router already mapped task types to models; only the lookup by node task type was added |
| Tool registry and implementations | `server/lib/tools/registry.js` | The tool surface already existed and was reused unchanged apart from the permission gate and the repository listing |
| Approval flow | `engine.requestApproval`, `engine.decideApproval` | The approval table, the events and the API were already correct |
| Artifact store | `engine.recordArtifact` | Artifacts are already stored per job and task and are read by the builder run detail |
| Model usage accounting | `repos.modelUsage`, budget checks in `model-runner.js` | The budget and spend reporting were already implemented |
| Whop gate in the builder | `app/lib/whop.server.ts` | The access gate is the builder's own concern and was already finished |
| Builder canvas and job list | `app/routes/zap.canvas.tsx`, `app/routes/zap.tsx` | The canvas already rendered jobs and phases; the workflow surfaces were added next to it |

## 2. Extended

| Component | Change | Reason |
| --- | --- | --- |
| `server/lib/workflows/contract.js` | New | The directive needs a versioned definition format that both sides can validate |
| `server/lib/workflows/node-types.js` | New | A catalogue of 13 node types with their agents, permissions and accepted tools |
| `server/lib/workflows/graph.js` | New | Deterministic topological order, dependency sets and task contracts |
| `server/lib/workflows/definition-service.js` | New | Versioned definitions, publish, materialise a job, delete a definition |
| `server/lib/workflows/conditions.js` | New | The `condition` node type |
| `server/lib/repositories/workflows.js` | New | Storage for definitions and runs |
| `migrations/002_workflow_definitions.sql` | New | `workflow_definitions`, `workflow_runs` and four columns on `jobs` |
| `server/lib/tools/registry.js` | Extended | Permission gate, tool owner per tool, repository listing, optional token |
| `server/lib/agents/registry.js` | Extended | `permissionsForAgent` and the permission list per agent |
| `server/lib/orchestrator/scheduler.js` | Extended | Tool ownership, upstream context, artifact context, retry after backoff |
| `server/lib/orchestrator/model-runner.js` | Extended | Objective, upstream evidence and artifacts in the prompt |
| `server/pollinations-client.js` | Extended | Credit detection, free model fallback, request deadlines |
| Builder `app/lib/workflows/contract.ts` | New | The client mirror of the contract, including `toHubPayload` |
| Builder `app/lib/workflows/scout.ts` | New | The Scout template of the acceptance milestone |
| Builder `app/components/zap/*` | New | Workflow library, run detail, Scout launcher |
| Builder `app/lib/hub.server.ts` | Extended | One server-side function per hub call the UI needs |

## 3. Deliberately not built

| Not built | Reason |
| --- | --- |
| A second workflow engine in the builder | The directive names the hub as the source of truth; a second engine would create two sources of truth |
| A `model_router` node type | Routing is a server-side policy in the hub. A node that names a model would leak provider choice into the browser and break the "no model ids from the client" rule |
| Model ids in the definition | The definition carries `routingPolicy.taskType`; the hub resolves the model. This keeps the contract stable when the router changes |
| A separate approval database | The existing `approvals` table already stores the decision, the requester and the payload |
| A separate run database | `workflow_runs` holds the graph snapshot and points at `jobs`; a second store would duplicate the run state |
| Client-side execution of a workflow | The builder never runs a task; it starts a job and reads the hub |
| Pollinations quest scraping for credits | The client now detects the credit message and falls back to the free model |

## 4. Vercel Workflow Builder Template

The template was assessed in Phase 1; the detail is in `vercel-template-assessment.md`.
The short form:

| Template part | Decision |
| --- | --- |
| React Flow canvas, node visuals, minimap, connection validation | Port into the builder (Phase 2) |
| Declarative config fields and the action grid | Port into the builder, they replace the hand written config panel |
| The plugin registry contract and the discovery mechanism | Port as the ZESCODE node catalogue |
| The execution history panel | Port into the builder as the run timeline |
| The condition evaluator and validator | Port the validator; the hub keeps its own evaluator as the authority |
| The code generator and the AI operation stream | Port as the workflow generation interface |
| The Next.js application, the routes, the drizzle schema, better-auth | Not adopted: they would replace the builder, the Whop gate and the hub store |
| The plugin steps that call third party APIs directly | Not adopted: they would bypass the hub tool gateway and its permission checks |
| The `workflow` SDK as the execution engine | Deferred: it moves run ownership out of the hub and needs Nitro in the hub build |

## 5. Net effect

- **No v1 table was dropped or rewritten.** The workflow layer added two tables and four
  columns.
- **No v1 state machine was forked.** Workflow jobs move through the same `jobs.status`
  values as any other job.
- **One implementation per concern.** Validation, routing, permissions and execution live
  in the hub; the builder holds a client mirror of the contract for instant feedback and
  a server-side proxy for every call.
