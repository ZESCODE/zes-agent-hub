// zes-agent-hub — workflow node types (zes.workflow/v1)
// The registry is the single source of truth for node kinds, their configuration
// schema, the agent they bind to and the permissions they require. The builder
// renders the palette from GET /api/v1/node-types, so a node can never exist in
// the canvas without a server-side definition.

import { z } from 'zod';

export const NODE_TYPES = [
  'start',
  'castor',
  'john',
  'siti',
  'laurent',
  'labu',
  'verifier',
  'approval_gate',
  'condition',
  'github_tool',
  'research_tool',
  'builder_tool',
  'deployment_tool',
  'output',
  'report',
];

const routingPolicySchema = z.object({
  taskType: z.string().min(1).max(80),
  complexity: z.enum(['low', 'medium', 'high']).optional(),
  requiresVision: z.boolean().optional(),
  requiresCoding: z.boolean().optional(),
  providerTier: z.enum(['preferred', 'any']).optional(),
});

const agentConfigSchema = z
  .object({
    agentId: z.string().min(1).max(80),
    routingPolicy: routingPolicySchema,
    objective: z.string().max(2000).optional(),
    timeoutMs: z.number().int().positive().max(1_800_000).optional(),
    provider: z.string().min(1).max(40).optional(),
    model: z.string().min(1).max(120).optional(),
  })
  .strict();

const conditionConfigSchema = z
  .object({
    expression: z.string().min(1).max(2000),
    trueHandle: z.string().max(80).default('true'),
    falseHandle: z.string().max(80).default('false'),
  })
  .strict();

const approvalConfigSchema = z
  .object({
    actionType: z.string().min(1).max(120),
    required: z.boolean().default(true),
    expiresInMinutes: z.number().int().positive().max(43_200).optional(),
    approvers: z.array(z.string().max(320)).max(50).optional(),
    description: z.string().max(1000).optional(),
  })
  .strict();

const toolConfigSchema = z
  .object({
    toolName: z.string().min(1).max(120),
    operation: z.string().min(1).max(120),
    parameters: z.record(z.unknown()).default({}),
    requiresApproval: z.boolean().default(false),
  })
  .strict();

const outputConfigSchema = z
  .object({
    artifactTypes: z.array(z.string().max(120)).max(50).default([]),
    reportName: z.string().max(200).optional(),
  })
  .strict();

const startConfigSchema = z
  .object({
    trigger: z.enum(['manual', 'api']).default('manual'),
    objective: z.string().max(2000).optional(),
  })
  .strict();

const NODE_CONFIG_SCHEMAS = {
  start: startConfigSchema,
  castor: agentConfigSchema,
  john: agentConfigSchema,
  siti: agentConfigSchema,
  laurent: agentConfigSchema,
  labu: agentConfigSchema,
  verifier: agentConfigSchema,
  approval_gate: approvalConfigSchema,
  condition: conditionConfigSchema,
  github_tool: toolConfigSchema,
  research_tool: toolConfigSchema,
  builder_tool: toolConfigSchema,
  deployment_tool: toolConfigSchema,
  output: outputConfigSchema,
  report: outputConfigSchema,
};

const AGENT_NODE_TYPES = ['castor', 'john', 'siti', 'laurent', 'labu', 'verifier'];

const TOOL_NODE_TYPES = ['github_tool', 'research_tool', 'builder_tool', 'deployment_tool'];

const NODE_DEFINITIONS = {
  start: {
    label: 'Start',
    category: 'control',
    requiredPermissions: [],
    description: 'Entry point of the workflow. The hub starts the run when a job is created.',
  },
  castor: {
    label: 'Castor Orchestrator',
    category: 'agent',
    agentId: 'castor',
    defaultTaskType: 'plan',
    requiredPermissions: ['model.generate', 'task.assign', 'approval.request'],
    defaultRoutingPolicy: { taskType: 'plan', complexity: 'high' },
    description: 'Decomposes the objective and assigns the remaining work.',
  },
  john: {
    label: 'John Research',
    category: 'agent',
    agentId: 'john',
    defaultTaskType: 'scout',
    requiredPermissions: ['model.generate', 'github.repository.read'],
    defaultRoutingPolicy: { taskType: 'scout', complexity: 'medium' },
    description: 'Evaluates repositories and gathers evidence.',
  },
  siti: {
    label: 'Siti Product and UX',
    category: 'agent',
    agentId: 'siti',
    defaultTaskType: 'design',
    requiredPermissions: ['model.generate'],
    defaultRoutingPolicy: { taskType: 'design', complexity: 'medium' },
    description: 'Defines product identity and interface requirements.',
  },
  laurent: {
    label: 'Laurent Engineering',
    category: 'agent',
    agentId: 'laurent',
    defaultTaskType: 'build',
    requiredPermissions: ['model.generate', 'builder.project.read'],
    defaultRoutingPolicy: { taskType: 'build', complexity: 'high' },
    description: 'Implements changes and produces reviewable artifacts.',
  },
  labu: {
    label: 'Labu Infrastructure',
    category: 'agent',
    agentId: 'labu',
    defaultTaskType: 'deploy',
    requiredPermissions: ['model.generate', 'deployment.preview'],
    defaultRoutingPolicy: { taskType: 'deploy', complexity: 'medium' },
    description: 'Prepares deployments and records deployment evidence.',
  },
  verifier: {
    label: 'Verifier Independent QA',
    category: 'agent',
    agentId: 'verifier',
    defaultTaskType: 'verify',
    requiredPermissions: ['model.generate', 'verification.read', 'qc.run'],
    defaultRoutingPolicy: { taskType: 'verify', complexity: 'high' },
    description: 'Independently verifies results against acceptance criteria.',
  },
  approval_gate: {
    label: 'Approval Gate',
    category: 'control',
    requiredPermissions: [],
    description: 'Blocks the workflow until an authorised operator decides.',
  },
  condition: {
    label: 'Condition',
    category: 'control',
    requiredPermissions: [],
    description: 'Branches on an expression evaluated by the hub.',
  },
  github_tool: {
    label: 'GitHub Tool',
    category: 'tool',
    requiredPermissions: ['github.repository.read'],
    description: 'Reads or writes repository content through an authorised tool.',
  },
  research_tool: {
    label: 'Research Tool',
    category: 'tool',
    requiredPermissions: ['research.read'],
    description: 'Collects external research results.',
  },
  builder_tool: {
    label: 'Builder Tool',
    category: 'tool',
    requiredPermissions: ['builder.project.read'],
    description: 'Reads or changes builder project state.',
  },
  deployment_tool: {
    label: 'Deployment Tool',
    category: 'tool',
    requiredPermissions: ['deployment.preview'],
    description: 'Runs a preview or publication deployment behind an approval.',
  },
  output: {
    label: 'Artifact Output',
    category: 'sink',
    requiredPermissions: [],
    description: 'Collects the artifacts that make up the final report.',
  },
  report: {
    label: 'Report',
    category: 'sink',
    requiredPermissions: [],
    description: 'Produces the final report from the artifacts of the run.',
  },
};

const PROTECTED_ACTION_TYPES = ['deployment.publish', 'github.repository.write', 'builder.project.write'];

const TOOL_PERMISSIONS = {
  'github.repository.read': ['github.repository.read'],
  'github.repository.write': ['github.repository.read', 'github.repository.write'],
  'research.web': ['research.read'],
  'builder.project.read': ['builder.project.read'],
  'builder.project.write': ['builder.project.read', 'builder.project.write'],
  'deployment.preview': ['deployment.preview'],
  'deployment.publish': ['deployment.preview', 'deployment.publish'],
};

export function isAgentNodeType(type) {
  return AGENT_NODE_TYPES.includes(type);
}

export function isToolNodeType(type) {
  return TOOL_NODE_TYPES.includes(type);
}

export function nodeDefinition(type) {
  return NODE_DEFINITIONS[type] || null;
}

export function nodeConfigSchema(type) {
  return NODE_CONFIG_SCHEMAS[type] || null;
}

export function knownToolNames() {
  return Object.keys(TOOL_PERMISSIONS);
}

export function toolPermissions(toolName) {
  return TOOL_PERMISSIONS[toolName] || [];
}

export function isProtectedActionType(actionType) {
  return PROTECTED_ACTION_TYPES.includes(actionType);
}

/**
 * Public description of the registry for the builder palette.
 */
export function describeNodeTypes() {
  return NODE_TYPES.map((type) => {
    const definition = NODE_DEFINITIONS[type];

    return {
      type,
      label: definition.label,
      category: definition.category,
      description: definition.description,
      agentId: definition.agentId || null,
      defaultTaskType: definition.defaultTaskType || null,
      defaultRoutingPolicy: definition.defaultRoutingPolicy || null,
      requiredPermissions: definition.requiredPermissions,
      protected: definition.category === 'tool',
    };
  });
}
