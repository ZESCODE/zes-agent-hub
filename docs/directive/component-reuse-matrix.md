# Phase 2 Task B — Component Reuse Matrix

Reference template: <https://github.com/vercel-labs/workflow-builder-template>
Local clone: `/data/data/com.termux/files/home/tmp/workflow-builder-template`
Assessment date: 2026-11-21
Scope: decide, per template artifact, what to adopt, adapt, defer or reject. No template code has been copied into ZESCODE yet.

## 1. Decision legend

| Decision | Meaning |
| --- | --- |
| Adopt | Port the pattern with minimal change into the builder, adapted to the ZESCODE data model |
| Adapt | Port the idea, but rewrite the data model or the runtime integration |
| Defer | Valuable, but not in Phase 2; revisit after Phase 2 lands |
| Reject | Not compatible with the architecture; do not port |

## 2. Matrix

| Template artifact | Lines | Decision | Target in ZESCODE | Effort | Notes |
| --- | --- | --- | --- | --- | --- |
| `plugins/registry.ts` — `ActionConfigFieldBase`, `ActionConfigFieldGroup`, `OutputField`, `OutputDisplayConfig` | 560 | Adapt | `server/lib/workflows/node-fields.js` (hub) exposed through `GET /api/v1/node-types`, rendered by `app/components/zap/canvas/ConfigPanel.tsx` | M | The field descriptor shape is the single highest-value idea in the template. It is re-pointed from *plugin actions* to *hub node types*, and the hub becomes the only owner |
| `plugins/registry.ts` — `IntegrationPlugin`, `PluginAction`, `registerIntegration` | 560 | Reject | none | — | ZESCODE has no per-user integrations and no user-managed credentials. The hub node registry replaces it |
| `plugins/_template/index.ts.txt`, `plugins/*/steps/*`, `plugins/*/credentials.ts` | 122 each | Reject | none | — | Plugin step functions execute in a foreign runtime with their own credentials model. The hub's tool registry and `canUse()` already own execution and permissions |
| `scripts/discover-plugins.ts` (directory discovery) | — | Adapt | `GET /api/v1/node-types` | S | Keep the idea "the catalogue is generated, not hand-maintained", but generate it from the hub's registry instead of a filesystem scan, so the browser never holds a second catalogue |
| `components/workflow/config/action-config.tsx` + `action-config-renderer.tsx` + `action-grid.tsx` | 1268 | Adapt | `ConfigPanel.tsx` rewrite on top of field descriptors | M | Field types map almost 1:1 to ZESCODE config values: `text`, `number`, `select`, `template-input`, `template-textarea`, `group`, plus `schema-builder` for free-form tool parameters |
| `components/workflow/config/schema-builder.tsx` | 240 | Defer | — | — | Only needed when tool parameters need a structured editor. Phase 2 uses a JSON editor for `config.parameters` |
| `components/workflow/config/condition-config.tsx` | 31 | Adapt | `ConfigPanel.tsx` condition branch | S | The builder needs a condition editor plus a lint badge, not a separate component |
| `components/workflow/nodes/action-node.tsx` | 390 | Adapt | `app/components/zap/canvas/WorkflowNodeView.tsx` | S | Richer node visuals: handles, ports, status states, config summary. Must show agent, task type and required permissions instead of an integration name |
| `components/workflow/nodes/trigger-node.tsx`, `add-node.tsx` | 141 | Adapt | `NodePalette.tsx` | S | The plus-node affordance for adding the next node on an edge is a genuine UX gain |
| `components/workflow/workflow-canvas.tsx` | 586 | Adapt | `WorkflowCanvas.tsx` | S | Keep the builder's React Flow setup; port connection validation, minimap, zoom-to-fit and drop handling only if missing |
| `components/workflow/workflow-toolbar.tsx` | 1490 | Defer | — | — | The template toolbar is dominated by template-specific features (AI generation, share, deploy). Only the undo/redo and run affordances are candidates |
| `components/workflow/workflow-runs.tsx` | 916 | Adapt | `app/components/zap/RunDetail.tsx` | M | Per-node status, duration, input and output. The hub already returns tasks, artifacts and events; the template supplies the presentation |
| `components/workflow/node-config-panel.tsx` | 1073 | Reject as a whole, Adapt the parts | `ConfigPanel.tsx` | — | The file mixes the template's integration model with useful layout ideas. Port the layout, not the file |
| `components/workflow/workflow-context-menu.tsx` | 284 | Defer | — | — | Useful but not required by the directive |
| `components/ai-elements/*` (canvas, connection, controls, edge, node, panel, prompt, shimmer) | 828 | Adapt | `WorkflowNodeView.tsx`, `RunDetail.tsx` | S | Port the shimmer and node/edge shells for agent activity. The template depends on `motion` and `ai`; the builder already has `framer-motion` and `ai` |
| `lib/condition-validator.ts` | 367 | Adopt with changes | `app/lib/workflows/condition-lint.ts` (builder) and `server/lib/workflows/condition-lint.js` (hub) | M | `validateConditionExpression`, `preValidateConditionExpression` and `sanitizeForDisplay` are exactly the browser-safe lint layer. The hub keeps the authoritative evaluator |
| `lib/condition-evaluator.ts` | 630 | Reject in the browser, keep the hub's own evaluator | `server/lib/workflows/conditions.js` | S | The template evaluates expressions with an interpreter in the browser path. ZESCODE evaluates on the hub only; the browser gets lint results, never evaluation |
| `lib/workflow-codegen.ts` + `workflow-codegen-shared.ts` + `workflow-codegen-sdk.ts` | 2338 | Adapt | `app/lib/workflows/codegen.ts` (builder) | M | Reuse `findNodeReferences`, `extractRefsFromConfigValue`, `analyzeNodeUsage`, `buildEdgeMap`, `toFriendlyVarName`, `toTypeScriptLiteral` and the `{{node.field}}` pattern rules. Generate a **portable `zes.workflow/v1` TypeScript module**, not a `workflow` SDK module |
| `lib/utils/redact.ts` | 218 | Adopt | `server/lib/workflows/redact.js` (hub) | S | `redactSensitiveData`, `containsSensitiveData` and `stripCredentials` protect artifacts and logs that carry tool payloads |
| `lib/credential-fetcher.ts` | 104 | Reject | none | — | Credentials belong to the hub and never reach the builder |
| `lib/workflow-executor.workflow.ts` | 758 | Reject | none | — | The hub scheduler is the executor. A second executor would create a second source of truth |
| `lib/workflow-store.ts` | 580 | Reject | none | — | The hub owns definitions, versions and the job snapshot |
| `lib/steps/*` | 640 total | Reject | none | — | Same reason as the plugin steps |
| `lib/db/schema.ts` (drizzle tables) | 188 | Reject | none | — | The hub's Postgres schema is the store. The builder has no database |
| `lib/api-client.ts` | 664 | Reject | none | — | The builder's server-only proxy (`app/lib/hub.server.ts`) already plays this role with the admin key |
| `components/overlays/integrations-overlay.tsx`, `api-keys-overlay.tsx`, `export-workflow-overlay.tsx` | — | Defer / Adapt | `ExportOverlay` only | S | Integrations and API keys are rejected for the same reason as credentials. The export overlay is a good fit for the new codegen |
| `components/ui/code-editor.tsx` (Monaco wrapper) | 27 | Defer | — | — | The builder already ships CodeMirror. Adding Monaco is a large dependency for a small gain |
| `next.config.ts` `withWorkflow`, `workflow` package 4.0.1-beta.17 | — | Reject | none | — | Requires Nitro v3 on both sides, introduces a foreign run-state model and a second executor |
| `better-auth` and `lib/auth*.ts` | — | Reject | none | — | Whop is the access control system; `app/lib/whop.server.ts` gates every route |
| `plugins/AGENTS.md` rules | — | Adopt as a rule | builder contribution rules | S | "Use `fetch`, not SDKs" is a good supply-chain rule and matches the hub's approach |
| `LICENSE` (Apache-2.0) | — | Adopt as an obligation | `NOTICE` in the builder, `docs/directive/attribution.md` in the hub | S | See section 4 |

## 3. Dependency impact

No new npm package is required for Phase 2.

| Dependency | Builder status | Action |
| --- | --- | --- |
| `@xyflow/react` | `^12.9.2`, installed `12.12.1`, peer React `>=17` | No change. The template's editor and the builder's editor are compatible |
| `zustand` | `5.1.0`, used by the canvas store | No change. The template's jotai atoms are not ported |
| `zod` | `4.6.7` in the builder, zod in the hub | No change. The hub owns the schema; the builder consumes descriptors |
| `motion` / `framer-motion` | Builder has `framer-motion 14` | Port the visual effects with `framer-motion` to avoid a second animation library |
| `ai` | Builder has `ai 7.0.173` | Only if the agent activity stream needs AI SDK primitives; otherwise plain React |
| `jotai` | Not in the builder | Not adopted |
| `drizzle-orm`, `postgres` | Not in the builder | Not adopted |
| `workflow` (SDK) | Not in the builder | Not adopted |

## 4. Licence obligations

The template is Apache-2.0. Porting any of its code into the builder requires:

1. A `NOTICE` file in the builder root that credits Vercel, Inc. and states that the file contains
   portions derived from `vercel-labs/workflow-builder-template`.
2. A modification notice on each derived file, for example a header line stating that the file is
   derived from the template and was modified for ZESCODE.
3. The Apache-2.0 licence text retained with the derived portions.
4. `docs/directive/attribution.md` in the hub recording the upstream commit that was used, the list
   of derived files and the obligations.

The hub itself stays free of template-derived code unless the shared condition lint is copied
there, in which case the same attribution applies to the hub.

## 5. Items deliberately not ported, with the reason

| Item | Reason |
| --- | --- |
| The template's executor and step runtime | The hub scheduler owns execution, permissions, budgets, retries and approvals. Two executors would disagree about state |
| The template's database tables | The hub's Postgres schema is the store; the builder has no database |
| The template's authentication | Whop is the access control system for the builder |
| The template's credential store | Credentials must never reach the builder; the hub owns tool credentials |
| The template's model identifiers | The hub resolves models from the routing policy. The contract already rejects `config.model` |
| The template's browser-side condition evaluation | Evaluating expressions in the browser is an injection surface; the hub evaluates |
| The template's AI workflow generation | It requires model access from the builder, which would break the hub-owned model routing |
