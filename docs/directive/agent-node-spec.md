# ZESCODE Integration Directive — Agent Node Specification

An agent node is a node that delegates work to one of the six agents. The hub owns which
agent may run which node, what the agent is allowed to do and which model serves the
task. The browser only chooses the node type.

## 1. Shape of an agent node

```jsonc
{
  "id": "john_scout",
  "type": "john",
  "position": { "x": 520, "y": 0 },
  "config": {
    "agentId": "john",
    "routingPolicy": {
      "taskType": "scout",
      "complexity": "medium"
    },
    "objective": "Evaluate https://github.com/ZESCODE/zes-builder and record the findings as evidence."
  }
}
```

| Field | Required | Meaning |
| --- | --- | --- |
| `type` | yes | The node type, which fixes the agent and the permissions |
| `config.agentId` | yes | Must equal the agent of the node type |
| `config.routingPolicy.taskType` | yes | A known task type; the hub resolves the model from it |
| `config.routingPolicy.complexity` | no | `low`, `medium` or `high`; recorded on the task |
| `config.objective` | no | What this step has to achieve; the job objective is used otherwise |

## 2. Agent catalogue

| Node type | Agent | Role | Required permissions | Default task type |
| --- | --- | --- | --- | --- |
| `castor` | castor | Orchestrator | `model.generate`, `task.assign`, `approval.request` | `plan` |
| `john` | john | Architect and researcher | `model.generate`, `github.repository.read`, `research.read` | `scout` |
| `siti` | siti | Product and UX | `model.generate` | `design` |
| `laurent` | laurent | Engineer | `model.generate`, `builder.project.read` | `build` |
| `labu` | labu | Infrastructure | `model.generate`, `deployment.preview` | `deploy` |
| `verifier` | verifier | Independent verification | `model.generate`, `verification.read`, `qc.run` | `verify` |

The permission list lives in `server/lib/agents/registry.js` and is read by both the
contract validator and the tool gateway, so a node can never promise a permission the
agent does not have.

## 3. What an agent receives

The prompt of an agent task is built from four parts:

| Part | Source | Example |
| --- | --- | --- |
| Role | The system prompt of the agent | `You are John, the architect and researcher. Be evidence-based and cite sources you used.` |
| Task | `tasks.objective` plus the job objective | `Evaluate … and record the findings as evidence.` + `Workflow objective: Evaluate …` |
| Evidence | The results of the upstream dependencies of the node | The repository metadata and the file listing the GitHub tool returned |
| Artifacts | The artifacts collected in the run so far | `tool_result`, `verification_report` |

The agent answers with JSON:

```jsonc
{ "summary": "…", "outputs": ["…"], "issues": ["…"], "evidence": ["…"] }
```

The hub stores the answer as the task result and writes a `task.completed` event. The
verifier additionally writes a `verification_report` artifact, which is what lets the job
reach the `completed` state.

## 4. Tool nodes and permissions

A tool node is not an agent node, but it runs under the identity of the agent that owns
the tool:

| Tool | Owner | Permissions the tool needs |
| --- | --- | --- |
| `github.repository.read` | john | `github.repository.read` |
| `research.web` | john | `research.read` |
| `builder.project.read` | laurent | `builder.project.read` |
| `deployment.preview` | labu | `deployment.preview` |
| `qc.check` | verifier | `qc.run` |

Before the call the gateway checks the agent:

```text
canUse(toolName, agentId)
  → unknown_tool          the tool is not registered
  → disabled              a mutating tool without AGORA_ENABLE_MUTATING_TOOLS
  → permission_denied     the agent misses a permission the tool needs
```

A denied call blocks the task, writes a `tool.permission_denied` audit entry and never
retries silently. Publishing stays denied until an operator grants it explicitly with
`AGORA_TOOL_PERMISSION_GRANTS`.

## 5. Control nodes

| Node type | Behaviour |
| --- | --- |
| `approval_gate` | The task waits in `waiting_approval` until a decision is recorded in `approvals` |
| `condition` | Evaluates an expression against the job context and takes the matching branch; the other branch is skipped |
| `output` | Collects the artifacts into the final report of the job |

## 6. Rules the hub enforces on an agent node

1. The node type must exist.
2. `config.agentId` must be the agent of the node type.
3. The agent must hold every permission of the node type.
4. `routingPolicy.taskType` must be a known task type, so the hub can always resolve a
   model.
5. A workflow with acceptance criteria must contain a `verifier` node.
6. A published version cannot be edited; a new version is created instead.

## 7. The Phase 3 node list

The directive names eleven ZESCODE nodes. The mapping to the node types the hub already
knows, and to the node kinds of the Vercel template, is direct.

| Directive node | Hub node type | Agent | Task type | Template kind |
| --- | --- | --- | --- | --- |
| Castor Orchestrator | `castor` | castor | `plan` | action |
| John Research | `john` | john | `scout`, `research` | action |
| Siti Product and UX | `siti` | siti | `design` | action |
| Laurent Engineering | `laurent` | laurent | `build` | action |
| Labu Infrastructure | `labu` | labu | `deploy`, `infrastructure` | action |
| Verifier Independent QA | `verifier` | verifier | `verify` | action |
| Model Router | `model_router` (new control node) | — | — | condition, extended |
| Approval Gate | `approval_gate` | — | — | action with a gate step |
| GitHub Tool | `github_tool` | john | `read` | action |
| Deployment Tool | `deployment_tool` | labu | `preview`, `publish` | action |
| Artifact Output | `output` | castor | `output` | action |

### 7.1 The model router node

The model router is a **control node**. It carries a routing policy, not a model:

```jsonc
{
  "id": "route_build",
  "type": "model_router",
  "position": { "x": 520, "y": 0 },
  "config": {
    "routingPolicy": { "taskType": "build", "complexity": "high" },
    "branches": [
      { "when": "job.input.complexity == 'high'", "target": "laurent_build" },
      { "when": "true", "target": "siti_design" }
    ]
  }
}
```

The hub resolves the task type to a model through the router table
(`server/lib/providers/router.js`). The node chooses the branch; the model is always a
hub decision. A model id in a definition stays invalid.

## 8. Writing a new agent node type

1. Add the type to `server/lib/workflows/node-types.js` with its agent, its required
   permissions and the tools it accepts.
2. Give the agent the permissions in `server/lib/agents/registry.js`.
3. Add the task type to `server/lib/providers/router.js` with a model and a timeout.
4. Mirror the type in `builder/app/lib/workflows/contract.ts` so the editor can offer it.
5. Cover the new rules in `hub/tests/unit/workflow-contract.test.js`.
