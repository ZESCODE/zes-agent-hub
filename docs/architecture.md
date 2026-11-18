# ZESCODE Agent Hub — Architecture and Repository Assessment

Milestone 0 of the ZESCODE Agent Orchestration Protocol v1 (ZAP v1). This maps the
current implementation, identifies what can be reused, what must change and what is
genuinely missing. No destructive changes were made to produce it.

## 1. Current architecture map

```text
zes-agent-hub
├── server/index.js            Express + WebSocket server, /api/agora/* + pipeline API + /api/v1
├── server/pollinations-client.js  Pollinations text/chat client (gateway, vision messages)
├── server/lib/council.js      Council cycle: routing → discussion → synthesis → deploy plan
├── server/lib/qc.js           QC Council: parallel vision review, JSON verdicts
├── server/lib/images.js       Pollinations image URLs + hero copy
├── server/lib/deploy.js       Free/premium pipelines, template rendering, deploys
├── server/lib/db/pool.js      PostgreSQL (pg) or PGlite (WASM Postgres) + migrations
├── server/lib/repositories/   Jobs, tasks, events, audit, artifacts, approvals, tools, users
├── server/lib/workflows/      State machine (transitions) and workflow engine
├── server/lib/api/v1.js       ZAP v1 REST API
├── migrations/                SQL migrations (001_zap_v1.sql)
├── scripts/                   Thin CLI wrappers over server/lib
├── seats/config.json          Agent registry: 5 seats, models, pipeline config
└── tests/                     vitest: unit + integration (PGlite)
```

```text
zes-builder (React Router 8 + Vite, SSR, Vercel/Workers)
├── app/routes.ts                        Explicit route registry
├── app/routes/api.*.ts                  Resource routes (health, models, whop, hub proxies)
├── app/lib/hub.server.ts                Server-only client for the hub
├── app/lib/whop.server.ts               Whop OAuth + entitlement gate
├── app/lib/modules/llm/                 Provider framework (registry, manager, providers)
└── app/components/                      Chat, deploy, whop gate, image generation UI
```

## 2. Reusable components

| Component | Where | Reuse in ZAP v1 |
| --- | --- | --- |
| Seat registry | `seats/config.json` | Becomes the agent registry source (§4.1 of the protocol) |
| Council cycle | `server/lib/council.js` | Basis for Castor's planning and task assignment |
| Model client | `server/pollinations-client.js` | Basis for the model router; already tracks tokens |
| QC Council | `server/lib/qc.js` | Independent verification pattern for image artifacts |
| Tool surfaces | `server/lib/deploy.js`, `/api/v1/tools` | First Tool Gateway entries |
| Builder provider framework | `app/lib/modules/llm` | Model routing in the Builder UI |
| Builder hub proxy | `app/lib/hub.server.ts`, `/api/hub/*` | Builder's authenticated Hub client |

## 3. Gaps that required new code

| Gap | Status |
| --- | --- |
| Persistent job/task store | **Closed in this milestone** — `migrations/001_zap_v1.sql`, repositories, engine |
| Validated state machine | **Closed** — `server/lib/workflows/transitions.js`, optimistic concurrency on job transitions |
| Audit trail | **Closed** — `audit_logs` + `agent_events`, written by the engine on every transition |
| Health / readiness / metrics | **Closed** — `/health`, `/ready` (database check), `/metrics` (admin key) |
| Approval lifecycle | **Closed** — single-use approvals with decisions recorded |
| Idempotency | **Closed for tool executions** — unique idempotency key, replays return the original row |
| Task leases | **Closed** — `locked_by` / `locked_until` with expired-lease recovery on resume |
| Agent registry as typed definitions | **Partial** — seats exist; `AgentDefinition` fields (tools, permissions, maxConcurrentTasks) are not yet modelled |
| Model router | **Not started** — routing today is per-agent, not per-task-type |
| Tool Gateway execution engine | **Partial** — registry + idempotent records exist; permission checks and execution records are not wired to every tool |
| Verifier agent | **Not started** — QC Council covers images only |
| Builder job dashboard / timeline / approval UI | **Not started** — Builder has the hub client and deploy/QC surfaces only |
| Scout workflow (Milestone 6) | **Not started** |

## 4. Security findings

| Finding | Severity | Handling |
| --- | --- | --- |
| `/api/agora/*` routes had no authentication | High | Still open — they are legacy routes; the Hub must not be exposed publicly until they are gated |
| `vercel.json` pointed at a non-existent function path | Medium | Fixed in PR #2 (`server/index.js`) |
| Real-looking Pollinations key and Kilo JWT committed in `.env.example` | High | Redacted in PR #1; **the credentials must be rotated by the owner** |
| Model ids in `seats/config.json` were not real Pollinations ids | Medium | Fixed in PR #3 — the gateway rejected the previous ids |
| Deployment commands are executed through a shell | Medium | `server/lib/deploy.js` uses fixed argument lists and never accepts model-generated commands |
| `POLLINATIONS_API_KEY` reachable from the browser in the Builder | Low | Builder image generation proxies server-side; the key never enters the client bundle |
| Approval requests could be reused | Medium | Fixed — approvals can only be decided while `status = 'pending'` |

## 5. Proposed minimal changes (remaining milestones)

- **Milestone 2 — Castor orchestration:** planner that turns an objective into tasks using
  the existing council cycle, plus a task-type model router.
- **Milestone 3 — Tool Gateway:** registry entries become executable tools with
  permission checks and execution records.
- **Milestone 4 — Verifier:** independent verification against acceptance criteria.
- **Milestone 5 — Builder integration:** job dashboard, task progress, approvals and
  artifacts using the `/api/v1` endpoints already implemented.
- **Milestone 6 — Scout workflow:** end-to-end Scout job.

## 6. Operating notes

- `DATABASE_URL` selects PostgreSQL. Without it the Hub runs PGlite (real Postgres in
  WASM) — fine for development and tests, not for production.
- `AGORA_HUB_ADMIN_KEY` protects `/api/v1`, `/api/pipeline/*` and `/api/qc/check`.
  When it is unset those routes fail closed with `503`.
- Run the test suite with `npm test` (vitest). The tests use PGlite and need no server.
