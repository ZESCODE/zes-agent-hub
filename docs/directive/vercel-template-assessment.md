# Phase 1 Assessment — Vercel Workflow Builder Template

Reference: <https://github.com/vercel-labs/workflow-builder-template>
Assessment date: 2026-11-21
Scope: assessment only. No production system was modified, no existing file was overwritten.

## 1. What the template is

| Property | Value |
| --- | --- |
| Repository | `vercel-labs/workflow-builder-template` |
| License | **Apache License 2.0** (Copyright 2025 Vercel, Inc.) — permissive, allows use, modification, redistribution and commercial use with attribution and a NOTICE file |
| Runtime | Next.js 16.0.10, React 19.2.1, App Router |
| Editor | `@xyflow/react` 12.9.2 (React Flow) |
| Durable execution | `workflow` package **4.0.1-beta.17** (Vercel Workflow SDK, Apache-2.0); `withWorkflow` in `next.config.ts`, `start()` from `workflow/api`, `"use workflow"` / `"use step"` directives |
| State | `drizzle-orm` 0.44 + `postgres` 3.4 on Postgres; tables `users`, `sessions`, `accounts`, `verifications`, `workflows`, `integrations`, `workflow_executions`, `workflow_execution_logs`, `api_keys` |
| Auth | `better-auth` 1.3 |
| AI | `ai` (AI SDK) 7.0, `@monaco-editor/react`, `v0-sdk`, `@vercel/sdk` |
| UI | shadcn/ui, Radix, Tailwind, `jotai`, `motion`, `sonner`, `lucide-react`, `react-resizable-panels` |
| Integrations | 15 plugins: AI Gateway, Blob, Clerk, fal.ai, Firecrawl, GitHub, Linear, Perplexity, Resend, Slack, Stripe, Superagent, v0, Webflow |

The template is not a product; it is a reference implementation of an AI workflow builder:
a React Flow canvas, a declarative plugin system, an executor that walks the graph, a
Postgres store for definitions, executions and logs, a code generator and an AI
interface that streams graph operations.

## 2. Reusable parts, by value

### 2.1 High value, directly portable

| Template part | Lines | Why it fits ZESCODE |
| --- | --- | --- |
| `components/workflow/nodes/action-node.tsx` | 390 | Rich node visuals: handles, ports, status states, config summary. Our nodes are plain boxes (`WorkflowNodeView.tsx`, 77 lines) |
| `components/workflow/nodes/trigger-node.tsx`, `add-node.tsx` | 141 | The "+" node that opens the action picker, a pattern we only partly have |
| `components/workflow/workflow-canvas.tsx` | 586 | Drop handling, connection validation (`nodeHasHandle`), minimap, controls, zoom to fit. Ours has the same features in 356 lines but without the handle validation and the connection affordances |
| `components/workflow/config/action-config.tsx` + `action-config-renderer.tsx` + `action-grid.tsx` + `schema-builder.tsx` | 1508 | Declarative config fields: `template-input`, `template-textarea`, `text`, `number`, `select`, `schema-builder`. This maps exactly onto our node config model (agent id, routing policy, tool name, parameters) and replaces our hand-written `ConfigPanel.tsx` |
| `components/workflow/workflow-runs.tsx` | 916 | Execution history with per node status, duration, input and output. Our `RunDetail.tsx` shows tasks, artifacts, events and spend, but not the timeline ergonomics |
| `components/workflow/workflow-toolbar.tsx` | 1490 | Toolbar, execute flow, share, undo history. Ours has a much smaller toolbar |
| `plugins/registry.ts` | 230 | The declarative plugin contract: `IntegrationPlugin`, `PluginAction`, `ActionConfigField`. This is the right shape for a ZESCODE **node catalogue** instead of our hand-written descriptor list |
| `plugins/_template` + `scripts/discover-plugins.ts` | — | A discovery mechanism that builds the registry from directories. Our node catalogue is hand-maintained on both sides |
| `lib/workflow-codegen.ts` + `lib/workflow-codegen-sdk.ts` + `components/workflow/utils/code-generators.ts` | — | Turns a graph into runnable TypeScript with `"use workflow"`. This is the "workflow generation interface" of the directive, in a form ZESCODE can reuse for its own node types |
| `lib/condition-evaluator.ts` + `lib/condition-validator.ts` | — | A parser based safe expression evaluator that never reaches `eval`. Our `server/lib/workflows/conditions.js` is the same idea with a slightly different grammar; the template's is richer (string methods, hex numbers) |
| `app/api/ai/generate/route.ts` | — | Streams AI produced graph operations (`addNode`, `addEdge`, `updateNode`, …) as newline JSON. A good pattern for a Castor driven "build this workflow" interface |
| `lib/credential-fetcher.ts` | — | Server-only credential resolution by reference id. The same principle our hub already follows: the browser never holds a credential |

### 2.2 Moderate value, portable with adaptation

| Template part | Adaptation needed |
| --- | --- |
| `lib/workflow-store.ts` (jotai atoms, autosave, execution log atoms) | We use zustand per editor mount; the atom names map one to one onto our store, the autosave debounce is worth copying |
| `components/workflow/config/trigger-config.tsx`, `condition-config.tsx` | Our `condition` and `output` node configs are simpler; the panel pattern is reusable |
| `components/workflow/workflow-context-menu.tsx` | Reusable as is, only the styling is Tailwind versus our utility classes |
| `components/ui/*` (shadcn) | We already ship Radix primitives; the template's components can be copied into our `app/components/ui` if needed |
| `e2e/` Playwright suite | Useful as a reference for the editor acceptance test |

### 2.3 Not portable

| Template part | Reason |
| --- | --- |
| `app/**` routes, `next.config.ts`, `withWorkflow` | Next.js specific; our builder is React Router 8 + Vite |
| `lib/auth.ts`, `lib/auth-client.ts`, better-auth tables | The directive forbids replacing the Whop gate |
| `lib/db/**` (drizzle schema, migrations) | The hub owns the workflow store; a second workflow table set in the builder is a second source of truth |
| `lib/workflow-executor.workflow.ts` | The hub scheduler is the executor; a second executor would fork the state machine |
| `plugins/*/steps/*` | Those steps call third party APIs directly with user credentials, bypassing the hub tool gateway and its permission checks |
| `lib/ai-gateway/**`, `lib/integrations/**` | Provider and credential management belongs to the hub |

## 3. Framework, runtime, authentication, database and deployment conflicts

| Area | Template | ZESCODE today | Conflict | Severity |
| --- | --- | --- | --- | --- |
| Framework | Next.js 16 App Router | React Router 8 framework mode + Vite 8 (bolt.diy fork) | The template app cannot be adopted as an app; every file has to be ported | High |
| Editor dependency | `@xyflow/react` 12.9.2 | `@xyflow/react` 12.9.2 | **No conflict** — identical version, components port cleanly | None |
| UI state | jotai | zustand | Porting the store means rewriting the atom layer | Low |
| UI kit | shadcn + Radix + Tailwind + motion + sonner + monaco | Radix, Tailwind utilities, lucide 1.73, no motion/sonner/monaco | New dependencies needed for the rich panels | Low |
| Durable execution runtime | `workflow` SDK with `"use workflow"`; needs the framework plugin | Hub: plain Express 4 started with `node server/index.js`; Builder: Vite + `@cloudflare/vite-plugin` | The SDK needs **Nitro v3** as the build and server layer for both Express and React Router (framework integrations: Next.js, Vite, React Router, Astro, Express, Fastify, Hono, Nitro, Nuxt, SvelteKit, TanStack Start). Our hub has no build step and our builder is Cloudflare Workers targeted | **High** |
| Where the run state lives | The SDK World (Vercel World in production, Postgres World or a custom World elsewhere) | The hub owns `jobs`, `tasks`, `workflow_runs` and the graph snapshot | If the SDK executes the workflow, the run state moves out of the hub = a second source of truth, which the directive forbids | **High** |
| Authentication | better-auth with sessions, accounts, verifications | Whop OAuth gate with an entitlement check on every route and proxy | The template auth must be replaced by a Whop session adapter, not merged | High |
| Database | Drizzle + Postgres; the SDK World adds its own tables | Hub: raw `pg` + numbered SQL migrations applied at boot | Two migration systems, two schemas in one database | Medium |
| Deployment | Vercel + Neon, `next build` runs `discover-plugins` and `drizzle-kit migrate` in production | Builder on Vercel (React Router build), hub on Render (Express, migrations at boot) | Adopting the template app would move the builder to a Next.js build and would force the hub onto Nitro or Vercel | Medium |
| Credentials | Per user integration credentials in the database, fetched by reference in the step | Hub side tool gateway with an agent permission check and operator grants | Template steps would bypass permission enforcement | **High** |
| Execution model | The executor walks nodes and edges itself and calls plugin steps | Hub scheduler: materialised tasks, leases, backoff, approval gates, verification gate, audit trail | Two executors, two task models | High |

### 3.1 The decisive point about durable execution

The directive asks for the template to provide "durable workflow execution" while the hub
keeps "persistent job and task ownership". Those two statements pull in opposite
directions:

- The SDK persists a run as a sequence of steps, with its own tables in its World. That is
  the durable execution state.
- The hub persists a job as tasks with leases, backoff, approvals, artifacts, model usage
  and a verification gate. That is the job and task state.

Both can be true only if one of them is not the owner of a run. The directive names the
hub as the owner, so the SDK must not own the run. The SDK can still be used **inside** the
hub, for the parts where it is genuinely better than the current scheduler: a single long
running external action that must survive a restart, for example a deployment preview that
takes minutes.

The price of that option is the Nitro requirement: the SDK compiles `"use workflow"` and
`"use step"` functions at build time through a framework plugin, and for Express that
plugin is Nitro. Our hub has no build step today, so this would mean giving the hub a
build pipeline. That is a documented deployment change, and it is the only change that
would be needed.

## 4. Recommended integration approach

Three options were evaluated.

| Option | Description | Verdict |
| --- | --- | --- |
| A — Port the editor, keep the hub | Copy the React Flow, config panel, runs panel, plugin registry and codegen patterns into the builder; keep the hub as the only executor and store | **Recommended for Phase 2** |
| B — Adopt the template application | Replace the builder with the Next.js template, keep the hub as an API | Rejected: replaces the working builder, introduces better-auth, a second workflow store and a Next.js build; violates "do not replace existing Builder authentication" and "do not introduce a second source of truth" |
| C — Adopt the SDK as the execution engine in the hub | Add the `workflow` SDK to the hub, move execution into `"use workflow"` functions, use the Postgres World or a custom World | Defer: it moves run ownership out of the hub and requires Nitro in the hub build. Viable only as a later, separately approved change, and only if the hub keeps the authoritative job record and the SDK owns step mechanics |

Option A delivers the parts of the template that are genuinely better than what we have
(the node visuals, the declarative config fields, the execution panel, the plugin
contract, the code generator) without touching the hub, the authentication, the
deployment or the database. Option C is the path to the template's durable execution and
is documented here so the review can decide whether to authorise it.

## 5. What Phase 2 would change, at file level

Nothing in this list is implemented yet. It is the plan the review decides on.

### 5.1 Builder (`ZESCODE/zes-builder`) — new files

| File | Source | Purpose |
| --- | --- | --- |
| `app/components/zap/nodes/AgentNode.tsx` | adapted from `components/workflow/nodes/action-node.tsx` | Agent node visual with status, agent name, routing policy |
| `app/components/zap/nodes/ToolNode.tsx` | adapted from the same file | Tool node visual with the tool name and the permission badge |
| `app/components/zap/nodes/AddNode.tsx` | `components/workflow/nodes/add-node.tsx` | The add node that opens the catalogue |
| `app/components/zap/config/ConfigFields.tsx` | `components/workflow/config/action-config-renderer.tsx` | Renders declarative config fields |
| `app/components/zap/config/FieldTypes.tsx` | `components/workflow/config/action-config.tsx` | The field components: text, select, template input, schema builder |
| `app/components/zap/config/ActionGrid.tsx` | `components/workflow/config/action-grid.tsx` | Searchable node catalogue |
| `app/components/zap/config/NodeCatalogue.ts` | `plugins/registry.ts` + `plugins/_template` | The declarative node catalogue, one descriptor per ZESCODE node type |
| `app/components/zap/RunTimeline.tsx` | `components/workflow/workflow-runs.tsx` | Execution history panel with per node duration and output |
| `app/lib/workflows/codegen.ts` | `lib/workflow-codegen.ts` | Graph to TypeScript generation for a definition |
| `app/lib/workflows/generate-operations.ts` | `app/api/ai/generate/route.ts` | The streaming operation format used by the generation interface |
| `app/lib/workflows/condition-validator.ts` | `lib/condition-validator.ts` | Client side validation of a condition expression |

### 5.2 Builder — files to modify

| File | Change |
| --- | --- |
| `app/components/zap/canvas/WorkflowCanvas.tsx` | Use the new node components, add the handle validation of the template |
| `app/components/zap/canvas/NodePalette.tsx` | Replace the hard coded list with the declarative catalogue |
| `app/components/zap/canvas/ConfigPanel.tsx` | Render the declarative config fields instead of the hand written inputs |
| `app/components/zap/canvas/store.ts` | Keep zustand; add the autosave debounce and the operation buffer of the template |
| `app/routes/zap.canvas.tsx` | Mount the timeline panel next to the canvas |
| `app/routes/zap.tsx` | Add the generation interface entry point |
| `package.json` | Add the dependencies the ported panels need (for example `sonner`); no new runtime |
| `app/components/zap/canvas/WorkflowNodeView.tsx` | Retire or reduce to the fallback node |

### 5.3 Hub (`ZESCODE/zes-agent-hub`) — files to modify

| File | Change |
| --- | --- |
| `server/lib/workflows/node-types.js` | Add the `model_router` node type of Phase 3 and expose the declarative config field descriptors next to the type |
| `server/lib/workflows/contract.js` | Accept the new node type and validate the routing policy it carries |
| `server/lib/agents/registry.js` | No change to the permissions; the node type only references them |
| `server/lib/providers/router.js` | No change to the routing table; the node type resolves through it |
| `server/lib/api/v1.js` | Expose the descriptors of the node types in the same shape the builder catalogue uses |
| `docs/directive/*` | Update the documents of this assessment with the decision taken |

### 5.4 Files that stay untouched

`app/lib/whop.server.ts` and every route that calls `requireAccess`; `app/lib/hub.server.ts`
and the server only proxy pattern; the whole of `server/lib/tools/registry.js` permission
logic; `server/lib/orchestrator/scheduler.js`; `migrations/*`; the deployment
configuration of both repositories.

## 6. Answers to the Phase 3 node list

The template has two node kinds (trigger and action). ZESCODE needs eleven. The mapping
is direct: an agent node is an action node whose step calls the hub, and the config fields
of the plugin contract carry the agent id and the routing policy.

| Directive node | Template counterpart | Notes |
| --- | --- | --- |
| Castor Orchestrator | action node | `agentId: castor`, `routingPolicy.taskType: plan` |
| John Research | action node | `agentId: john`, `taskType: scout` or `research` |
| Siti Product and UX | action node | `agentId: siti`, `taskType: design` |
| Laurent Engineering | action node | `agentId: laurent`, `taskType: build` |
| Labu Infrastructure | action node | `agentId: labu`, `taskType: deploy` |
| Verifier Independent QA | action node | `agentId: verifier`, `taskType: verify` |
| Model Router | condition node, extended | A control node that picks the branch by the routing policy; it never names a model |
| Approval Gate | action node with a gate step | Maps to the existing `approvals` table |
| GitHub Tool | action node | Calls the hub tool gateway, never GitHub directly |
| Deployment Tool | action node | Calls the hub tool gateway; publishing stays denied until it is granted |
| Artifact Output | action node | Collects the artifacts into the report |

Every agent node carries `agentId` and `routingPolicy`; no node carries a model id. The
hub resolves the model, exactly as the directive requires.

## 7. License obligations

Apache 2.0 permits the port. The obligations are:

1. Keep the copyright notice and the licence text with the files that are copied
   verbatim (for example the condition evaluator parser).
2. Note the modification in the copied file.
3. Add a `NOTICE` file to the builder repository that names the template, its licence and
   the fact that parts of the interface were derived from it.
4. Do not use the Vercel or template trademarks in the product.

The port is a derivation of interface and code, so the notice is required. The plan adds
`NOTICE` to the builder and a `docs/directive/attribution.md` in the hub.

## 8. Phase 1 conclusion and request

Assessment complete. The recommendation is **option A**: port the editor, the config
system, the plugin contract, the execution panel and the code generator from the
template into the builder; keep the hub exactly as it is; leave the Workflow SDK for a
separately approved decision.

Requested from the review:

1. Approve option A, or choose option C and accept the Nitro build for the hub.
2. Approve the Apache 2.0 attribution: a `NOTICE` file in the builder and the derived
   files marked with the modification notice.
3. Confirm the Phase 3 node list, including `model_router` as a control node that
   selects a branch and never names a model.
4. Confirm whether Phase 4 keeps the hub scheduler as the executor for the ten step chain
   `SCOUT → ANALYZE → APPROVE → FORK → REBRAND → BUILD → VERIFY → DEPLOY → VERIFY
   DEPLOYMENT → COMPLETE`, with the deployment and the publish step behind an approval
   gate.
