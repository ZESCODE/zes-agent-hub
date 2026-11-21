# Phase 2 Task C — Proposed File-by-File Changes

Assessment date: 2026-11-21
Scope: the exact set of files Phase 2 would touch in each repository, and nothing else. No file in this list has been modified yet; implementation starts only after this plan is approved.

## 1. Rules that constrain the change set

1. The hub stays the single source of truth for the contract, the node catalogue, execution,
   permissions, versioning and credentials.
2. The builder stays a presentation layer. It never executes a workflow, never resolves a model
   and never holds a tool credential.
3. `zes.workflow/v1` does not change shape in Phase 2. Field descriptors are **metadata about
   node types**, exposed by the hub next to the existing descriptor fields. They are not part of a
   stored definition.
4. No database migration is required. No existing table, column or index changes.
5. The Vercel Workflow SDK, Nitro, drizzle, better-auth and the template's executor are out of
   scope.

## 2. Hub changes

### 2.1 New files

| Path | Purpose | Contents | Risk |
| --- | --- | --- | --- |
| `server/lib/workflows/node-fields.js` | Declarative configuration fields per node type | Field descriptors in the shape `key`, `label`, `type` (`text`, `number`, `select`, `template-input`, `template-textarea`, `group`, `json`), `options`, `required`, `defaultValue`, `placeholder`, `helpText`, `showWhen`, `fields` for groups. One export per node type, plus `fieldsFor(type)` | Low. Pure data plus a lookup function |
| `server/lib/workflows/condition-lint.js` | Browser-safe condition lint shared with the builder | Port of the template's `validateConditionExpression`, `preValidateConditionExpression` and `sanitizeForDisplay` reduced to the ZESCODE expression grammar. Used by contract validation to produce precise errors | Medium. Must not evaluate expressions; lint only |
| `server/lib/workflows/redact.js` | Redaction for artifact payloads and event bodies | Port of the template's `redactSensitiveData`, `containsSensitiveData` and `stripCredentials`, applied to tool results before they are stored as artifacts | Medium. Touches the artifact path, so it needs regression tests on the Scout flow |
| `server/lib/workflows/export.js` | Authoritative export of a stored workflow version | Renders a stored version as JSON (`application/json`) or as a TypeScript module (`application/typescript`) that exports the `zes.workflow/v1` object | Low. Read-only |
| `server/lib/api/stream.js` | Server-sent events for a job | `GET /api/v1/jobs/:jobId/events/stream`: authenticated with the admin key, replays events after a cursor, then tails new events, heartbeat every 15 s, hard limit per connection, disconnect on job terminal state | Medium. New long-lived connection surface |
| `docs/directive/attribution.md` | Licence record | Upstream repository, upstream commit, list of derived files, obligations | None |
| `NOTICE` | Apache-2.0 notice | Attribution to Vercel, Inc. and the upstream project | None |
| `tests/unit/node-fields.test.js` | Descriptor coverage | Every node type exposes fields; field keys match the zod config schema; required flags match schema requirements | Low |
| `tests/unit/condition-lint.test.js` | Lint behaviour | Rejects method calls, bracket expressions, unauthorised identifiers; accepts the supported grammar; sanitises for display | Low |
| `tests/unit/workflow-export.test.js` | Export behaviour | JSON round-trips to the stored definition; TypeScript module parses back to the same object; a published version exports its own bytes | Low |
| `tests/integration/workflow-stream.test.js` | Stream behaviour | Requires the admin key; replays after a cursor; preserves ordering; ends on a terminal job state; heartbeat present | Medium |

### 2.2 Modified files

| Path | Change | Why | Risk |
| --- | --- | --- | --- |
| `server/lib/workflows/node-types.js` | `describeNodeTypes()` adds `fields`, `outputFields` and `display` per node type | The builder renders configuration generically instead of hand-writing it | Low, additive to the response |
| `server/lib/workflows/contract.js` | Add a size cap for `config.parameters`; run the condition lint on `condition.config.expression`; keep every existing rule | Closes G-07 and G-04 from the assessment | Medium, touches the validation path. Existing tests must stay green |
| `server/lib/workflows/conditions.js` | Align the accepted grammar with the lint so lint and evaluation agree | One dialect, two layers | Medium |
| `server/lib/api/v1.js` | Register `GET /jobs/:jobId/events/stream` and `GET /workflows/:workflowId/versions/:version/export` | Event subscription and export | Medium |
| `server/lib/workflows/engine.js` | Apply `redact.js` when a tool result is stored as an artifact | No credential material in artifacts | Medium |
| `server/lib/workflows/definition-service.js` | Record the export format version and the definition hash on the stored version, so an export can prove which bytes it rendered | Traceability of exports | Low |
| `docs/directive/compatibility-report.md`, `reuse-vs-rebuild.md`, `file-by-file-plan.md`, `db-integration-plan.md`, `agent-node-spec.md`, `acceptance-report.md` | Point to the Phase 2 documents | Navigation | None |

### 2.3 Explicitly not changed in the hub

- `server/lib/orchestrator/scheduler.js`, `server/lib/workflows/engine.js` task execution semantics,
  `server/lib/orchestrator/model-runner.js`, `server/lib/providers/router.js`: the hub executor and
  the model router are not touched in Phase 2.
- `server/index.js`: the Agora `/ws` socket stays as it is. Its unauthenticated broadcast is a
  separate finding (G-05) with its own change, not smuggled into Phase 2.
- `migrations/`: no schema change, therefore no new migration and no data backfill.
- `server/lib/tools/registry.js`, `server/lib/agents/registry.js`: the permission model is already
  correct and stays as it is.

## 3. Builder changes

### 3.1 New files

| Path | Purpose | Contents | Risk |
| --- | --- | --- | --- |
| `app/lib/workflows/node-fields.ts` | Type mirror of the hub descriptors | `NodeFieldDescriptor`, `NodeFieldGroup`, `NodeTypeDescriptor` extension, `describeField` helpers. Types only, no data | Low |
| `app/lib/workflows/condition-lint.ts` | Browser-safe lint | Port of the hub lint, kept in step by a shared fixture test | Medium |
| `app/lib/workflows/codegen.ts` | Export a workflow | JSON and TypeScript module rendering, using the `{{node.field}}` reference rules and friendly variable names | Low |
| `app/components/zap/canvas/ConfigFields.tsx` | Descriptor-driven fields | Renders `text`, `number`, `select`, `template-input`, `template-textarea`, `group` and `json` fields; shows required markers and `showWhen` visibility | Medium, replaces the core of `ConfigPanel.tsx` |
| `app/components/zap/canvas/NodeShell.tsx` | Node visuals | Ports, status states, category icon and a config summary line | Low |
| `app/components/zap/ExecutionTimeline.tsx` | Run presentation | Per-node status, duration, input and output, adapted from the template's runs view | Medium |
| `app/hooks/useJobStream.ts` | Live updates | Subscribes to the builder stream route, falls back to polling when the stream is unavailable, reconnects with the last event cursor | Medium |
| `app/routes/api.zap.jobs.$jobId.stream.ts` | Stream proxy | Whop-gated server-sent events that relay the hub stream to the browser | Medium |
| `app/routes/api.zap.workflows.$workflowId.export.ts` | Export proxy | Whop-gated export of a stored version, `format=json` or `format=ts` | Low |
| `NOTICE` | Apache-2.0 notice | Attribution to Vercel, Inc. and the upstream project | None |
| `tests/unit/config-fields.test.tsx` | Field rendering | Required markers, select options, `showWhen`, numeric bounds, json field round-trip | Low |
| `tests/unit/condition-lint.test.ts` | Lint parity | The same expressions produce the same verdicts as the hub fixture | Low |
| `tests/unit/workflow-codegen.test.ts` | Export behaviour | Golden TypeScript output; JSON equals the stored definition | Low |
| `tests/unit/job-stream.test.ts` | Stream client | Reconnect with cursor, polling fallback, terminal state stops the subscription | Medium |
| `tests/fixtures/zes.workflow.v1.json` | Shared contract fixture | One definition used by both repositories | Low |

### 3.2 Modified files

| Path | Change | Why | Risk |
| --- | --- | --- | --- |
| `app/lib/workflows/contract.ts` | Extend `NodeTypeDescriptor` with `fields`, `outputFields`, `display`; add interpolation helpers; keep `toHubPayload` behaviour byte-identical | The builder renders from hub metadata | Low, types only |
| `app/components/zap/canvas/ConfigPanel.tsx` | Render through `ConfigFields.tsx` using the descriptor of the selected node type; keep the existing agent, tool, condition, approval and output sections as descriptor-driven fields | Removes per-node-type UI code | Medium |
| `app/components/zap/canvas/WorkflowNodeView.tsx` | Use `NodeShell.tsx`; show the agent, task type and required permissions | Clearer nodes | Low |
| `app/components/zap/canvas/NodePalette.tsx` | Group by category, show the field summary and the permission badge | Palette driven by the hub catalogue | Low |
| `app/components/zap/canvas/WorkflowCanvas.tsx` | Add the plus-node affordance and connection validation; keep the existing save and publish calls unchanged | Better editing ergonomics | Medium |
| `app/components/zap/canvas/store.ts` | Hold the descriptor set, track interpolation references, keep `toDefinition()` as a straight copy | The store stays the single client-side model | Medium |
| `app/components/zap/RunDetail.tsx` | Use `useJobStream` and `ExecutionTimeline`; keep the current REST fields | Live progress | Medium |
| `app/lib/hub.server.ts` | Add `zapJobEventStream` (server-side fetch of the hub stream) and `zapWorkflowExport` | Server-only access to the new endpoints | Low |
| `app/routes/api.zap.node-types.ts` | Return the extended descriptor; keep the cache headers, add a content hash | The palette refreshes when the catalogue changes | Low |
| `app/routes/api.zap.jobs.$jobId.events.ts` | Keep the polling endpoint, document it as the fallback and expose the next cursor | Fallback path for the stream | Low |
| `app/routes.ts` | Register the two new routes | Routing | Low |

### 3.3 Explicitly not changed in the builder

- `app/lib/whop.server.ts`: the access gate stays as it is. Every new route uses `requireAccess`.
- `app/lib/hub.server.ts` credential handling: the admin key remains server-only, never returned to
  the browser and never placed in a URL.
- `app/lib/workflows/scout.ts` and `app/components/zap/ScoutLauncher.tsx`: the production Scout
  path is not modified by Phase 2, except that it must keep passing its existing tests.
- No new dependency is added to `package.json`.

## 4. Implementation order

Each step is independently shippable and ends with both test suites green.

| Step | Work | Gate |
| --- | --- | --- |
| 0 | Approve this plan | Reviewer sign-off |
| 1 | Hub: `node-fields.js`, `describeNodeTypes()` extension, `node-fields.test.js` | Hub tests green, `GET /api/v1/node-types` returns fields |
| 2 | Builder: `node-fields.ts` types, `ConfigFields.tsx`, `ConfigPanel.tsx` rewrite, palette summary | Builder tests green, existing canvas flows unchanged |
| 3 | Hub: `condition-lint.js`, contract integration, `conditions.js` alignment | Hub tests green, lint errors are precise |
| 4 | Builder: `condition-lint.ts`, lint badge in the config panel, parity fixture test | Parity test green against the hub fixture |
| 5 | Hub: `stream.js`, `/jobs/:jobId/events/stream`, stream integration test | Stream replays and tails correctly under the admin key |
| 6 | Builder: `useJobStream`, stream proxy route, `RunDetail` timeline | Live updates visible; polling fallback works |
| 7 | Hub: `export.js`, export endpoint, redaction of artifact payloads | Export bytes match the stored version; no secrets in artifacts |
| 8 | Builder: `codegen.ts`, export route and overlay | Export matches the hub bytes |
| 9 | Hub: `redact.js` applied in the engine, Scout regression run | Scout acceptance still passes on the deployed hub |
| 10 | Licence files, attribution, documentation updates | `NOTICE` present in both repositories |

## 5. Rollback

- No migration, no data format change, no new runtime dependency.
- Rollback is a redeploy of the previous builder and hub builds.
- The stream endpoint is additive: removing it returns the builder to polling.
- The field descriptors are additive to the node-types response: a builder that ignores them keeps
  working against the old response, and a newer builder against an older hub degrades to the
  hand-written config panel.

## 6. Review checklist per file

- Does the change keep the hub authoritative for contracts, permissions, models and execution?
- Does the change avoid putting a credential, a model identifier or a permission decision in the
  browser or in a URL?
- Does the change keep `zes.workflow/v1` byte-compatible?
- Does the change have a test in the repository that fails without it?
- Does the change keep the Apache-2.0 attribution intact where it applies?
