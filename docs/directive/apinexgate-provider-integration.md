# APInexGate as an Agent Hub provider — Phase 2 report

Date: 2026-11-22
Repository: `ZESCODE/zes-agent-hub` (working tree `~/tmp/zes-agent-hub`, base commit `320d05b`)
Status: **merged and deployed** — PR #29, squash commit `43b6abc`, Render deploy `dep-dc1h6jh42hec73abmpc0`.
The gateway itself is published at `https://gate.zes.codes` through a free Cloudflare Tunnel (approved by the user on 2026-11-22).

---

## 1. What this phase does

APInexGate becomes a second model provider the Agent Hub can call, next to Pollinations. Nothing else changes:

- The hub keeps **one** execution engine (the existing scheduler), **one** database (Postgres/PGlite with the existing `model_usage` table), and the existing task/approval/audit model.
- The hub holds **only a customer API key** for the gateway. The gateway's upstream APInex key never enters the hub.
- A seat that does not opt in behaves exactly as before: the default provider is still Pollinations and the default route table is untouched.

## 2. How it is wired

```
seat (provider, model)          seats/config.json
        │
        ▼
agent definition                 server/lib/agents/registry.js   (fallbackProvider/fallbackModel passthrough)
        │
        ▼
route                            server/lib/providers/router.js   (provider, model, fallbackProvider, fallbackModel)
        │
        ▼
provider registry                server/lib/providers/registry.js (pollinations | apinexgate)
        │
        ▼
client                           server/pollinations-client.js | server/apinexgate-client.js
        │
        ▼
model_usage row                  provider + model + tokens + cost + latency + success
```

The registry is the only place that knows how to reach a provider. The router only names one. The scheduler passes the seat's provider into the router and books the provider that actually answered.

### Provider contract

| Provider | Endpoint | Auth | Notes |
|---|---|---|---|
| `pollinations` | `https://gen.pollinations.ai/v1/chat/completions` | `POLLINATIONS_API_KEY` | unchanged, including the free-model credit fallback |
| `apinexgate` | `{APINEXGATE_BASE_URL}/chat/completions` | `APINEXGATE_API_KEY` (gateway customer key) | OpenAI-compatible; `{BASE_URL}/models`, `/balance` also exposed |

`APINEXGATE_BASE_URL` defaults to `http://127.0.0.1:8787/v1`.

### Error mapping

| Gateway status | Error code |
|---|---|
| 401 | `apinexgate_auth` |
| 403 | `apinexgate_forbidden` |
| 429 | `apinexgate_rate_limited` |
| 503 | `apinexgate_unavailable` |
| other | `apinexgate_error` |

Missing configuration raises `apinexgate_not_configured`; a missing model id raises `apinexgate_model_required`. The customer key is never included in an error message, and the gateway body is truncated to 300 characters.

### Fallback

When a non-default provider fails, the run continues on the route's fallback provider (Pollinations with `openai/gpt-5.4-nano`) instead of failing the task. The outcome reports the provider and model that actually answered, and `model_usage` records those, so the ledger never claims a call went to a provider that failed.

## 3. Changed files

| File | Change |
|---|---|
| `server/apinexgate-client.js` | **New.** Gateway client: `apinexGateGenChat`, `apinexGateListModels`, `apinexGateBalance`, `isApinexGateConfigured`, timeout handling, status → error-code mapping. |
| `server/lib/providers/registry.js` | **New.** Provider catalog (`pollinations`, `apinexgate`), `getProvider`, `providerCatalog`, `costPerMillionTokens`. Unknown ids fall back to the default provider. |
| `server/lib/providers/router.js` | `routeFor` now accepts `provider`, `model`, `fallbackProvider`, `fallbackModel`. Defaults are unchanged (`pollinations` + the same route table + `openai/gpt-5.4-nano` fallback). Unknown providers are ignored rather than breaking a route. `APINEXGATE_DEFAULT_MODEL` supplies the model when a seat does not name one. |
| `server/lib/orchestrator/model-runner.js` | Dispatches through the registry instead of calling `pollinationsGenChat` directly. Adds the fallback attempt, reports the effective `provider`/`model`, and uses the gateway's own prompt/completion token counts when present. |
| `server/lib/orchestrator/scheduler.js` | Passes the agent's provider, model and fallbacks into `routeFor`; records the effective provider/model in `model_usage` (`server/lib/orchestrator/scheduler.js:571`). |
| `server/lib/agents/registry.js` | Carries optional `fallbackProvider` / `fallbackModel` from the seat config into the agent definition. |
| `server/index.js` | New read-only `GET /api/providers` listing the provider catalog and whether each one is configured. No credentials are returned. |
| `.env.example` | Documents `APINEXGATE_BASE_URL`, `APINEXGATE_API_KEY`, `APINEXGATE_DEFAULT_MODEL`, `APINEXGATE_COST_PER_MILLION_TOKENS`. |
| `tests/unit/apinexgate-client.test.js` | **New.** 9 tests: URL handling, configuration guard, request shape, auth header, token extraction, status mapping, catalogue and balance calls. |
| `tests/unit/provider-router.test.js` | **New.** 9 tests: registry contents, configuration flags, default routes unchanged, apinexgate routing, default-model resolution, unknown-provider handling. |
| `tests/unit/model-runner-provider.test.js` | **New.** 4 tests: dispatch to the routed provider, fallback to Pollinations with the fallback model, failure without a fallback, no fallback when the default provider is used. |
| `tests/integration/apinexgate-provider.test.js` | **New.** 5 tests against a live gateway (skipped unless `APINEXGATE_BASE_URL` and `APINEXGATE_API_KEY` are set): catalogue, balance, direct call, seat route, invalid key. |
| `tests/integration/apinexgate-seat-routing.test.js` | **New.** 3 tests: a seat on `apinexgate` reaches the scheduler with the right provider and model and is booked as `provider = apinexgate` in `model_usage`; other seats stay on Pollinations. |

`seats/config.json` was **not** modified: no live seat is switched to APInexGate, because the gateway is local-only and has no upstream key yet.

## 4. Enabling a seat

```jsonc
{
  "id": "john",
  "provider": "apinexgate",
  "model": "claude-fable-5.1",          // a model id from GET {APINEXGATE_BASE_URL}/models
  "fallbackProvider": "pollinations",   // optional
  "fallbackModel": "openai/gpt-5.4-nano" // optional
}
```

Environment for the hub process:

```
APINEXGATE_BASE_URL=https://<gateway-host>/v1
APINEXGATE_API_KEY=<gateway customer key>
APINEXGATE_DEFAULT_MODEL=<model id, used when a seat names no model>
```

## 5. Verification

### Test results

| Scope | Result |
|---|---|
| `tests/unit/apinexgate-client.test.js` | 9 passed |
| `tests/unit/provider-router.test.js` | 9 passed |
| `tests/unit/model-runner-provider.test.js` | 4 passed |
| `tests/integration/apinexgate-seat-routing.test.js` | 3 passed |
| `tests/integration/apinexgate-provider.test.js` (live gateway) | 5 passed |
| Pre-existing suite (16 files, unchanged) | 147 passed |
| `eslint .` | clean |
| `tsc --noEmit` | clean |

**Total: 155 passed, 5 skipped** (the live-gateway file skips when the gateway env vars are absent).

> Environment note: running the whole suite in one vitest process is unreliable on this Android device — the process dies after the first file with no error output, and the same happened twice before any Phase 2 code was involved. Each test file was therefore run in its own process; every file passes that way, including the pre-existing workflow suites (`workflow-execution` 17, `workflow-api` 14, `orchestration` 9, `persistence` 13, `api` 14, `workflow-ownership` 11, `workflow-persistence` 2).

### Live checks against the local gateway

The gateway from Phase 1 runs on `http://127.0.0.1:8787` with a dedicated customer account (`hub-integration@zes.codes`, key stored in `~/.secure-credentials/apinexgate.env`).

| Check | Result |
|---|---|
| `GET /api/providers` on a running hub | `apinexgate` listed, `configured: true`, `defaultProvider: pollinations` |
| `GET {BASE_URL}/models` through the hub client | 45 models |
| `GET {BASE_URL}/balance` through the hub client | `balance_usd` returned for the hub's customer account |
| Chat completion through the hub client | gateway answers `503` (no upstream APInex key yet) → mapped to `apinexgate_unavailable`, not an unhandled crash |
| Invalid customer key | mapped to `apinexgate_auth` |
| Seat on `apinexgate` through the scheduler | `model_usage` row written with `provider = apinexgate`, `model = claude-fable-5.1` |
| Existing Pollinations seat | unchanged, `provider = pollinations` |

## 6. Failures, limitations and open items

| Item | Detail |
|---|---|
| No successful completion through the gateway yet | The gateway has no upstream APInex key, so every inference ends in `503`. The adapter, the error mapping, the fallback and the accounting are verified; a real completion through the gateway is not. Closing this needs the `sk-apx-…` key from Phase 1. |
| The gateway is phone-hosted | The tunnel publishes the gateway from an Android device, so its uptime follows that device. The admin console is deliberately loopback-only (`ADMIN_ALLOWED_HOSTS` unset). |
| No upstream key | The gateway needs a real `sk-apx-…` key before any model answers. |
| Cost estimate is a flat rate | The gateway does not report a cost in the OpenAI response, so `model_usage.estimated_cost` uses `APINEXGATE_COST_PER_MILLION_TOKENS` (default 0.5, same flat rate Pollinations uses). The gateway's own ledger remains the billing source of truth. |
| Provider catalogue is read-only | `GET /api/providers` reports configuration state; it does not call the gateway. A live catalogue check needs the gateway env vars and is covered by the integration test instead. |
| Token split for providers without usage data | Providers that report only `total_tokens` keep the previous 70/30 split. The gateway reports prompt and completion tokens, which are now used as-is. |

## 7. Remaining work

1. **Obtain an APInex key** so the gateway can serve real completions; re-run the live integration test to see a successful completion and a populated `usage_events` chain.
2. **Move the gateway off the phone** when a durable host is wanted — Oracle Cloud Always Free or a GCP e2-micro (both free with a persistent disk); the tunnel then points at that host instead.
3. Optional: expose the gateway catalogue in the hub UI, and a per-provider dashboard of the `model_usage` rows.
