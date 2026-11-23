# ZESCODE Integration Directive — Acceptance Report

Date: 2026-11-21
Hub: `ZESCODE/zes-agent-hub` on Render (`srv-dbv3sgrm8hqs738sdlrg`)
Builder: `ZESCODE/zes-builder` on Vercel (`app.zes.codes`)

## 1. What was accepted

The acceptance milestone of the directive is the **Scout**: a run that starts from a
GitHub repository URL, reads the repository with a tool, evaluates it with an agent and
checks the findings with an independent verifier.

The milestone is met. The run below was executed against the production hub, not a
local environment.

## 2. The production run

| Field | Value |
| --- | --- |
| Job | `a963ca68-b9ca-4716-8b1a-a80e52293bd1` |
| Workflow | `scout-zescode-zes-builder` version 2, contract `zes.workflow/v1` |
| Objective | Evaluate `https://github.com/ZESCODE/zes-builder`: read it with the GitHub tool, report what it does, its structure and the risks, and verify the findings independently |
| Result | **completed** |

### 2.1 Steps

| Node | Agent | Task type | Model | Status |
| --- | --- | --- | --- | --- |
| `castor_plan` | castor | plan | `deepseek/deepseek-v4.1-flash` | completed |
| `github_read` | john | read | `github.repository.read` (tool) | completed |
| `john_scout` | john | scout | `openai/gpt-6-astra` | completed |
| `verifier_check` | verifier | verify | `openai/gpt-6-astra` | completed — **PASS** for all three criteria |
| `report_output` | castor | output | `openai/gpt-5.4-nano` | completed |

### 2.2 Evidence

- The tool returned the repository metadata **and** the top level listing, and it was
  stored as the artifact `tool_result — github.repository.read result`.
- The verifier compared the findings with that artifact and returned
  `PASS for the three report-level acceptance criteria`, independent of the scout's own
  completion status. It was stored as the artifact `verification_report`.
- The report node collected the artifacts into the final report of the job.
- The model usage of the run is recorded per task in `model_usage` and is visible in the
  builder run detail.

### 2.3 Acceptance criteria

| Criterion | Result |
| --- | --- |
| The report describes what the repository is for and names the top level files the GitHub tool returned | met — verifier PASS |
| The report lists concrete findings, each tied to the tool output | met — verifier PASS |
| The verifier checked the findings independently and recorded a verification report | met — verifier PASS |

## 3. How the run was started

From the builder: open `/zap`, paste a GitHub URL into **Scout a repository**, press
**Start scout**. The launcher creates the workflow `scout-<owner>-<repo>` when it does
not exist yet, publishes it and starts a job pinned to that version.

Through the API, the same run is:

```bash
curl -X POST https://zes-agent-hub.onrender.com/api/v1/workflows \
  -H "Authorization: Bearer $AGORA_HUB_ADMIN_KEY" \
  -H 'Content-Type: application/json' \
  -d @scout-definition.json

curl -X POST https://zes-agent-hub.onrender.com/api/v1/workflows/scout-zescode-zes-builder/publish \
  -H "Authorization: Bearer $AGORA_HUB_ADMIN_KEY" -d '{"version":2}'

curl -X POST https://zes-agent-hub.onrender.com/api/v1/jobs \
  -H "Authorization: Bearer $AGORA_HUB_ADMIN_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"title":"Scout ZESCODE/zes-builder","objective":"…","workflowId":"scout-zescode-zes-builder","workflowVersion":2}'
```

## 4. The governance milestone

| Rule | Where it is enforced | Evidence |
| --- | --- | --- |
| A tool call is refused when the agent misses a permission | `server/lib/tools/registry.js` | `tests/unit/tool-permissions.test.js`, 6 tests |
| A denied call blocks the task and is audited | `server/lib/orchestrator/scheduler.js` | `tool.permission_denied` audit entry, task state `blocked` |
| A tool runs as the agent that owns it | `server/lib/workflows/graph.js` | `TOOL_OWNER`, test `tool ownership` |
| Publishing stays denied until it is granted explicitly | `server/lib/tools/registry.js` | test `denies every mutating tool until publishing is granted explicitly` |
| The browser never names a model | `server/lib/providers/router.js` | the definition carries `routingPolicy.taskType` only |
| The browser never holds a hub credential | `builder/app/lib/hub.server.ts` | every route proxies server side |

## 5. Test evidence

| Repository | Command | Result |
| --- | --- | --- |
| Hub | `node node_modules/vitest/vitest.mjs run` | **108 tests, 13 files, all passing** |
| Hub | `node node_modules/eslint/bin/eslint.js .` | clean |
| Hub | `node node_modules/typescript/bin/tsc --noEmit` | clean |
| Builder | `npx --no-install vitest --run tests/unit` | **97 tests, 8 files, all passing** |
| Builder | `npx --no-install eslint` | clean |
| Builder | `node .../typescript/lib/tsc.js` | clean |
| Builder | `VERCEL=1 npx --no-install react-router build` | built |

## 6. Defects the live run found and the fixes that shipped

The production run was the point where the remaining gaps became visible. Each one is
fixed, covered by a test and deployed.

| Finding | Fix | Pull request |
| --- | --- | --- |
| Downstream agents received an empty objective and no upstream results | The job objective and the results of the dependencies are part of the task and the prompt | hub #19 |
| Tool tasks all ran as castor, who holds none of the tool permissions | Every tool runs as the agent that owns it | hub #17 |
| Public repositories could not be read without a token | Anonymous reads are allowed for public repositories, the token is only needed for private ones | hub #18 |
| The repository listing was fetched but dropped before the agent saw it | The listing, the language and the topics are part of the tool result | hub #23 |
| A failed task could not be retried and kept its lease | The scheduler moves a failed task back to `pending` before the next attempt | hub #21 |
| An empty Pollinations balance was stored as a task result | The client detects the credit message, falls back to the free model and gives every request a deadline | hub #24 |
| The database suites timed out when the files ran in parallel | The test timeout was raised in the Vitest configuration | hub #19 |

## 7. Known limitations

| Limitation | State |
| --- | --- |
| The acceptance run was driven through the API because the builder needs a Whop session | The builder path is covered by the same code, the launcher and the proxy are deployed and the page answers `200` |
| The Scout reads metadata and the top level listing, not the file contents | The tool already accepts a `path` parameter; a deeper Scout would read the files it needs |
| The provider account has no credits, so the paid models fall back to the free model | The fallback is automatic; a top up restores the routed models |
| The old Pollinations key is still valid and still in the public git history of the hub | The user has to revoke the old key on the account and approve the history rewrite |
| The `model_router` node type does not exist | Routing is a server-side policy; a node that names a model would break the "no model ids from the client" rule |
| Private repositories need a GitHub token on the hub | `GITHUB_TOKEN` is configured in the Render environment |

## 8. Phase 3 — the ZESCODE gateway as the default provider

The gateway (`https://api.zes.codes/v1`) is now the hub's default provider. The hub calls
it through its OpenAI-compatible surface, holds one gateway token and never sees an
upstream key. APInexGate stays a separate reseller gateway that a seat has to name
explicitly; a provider failure no longer silently switches the work to another provider.

| Capability | State | Evidence |
| --- | --- | --- |
| Authentication | Bearer gateway token, no key in any error message | `server/newapi-client.js`, unit test "keeps the token out of the error message" |
| Request format | OpenAI chat completions, temperature and max tokens | unit test "sends an OpenAI compatible chat request" |
| Streaming | Server-sent events, chunks handed to a callback | live run: `gpt-6.1-terra` → `"One, two, three."` |
| Tool calling | Tool definitions forwarded, tool calls returned | live run: `gpt-6.2-astra` → `finish_reason: tool_calls`, `get_weather` |
| Model listing | `GET /v1/models` read through the client | live run: 60 model ids, `GET /api/providers/models?provider=newapi` |
| Error handling | 401, 403, 429, 5xx and "no available channel" map to distinct error codes | unit tests for every mapping |
| Timeout and retries | Every request carries a deadline, rate limits and 5xx are retried, auth errors are not | unit tests "retries a rate limited request", "never retries an authentication failure" |
| Cost accounting | Rate per provider, `NEW_API_COST_PER_MILLION_TOKENS` for the gateway | `server/lib/providers/registry.js`, unit test "keeps the cost rate of each provider separate" |
| Provider health | `GET /api/providers/health` probes every configured provider | live run: gateway `200`, 60 models, 293 ms |
| Per-task override | Job level (`provider`, `model`) and node level (`config.provider`, `config.model`), validated on the server | integration test "routes a job through the provider override stored on the job" |

Seat models were moved to gateway model ids that answer live: `deepseek-v4.1-flash`
(castor), `gpt-6.2-astra` (john), `gpt-6.1-terra` (siti), `grok-4.7` (laurent),
`kimi-k3.1-pro` (labu). The QC council reviews images through
`nvidia/nemotron-3-nano-omni-30b-a3b-reasoning`, the one verified vision model of the
gateway catalogue.

Verification: `vitest run` → 182 tests passing (6 skipped), `eslint .` clean,
`tsc --noEmit` clean.

