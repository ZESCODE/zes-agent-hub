# Phase 2 Task C — Versioned Workflow Definition Format

Contract family: `zes.workflow/v1`
Hub implementation: `server/lib/workflows/contract.js`
Builder mirror: `app/lib/workflows/contract.ts`
Assessment date: 2026-11-21
Scope: the format itself. Phase 2 does not change the shape of `zes.workflow/v1`; it adds field
descriptors, a lint layer and an export representation around it.

## 1. Design rules

1. A stored definition is a complete, self-contained description of a workflow. It never contains a
   credential, a model identifier, a permission decision or a runtime handle.
2. The hub is the only authority. The browser may propose a definition; the hub validates,
   versions, publishes and executes it.
3. A published version is immutable. A job pins the exact `graph_snapshot` it executes, so a later
   edit can never change a running or historical job.
4. Additive metadata is allowed without a version bump. A change that removes a field, narrows a
   type or changes the meaning of a field requires `zes.workflow/v2`.

## 2. TypeScript definition of the format

```ts
export const CONTRACT_VERSION = 'zes.workflow/v1' as const;

export type ContractVersion = typeof CONTRACT_VERSION;

export type NodeType =
  | 'castor'
  | 'john'
  | 'siti'
  | 'laurent'
  | 'labu'
  | 'verifier'
  | 'approval_gate'
  | 'condition'
  | 'github_tool'
  | 'research_tool'
  | 'builder_tool'
  | 'deployment_tool'
  | 'output';

export type RoutingPolicy = {
  taskType: string;
  complexity?: 'low' | 'medium' | 'high';
  requiresVision?: boolean;
  requiresCoding?: boolean;
  providerTier?: 'preferred' | 'any';
};

export type AgentNodeConfig = {
  agentId: string;
  routingPolicy: RoutingPolicy;
  objective?: string;
  timeoutMs?: number;
};

export type ToolNodeConfig = {
  toolName: string;
  operation: string;
  parameters: Record<string, unknown>;
  requiresApproval: boolean;
};

export type ConditionNodeConfig = {
  expression: string;
  trueHandle: string;
  falseHandle: string;
};

export type ApprovalNodeConfig = {
  actionType: string;
  required: boolean;
  expiresInMinutes?: number;
  approvers?: string[];
  description?: string;
};

export type OutputNodeConfig = {
  artifactTypes: string[];
  reportName?: string;
};

export type NodeConfig =
  | AgentNodeConfig
  | ToolNodeConfig
  | ConditionNodeConfig
  | ApprovalNodeConfig
  | OutputNodeConfig;

export type WorkflowNode = {
  id: string;
  type: NodeType;
  label?: string;
  position: { x: number; y: number };
  config: NodeConfig;
  inputs?: string[];
  outputs?: string[];
  timeoutMs?: number;
  retry?: { maxAttempts: number; backoffMs: number; maxBackoffMs: number };
};

export type WorkflowEdge = {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
  condition?: string;
};

export type WorkflowExecution = {
  maxParallelTasks: number;
  leaseSeconds: number;
  defaultMaxAttempts: number;
  defaultBackoffMs: number;
  maxBackoffMs: number;
  requireVerification: boolean;
  stopOnFailure: boolean;
};

export type ApprovalRequirement = {
  nodeId: string;
  actionType: string;
  required: boolean;
  expiresInMinutes?: number;
  approvers?: string[];
};

export type ModelPreferences = {
  defaultPolicy?: RoutingPolicy;
  byNodeType?: Record<string, RoutingPolicy>;
  fallbackEnabled: boolean;
};

export type WorkflowBudget = {
  maxTotalCostUsd?: number;
  maxCostPerNodeUsd?: number;
  maxTokens?: number;
  maxModelCalls?: number;
  maxWallClockMinutes?: number;
};

export type AcceptanceCriterion = {
  id: string;
  description: string;
  verifierAgentId: string;
  required: boolean;
  evidenceArtifactTypes?: string[];
};

export type WorkflowDefinition = {
  workflowId: string;
  version: number;
  name: string;
  description?: string;
  status: 'draft' | 'published' | 'archived';
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  execution: WorkflowExecution;
  approvals: ApprovalRequirement[];
  modelPreferences: ModelPreferences;
  budget: WorkflowBudget;
  acceptanceCriteria: AcceptanceCriterion[];
};
```

## 3. JSON example

```json
{
  "workflowId": "scout-zescode-zes-builder",
  "version": 2,
  "name": "Scout ZESCODE ZES builder",
  "description": "Scout a repository and verify the findings.",
  "status": "published",
  "nodes": [
    {
      "id": "castor_1",
      "type": "castor",
      "label": "Plan the scout",
      "position": { "x": 80, "y": 160 },
      "config": {
        "agentId": "castor",
        "routingPolicy": { "taskType": "plan", "complexity": "high" }
      }
    },
    {
      "id": "github_tool_1",
      "type": "github_tool",
      "label": "Read the repository",
      "position": { "x": 320, "y": 160 },
      "config": {
        "toolName": "github.repository.read",
        "operation": "read",
        "parameters": { "repository": "{{inputs.repository}}" },
        "requiresApproval": false
      }
    },
    {
      "id": "verifier_1",
      "type": "verifier",
      "label": "Verify the scout report",
      "position": { "x": 560, "y": 160 },
      "config": {
        "agentId": "verifier",
        "routingPolicy": { "taskType": "verify", "complexity": "high" }
      }
    },
    {
      "id": "output_1",
      "type": "output",
      "label": "Scout report",
      "position": { "x": 800, "y": 160 },
      "config": { "artifactTypes": ["tool_result", "verification_report"] }
    }
  ],
  "edges": [
    { "id": "e1", "source": "castor_1", "target": "github_tool_1" },
    { "id": "e2", "source": "github_tool_1", "target": "verifier_1" },
    { "id": "e3", "source": "verifier_1", "target": "output_1" }
  ],
  "execution": {
    "maxParallelTasks": 2,
    "leaseSeconds": 120,
    "defaultMaxAttempts": 3,
    "defaultBackoffMs": 1000,
    "maxBackoffMs": 30000,
    "requireVerification": true,
    "stopOnFailure": true
  },
  "approvals": [],
  "modelPreferences": {
    "defaultPolicy": { "taskType": "scout" },
    "fallbackEnabled": true
  },
  "budget": { "maxTotalCostUsd": 5, "maxModelCalls": 200 },
  "acceptanceCriteria": [
    {
      "id": "criterion_1",
      "description": "The repository metadata is captured.",
      "verifierAgentId": "verifier",
      "required": true,
      "evidenceArtifactTypes": ["tool_result"]
    }
  ]
}
```

## 4. Field descriptors (metadata, not stored in a definition)

The hub owns a descriptor per node type. The builder renders configuration from it. Descriptors are
returned by `GET /api/v1/node-types` and are not part of a stored definition.

```ts
export type NodeFieldType =
  | 'text'
  | 'number'
  | 'select'
  | 'template-input'
  | 'template-textarea'
  | 'json'
  | 'group';

export type NodeFieldDescriptor = {
  key: string;
  label: string;
  type: NodeFieldType;
  required?: boolean;
  defaultValue?: unknown;
  placeholder?: string;
  helpText?: string;
  options?: { value: string; label: string }[];
  min?: number;
  max?: number;
  rows?: number;
  showWhen?: { field: string; equals: string };
  fields?: NodeFieldDescriptor[];
};

export type NodeTypeDescriptor = {
  type: NodeType;
  label: string;
  category: 'agent' | 'control' | 'tool' | 'sink';
  description: string;
  agentId: string | null;
  defaultTaskType: string | null;
  defaultRoutingPolicy: RoutingPolicy | null;
  requiredPermissions: string[];
  protected: boolean;
  fields: NodeFieldDescriptor[];
  outputFields: { field: string; description: string }[];
  display: { icon: string; accent: string; summaryFields: string[] };
};
```

Descriptor coverage per node type:

| Node type | Config fields |
| --- | --- |
| `castor`, `john`, `siti`, `laurent`, `labu`, `verifier` | `agentId` (read only), `routingPolicy.taskType` (select, hub task types), `routingPolicy.complexity` (select), `objective` (template-textarea), `timeoutMs` (number) |
| `approval_gate` | `actionType` (text), `required` (select), `expiresInMinutes` (number), `approvers` (template-textarea), `description` (template-textarea) |
| `condition` | `expression` (template-textarea, linted), `trueHandle` (text), `falseHandle` (text) |
| `github_tool`, `research_tool`, `builder_tool`, `deployment_tool` | `toolName` (select, hub tool names), `operation` (text), `parameters` (json), `requiresApproval` (select) |
| `output` | `artifactTypes` (template-textarea), `reportName` (text) |

## 5. Value interpolation

- Syntax: `{{nodeId.field}}` for a value produced by an upstream node, and `{{inputs.name}}` for a
  job input.
- Allowed in fields of type `template-input`, `template-textarea` and in `parameters` string values.
- Resolution happens on the hub, at task execution time. The builder may parse references to show
  which upstream nodes a field depends on, but it never substitutes values itself.
- A reference to an unknown node or field is a validation error on save.

## 6. Validation rules, enforced by the hub

| Rule | Path | Current source |
| --- | --- | --- |
| Workflow id matches `^[a-z0-9][a-z0-9-]*$` | `workflowId` | `contract.js:96` |
| Node ids are unique | `nodes.<id>` | `contract.js:146` |
| A castor entry node exists | `nodes` | `contract.js:153` |
| An output node exists | `nodes` | `contract.js:157` |
| `config.model` is rejected | `nodes.<id>.config.model` | `contract.js:169` |
| `config.permissions` is rejected | `nodes.<id>.config.permissions` | `contract.js:173` |
| The node config matches its type schema | `nodes.<id>.config` | `contract.js:177` |
| The agent id equals the node type's agent | `nodes.<id>.config.agentId` | `contract.js:191` |
| The agent exists, is enabled and holds the required permissions | `nodes.<id>.config.agentId` | `contract.js:197` |
| `routingPolicy.taskType` is a known hub task type | `nodes.<id>.config.routingPolicy.taskType` | `contract.js:219` |
| The tool name is known and its permissions fit the node type | `nodes.<id>.config.toolName` | `contract.js:229` |
| Edge endpoints exist | `edges.<id>.source`, `edges.<id>.target` | `contract.js:246` |
| A condition edge uses one of the condition's handles | `edges.<id>.sourceHandle` | `contract.js:257` |
| A condition node has an edge on both handles | `nodes.<id>` | `contract.js:272` |
| The graph is acyclic | `edges` | `contract.js:290` |
| Every approval node has a matching approval requirement | `approvals` | `contract.js:299` |
| A protected action has a required approval | `approvals` | `contract.js:309` |
| Approval requirements target existing nodes | `approvals.<nodeId>` | `contract.js:324` |
| Acceptance criteria require a verifier node and the verifier agent | `acceptanceCriteria` | `contract.js:329` |
| A cost or call budget exists | `budget` | `contract.js:345` |

Phase 2 adds three rules: a size cap on `config.parameters`, a lint check on
`condition.config.expression`, and a check that interpolated references resolve to a node or a job
input.

## 7. Ownership matrix

| Field | Browser may propose | Hub decides |
| --- | --- | --- |
| `workflowId`, `name`, `description` | Yes | Validates the shape |
| `nodes[].position`, `label`, `inputs`, `outputs`, `retry`, `timeoutMs` | Yes | Validates the ranges |
| `nodes[].config.agentId` | Only the agent bound to the node type | Validates that it matches |
| `nodes[].config.routingPolicy` | Yes | Validates the task type, resolves the model |
| `nodes[].config.toolName`, `operation`, `parameters` | Yes | Validates, checks permissions at run time |
| `nodes[].config.expression` | Yes | Lints on save, evaluates on run |
| `approvals[]` | Yes | Enforces that protected actions are covered |
| `budget` | Yes | Enforces at run time |
| `modelPreferences` | Task type and complexity only | Resolves the concrete model and provider |
| Model identifiers | Never | Always |
| Permission lists | Never | Always |
| Credentials | Never | Always |
| `version`, `status` | Never on write | The hub allocates versions and status |

## 8. Versioning and compatibility policy

| Change | Effect |
| --- | --- |
| Add an optional field to a node or to the definition | Allowed inside `zes.workflow/v1` |
| Add a node type | Allowed; the hub's registry is the catalogue and the builder renders it from metadata |
| Add a field descriptor type | Allowed; descriptors are metadata, not stored definitions |
| Remove or rename a stored field | Requires `zes.workflow/v2` and a migration path for stored versions |
| Change the meaning of a stored field | Requires `zes.workflow/v2` |
| Change the validation rules | Allowed, but a rule that rejects previously stored definitions needs a grace period |

Each stored version records the contract version it was written under (`contract_version` in the
workflow definitions table). A job stores the full `graph_snapshot`, so an old job keeps executing
under the rules that were in force when it was created.

## 9. Export representation

The hub renders an authoritative export of a stored version in two formats:

- `application/json`: the stored definition, byte-identical to the stored JSON.
- `application/typescript`: a module that exports the same object as a typed constant:

```ts
import type { WorkflowDefinition } from 'zes.workflow/v1';

export const scoutWorkflow: WorkflowDefinition = {
  workflowId: 'scout-zescode-zes-builder',
  version: 2,
  // ... the same object as the JSON export
};
```

The export never contains credentials, model identifiers or runtime state.
