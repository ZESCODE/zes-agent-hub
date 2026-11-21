# ZESCODE Integration Directive — Compatibility Report

Contract version: `zes.workflow/v1`
Hub: `ZESCODE/zes-agent-hub` (source of truth) · Builder: `ZESCODE/zes-builder` (client)

## 1. Summary

The existing ZAP v1 runtime in `zes-agent-hub` was extended, not replaced. Every table,
state machine and provider path from v1 is still in use; the workflow layer was added on
top of them as a definition-driven execution model with an immutable graph snapshot.

| Area | Status | Notes |
| --- | --- | --- |
| Contract version | Compatible | `zes.workflow/v1` accepted on every workflow write, stored on `workflow_definitions.contract_version` and `workflow_runs.contract_version` |
| Definition validation | Compatible | Hub validates the definition, the graph, the node types, the agents, the task types and the tools before anything is stored |
| Job lifecycle | Reused | `jobs` / `tasks` keep their v1 states and transitions; workflow jobs use the same rows |
| Approval gates | Reused | `approval_gate` nodes map to the existing `approvals` table and the existing decide API |
| Verification | Reused | The verifier agent writes a `verification_report` artifact, the same artifact the v1 job completion check reads |
| Tool execution | Extended | The v1 tool registry gained a permission gate; every tool call is checked against the agent that runs it |
| Routing | Extended | The v1 model router now also serves `routingPolicy.taskType` per node; the browser never names a model |
| Builder UI | New surface | The builder gained a workflow library, a canvas overlay, a run detail view and the Scout launcher; it remains a thin client of the hub API |
| Database | Extended | Two tables and four columns were added to the v1 schema; no v1 table was changed in a breaking way |

## 2. Contract surface

A workflow definition is the unit of exchange. The builder mirrors the contract in
`app/lib/workflows/contract.ts`; the hub owns the canonical implementation in
`server/lib/workflows/contract.js`.

```jsonc
{
  "workflowId": "scout-zescode-zes-builder",
  "version": 2,
  "name": "Scout ZESCODE/zes-builder",
  "status": "draft",
  "nodes": [
    {
      "id": "github_read",
      "type": "github_tool",
      "position": { "x": 260, "y": 0 },
      "config": {
        "toolName": "github.repository.read",
        "operation": "read",
        "parameters": { "owner": "ZESCODE", "repo": "zes-builder" },
        "requiresApproval": false
      }
    }
  ],
  "edges": [{ "id": "e1", "source": "castor_plan", "target": "github_read" }],
  "execution": {
    "maxParallelTasks": 1,
    "leaseSeconds": 120,
    "defaultMaxAttempts": 3,
    "defaultBackoffMs": 1000,
    "maxBackoffMs": 30000,
    "requireVerification": true,
    "stopOnFailure": true
  },
  "approvals": [],
  "modelPreferences": { "defaultPolicy": { "taskType": "scout" }, "fallbackEnabled": true },
  "budget": { "maxTotalCostUsd": 5, "maxModelCalls": 200 },
  "acceptanceCriteria": ["The report names the top level files the GitHub tool returned."]
}
```

### 2.1 Builder side form

The builder stores acceptance criteria as **strings**; `toHubPayload` maps them to the
canonical objects the hub expects:

```jsonc
{ "id": "criterion_1", "description": "<string>", "verifierAgentId": "verifier", "required": true }
```

This keeps the editor simple while the stored definition stays canonical.

## 3. Validation rules the hub enforces

| Rule | Where | Failure |
| --- | --- | --- |
| Contract version must be `zes.workflow/v1` | `contract.js` | `WorkflowValidationError` |
| Graph must be acyclic | `contract.js` / `graph.js` | `WorkflowValidationError` |
| Node type must exist (13 types) | `node-types.js` | `WorkflowValidationError` |
| Agent node must use the agent of its node type | `contract.js` | `WorkflowValidationError` |
| Agent node must hold the `requiredPermissions` of its node type | `contract.js` + agent registry | `WorkflowValidationError` |
| `routingPolicy.taskType` must be a known task type | `server/lib/providers/router.js` | `WorkflowValidationError` |
| Tool node must name a registered tool | `node-types.js` | `WorkflowValidationError` |
| Tool permissions must be a subset of the node type permissions | `contract.js` | `WorkflowValidationError` |
| Acceptance criteria require a `verifier` node | `contract.js` | `WorkflowValidationError` |
| Published versions are immutable | `definition-service.js` | `409` on the API |
| A job pins the graph snapshot of its version | `workflow_runs.graph_snapshot` | the job keeps running on the version it started with |

## 4. Node type catalogue

| Node type | Agent | Required permissions | Purpose |
| --- | --- | --- | --- |
| `castor` | castor | `model.generate`, `task.assign`, `approval.request` | Orchestration and reporting |
| `john` | john | `model.generate`, `github.repository.read`, `research.read` | Research and architecture |
| `siti` | siti | `model.generate` | Product and UX |
| `laurent` | laurent | `model.generate`, `builder.project.read` | Engineering |
| `labu` | labu | `model.generate`, `deployment.preview` | Infrastructure |
| `verifier` | verifier | `model.generate`, `verification.read`, `qc.run` | Independent verification |
| `approval_gate` | — | — | Waits for a human decision |
| `condition` | — | — | Branches the graph |
| `github_tool` | john | `github.repository.read` | Reads a repository |
| `research_tool` | john | `research.read` | External research |
| `builder_tool` | laurent | `builder.project.read` | Reads the builder project |
| `deployment_tool` | labu | `deployment.preview` | Preview and publish a deployment |
| `output` | castor | — | Collects the final report |

Tool tasks run as the agent that owns the tool (`TOOL_OWNER` in `graph.js`), because the
permission gate checks the agent that executes the call.

## 5. Compatibility risks and how they are handled

| Risk | Handling |
| --- | --- |
| A builder sends a definition the hub rejects | The builder mirrors the rules in `contract.ts` and shows the error before the request; the hub remains the authority |
| A workflow is changed after a job started | The job pins `graph_snapshot`; published versions cannot be edited |
| An agent without the right permission calls a tool | The tool gateway denies the call, the task is blocked, an audit entry `tool.permission_denied` is written |
| The provider account has no credits | The client detects the credit message, retries on the free classic model and gives every request a timeout |
| A task fails and the retry is refused | The scheduler moves a failed task back to `pending` before the next attempt |
| A model call hangs | Every provider request carries a deadline; the worker is released |

## 6. Vercel Workflow Builder Template compatibility

| Area | Template | ZESCODE | Verdict |
| --- | --- | --- | --- |
| Editor library | `@xyflow/react` 12.9.2 | `@xyflow/react` 12.9.2 | Identical, components port without a dependency change |
| Application framework | Next.js 16 App Router | React Router 8 + Vite 8 | The template application is not adopted; its components are ported |
| Durable execution | `workflow` SDK 4.0.1-beta.17 (Apache-2.0), needs the framework plugin | Hub scheduler with jobs, tasks, leases, backoff, approvals, verification | The SDK would own run state; the hub keeps that ownership, so the SDK is deferred to a separately approved decision |
| Framework support of the SDK | Next.js, Vite, React Router, Astro, Express, Fastify, Hono, Nitro, Nuxt, SvelteKit, TanStack Start | React Router and Express are both supported, but the integrations need Nitro v3 | Adopting the SDK would change the build of both applications |
| Authentication | better-auth | Whop gate | The Whop gate is kept, as the directive requires |
| Database | Drizzle + Postgres tables for workflows, executions and logs | The hub owns `workflow_definitions`, `workflow_runs`, `jobs`, `tasks` | No second workflow store in the builder |
| Credentials | Per user integration credentials fetched by reference in the step | The hub tool gateway with an agent permission check and operator grants | Template steps would bypass permission enforcement, so they are not adopted |
| Deployment | Vercel + Neon, Next.js build, migrations in the build | Builder on Vercel, hub on Render | The current architecture is kept |

## 7. Verification

- Hub suite: **108 tests** (`node node_modules/vitest/vitest.mjs run`), 13 files, all green.
- Builder suite: **97 tests** (`npx --no-install vitest --run tests/unit`), 8 files, all green.
- Lint and typecheck clean in both repositories (`eslint`, `tsc --noEmit`).
- Production acceptance run: see `acceptance-report.md`.
