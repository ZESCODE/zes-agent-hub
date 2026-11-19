// zes-agent-hub — workflow definition contract (zes.workflow/v1)
// The contract is validated on the server. A browser may propose a definition,
// but only a definition that passes validateWorkflowDefinition() is stored,
// published or executed.

import { z } from 'zod';
import {
  NODE_TYPES,
  isAgentNodeType,
  isToolNodeType,
  nodeConfigSchema,
  nodeDefinition,
  knownToolNames,
  toolPermissions,
  isProtectedActionType,
} from './node-types.js';

export const WORKFLOW_CONTRACT_VERSION = 'zes.workflow/v1';

const routingPolicySchema = z.object({
  taskType: z.string().min(1).max(80),
  complexity: z.enum(['low', 'medium', 'high']).optional(),
  requiresVision: z.boolean().optional(),
  requiresCoding: z.boolean().optional(),
  providerTier: z.enum(['preferred', 'any']).optional(),
});

const nodeSchema = z.object({
  id: z.string().min(1).max(120),
  type: z.enum(NODE_TYPES),
  label: z.string().max(200).optional(),
  position: z.object({ x: z.number().finite(), y: z.number().finite() }),
  config: z.record(z.unknown()),
  inputs: z.array(z.string().max(80)).max(20).optional(),
  outputs: z.array(z.string().max(80)).max(20).optional(),
  timeoutMs: z.number().int().positive().max(1_800_000).optional(),
  retry: z
    .object({
      maxAttempts: z.number().int().positive().max(10),
      backoffMs: z.number().int().positive().max(600_000),
      maxBackoffMs: z.number().int().positive().max(3_600_000),
    })
    .optional(),
});

const edgeSchema = z.object({
  id: z.string().min(1).max(160),
  source: z.string().min(1).max(120),
  target: z.string().min(1).max(120),
  sourceHandle: z.string().max(80).optional(),
  targetHandle: z.string().max(80).optional(),
  condition: z.string().max(2000).optional(),
});

const executionSettingsSchema = z.object({
  maxParallelTasks: z.number().int().positive().max(16).default(2),
  leaseSeconds: z.number().int().positive().max(3600).default(120),
  defaultMaxAttempts: z.number().int().positive().max(10).default(3),
  defaultBackoffMs: z.number().int().positive().max(600_000).default(2000),
  maxBackoffMs: z.number().int().positive().max(3_600_000).default(60_000),
  requireVerification: z.boolean().default(true),
  stopOnFailure: z.boolean().default(true),
});

const approvalRequirementSchema = z.object({
  nodeId: z.string().min(1).max(120),
  actionType: z.string().min(1).max(120),
  required: z.boolean().default(true),
  expiresInMinutes: z.number().int().positive().max(43_200).optional(),
  approvers: z.array(z.string().max(320)).max(50).optional(),
});

const modelPreferencesSchema = z.object({
  defaultPolicy: routingPolicySchema.optional(),
  byNodeType: z.record(routingPolicySchema).optional(),
  fallbackEnabled: z.boolean().default(true),
});

const budgetSchema = z.object({
  maxTotalCostUsd: z.number().nonnegative().max(100_000).optional(),
  maxCostPerNodeUsd: z.number().nonnegative().max(100_000).optional(),
  maxTokens: z.number().int().positive().max(100_000_000).optional(),
  maxModelCalls: z.number().int().positive().max(10_000).optional(),
  maxWallClockMinutes: z.number().int().positive().max(100_000).optional(),
});

const acceptanceCriterionSchema = z.object({
  id: z.string().min(1).max(120),
  description: z.string().min(1).max(2000),
  verifierAgentId: z.string().min(1).max(80),
  required: z.boolean().default(true),
  evidenceArtifactTypes: z.array(z.string().max(120)).max(50).optional(),
});

export const workflowDefinitionSchema = z.object({
  workflowId: z.string().min(1).max(120).regex(/^[a-z0-9][a-z0-9-]*$/),
  version: z.number().int().positive(),
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  status: z.enum(['draft', 'published', 'archived']).default('draft'),
  nodes: z.array(nodeSchema).min(1).max(200),
  edges: z.array(edgeSchema).max(500),
  execution: executionSettingsSchema,
  approvals: z.array(approvalRequirementSchema).max(100),
  modelPreferences: modelPreferencesSchema,
  budget: budgetSchema,
  acceptanceCriteria: z.array(acceptanceCriterionSchema).max(100),
});

export class WorkflowValidationError extends Error {
  constructor(issues) {
    super(`Workflow definition is invalid: ${issues.map((issue) => issue.message).join('; ')}`);
    this.name = 'WorkflowValidationError';
    this.issues = issues;
  }
}

function issue(path, message) {
  return { path, message };
}

/**
 * Validate a workflow definition beyond its shape: node kinds, agent bindings,
 * routing policies, permissions, graph structure and approval coverage.
 *
 * @param {unknown} input
 * @param {{registry?: {find: (id: string) => object|null}, knownTaskTypes?: () => string[]}} context
 */
export function validateWorkflowDefinition(input, context = {}) {
  const parsed = workflowDefinitionSchema.safeParse(input);

  if (!parsed.success) {
    throw new WorkflowValidationError(
      parsed.error.issues.map((entry) => issue(entry.path.join('.'), entry.message)),
    );
  }

  const definition = parsed.data;
  const issues = [];
  const registry = context.registry || null;
  const knownTaskTypes = context.knownTaskTypes || (() => []);

  const nodeIds = new Set();

  for (const node of definition.nodes) {
    if (nodeIds.has(node.id)) {
      issues.push(issue(`nodes.${node.id}`, 'Duplicate node id'));
    }

    nodeIds.add(node.id);
  }

  if (!definition.nodes.some((node) => node.type === 'castor')) {
    issues.push(issue('nodes', 'A workflow needs a castor entry node'));
  }

  if (!definition.nodes.some((node) => node.type === 'output')) {
    issues.push(issue('nodes', 'A workflow needs an output node'));
  }

  for (const node of definition.nodes) {
    const schema = nodeConfigSchema(node.type);

    if (!schema) {
      issues.push(issue(`nodes.${node.id}.type`, `Unknown node type: ${node.type}`));
      continue;
    }

    if (node.config && node.config.model !== undefined) {
      issues.push(issue(`nodes.${node.id}.config.model`, 'Model identifiers are resolved by the hub'));
    }

    if (node.config && node.config.permissions !== undefined) {
      issues.push(issue(`nodes.${node.id}.config.permissions`, 'Permissions are owned by the agent registry'));
    }

    const config = schema.safeParse(node.config);

    if (!config.success) {
      for (const entry of config.error.issues) {
        issues.push(issue(`nodes.${node.id}.config.${entry.path.join('.')}`, entry.message));
      }

      continue;
    }

    const nodeConfig = config.data;
    const definitionMeta = nodeDefinition(node.type);

    if (isAgentNodeType(node.type)) {
      if (nodeConfig.agentId !== definitionMeta.agentId) {
        issues.push(
          issue(`nodes.${node.id}.config.agentId`, `Node type ${node.type} must use agent ${definitionMeta.agentId}`),
        );
      }

      if (registry) {
        const agent = registry.find(nodeConfig.agentId);

        if (!agent) {
          issues.push(issue(`nodes.${node.id}.config.agentId`, `Unknown agent: ${nodeConfig.agentId}`));
        } else if (!agent.enabled) {
          issues.push(issue(`nodes.${node.id}.config.agentId`, `Agent ${nodeConfig.agentId} is disabled`));
        } else {
          const missing = definitionMeta.requiredPermissions.filter(
            (permission) => !agent.permissions.includes(permission),
          );

          if (missing.length > 0) {
            issues.push(
              issue(`nodes.${node.id}.config.agentId`, `Agent ${nodeConfig.agentId} lacks permissions: ${missing.join(', ')}`),
            );
          }
        }
      }

      const known = knownTaskTypes();

      if (known.length > 0 && !known.includes(nodeConfig.routingPolicy.taskType)) {
        issues.push(
          issue(
            `nodes.${node.id}.config.routingPolicy.taskType`,
            `Unknown task type: ${nodeConfig.routingPolicy.taskType}`,
          ),
        );
      }
    }

    if (isToolNodeType(node.type)) {
      if (!knownToolNames().includes(nodeConfig.toolName)) {
        issues.push(issue(`nodes.${node.id}.config.toolName`, `Unknown tool: ${nodeConfig.toolName}`));
      } else {
        const missing = toolPermissions(nodeConfig.toolName).filter(
          (permission) => !definitionMeta.requiredPermissions.includes(permission) && permission !== 'github.repository.read',
        );

        if (missing.length > 0) {
          issues.push(issue(`nodes.${node.id}.config.toolName`, `Tool ${nodeConfig.toolName} requires: ${missing.join(', ')}`));
        }
      }
    }
  }

  for (const edge of definition.edges) {
    if (!nodeIds.has(edge.source)) {
      issues.push(issue(`edges.${edge.id}.source`, `Unknown source node: ${edge.source}`));
    }

    if (!nodeIds.has(edge.target)) {
      issues.push(issue(`edges.${edge.id}.target`, `Unknown target node: ${edge.target}`));
    }
  }

  const cycle = findCycle(definition.nodes, definition.edges);

  if (cycle) {
    issues.push(issue('edges', `The workflow contains a cycle: ${cycle.join(' -> ')}`));
  }

  const approvalsByNode = new Map(definition.approvals.map((approval) => [approval.nodeId, approval]));

  for (const node of definition.nodes) {
    if (node.type === 'approval_gate') {
      const approval = approvalsByNode.get(node.id);

      if (!approval) {
        issues.push(issue(`approvals`, `Approval node ${node.id} has no approval requirement`));
      } else if (approval.actionType !== node.config.actionType) {
        issues.push(issue(`approvals.${node.id}.actionType`, 'Approval requirement must match the node action type'));
      }
    }

    if (node.type === 'deployment_tool' || node.type === 'github_tool' || node.type === 'builder_tool') {
      const config = nodeConfigSchema(node.type).safeParse(node.config);
      const actionType = config.success ? config.data.operation : '';

      if (isProtectedActionType(actionType)) {
        const approval = approvalsByNode.get(node.id);

        if (!approval || !approval.required) {
          issues.push(issue(`approvals`, `Protected action ${actionType} on node ${node.id} requires an approval`));
        }
      }
    }
  }

  for (const approval of definition.approvals) {
    if (!nodeIds.has(approval.nodeId)) {
      issues.push(issue(`approvals.${approval.nodeId}`, 'Approval requirement targets an unknown node'));
    }
  }

  if (definition.acceptanceCriteria.length > 0) {
    const verifierNodes = definition.nodes.filter((node) => node.type === 'verifier');

    if (verifierNodes.length === 0) {
      issues.push(issue('acceptanceCriteria', 'Acceptance criteria require a verifier node'));
    }

    for (const criterion of definition.acceptanceCriteria) {
      if (criterion.verifierAgentId !== 'verifier') {
        issues.push(
          issue(`acceptanceCriteria.${criterion.id}.verifierAgentId`, 'Acceptance criteria must be verified by verifier'),
        );
      }
    }
  }

  if (definition.budget.maxTotalCostUsd === undefined && definition.budget.maxModelCalls === undefined) {
    issues.push(issue('budget', 'A workflow needs a cost or call budget'));
  }

  if (issues.length > 0) {
    throw new WorkflowValidationError(issues);
  }

  return definition;
}

/**
 * Detect a cycle in the node graph and return the offending path.
 */
export function findCycle(nodes, edges) {
  const adjacency = new Map(nodes.map((node) => [node.id, []]));

  for (const edge of edges) {
    if (adjacency.has(edge.source) && adjacency.has(edge.target)) {
      adjacency.get(edge.source).push(edge.target);
    }
  }

  const visited = new Set();

  function visit(nodeId, path) {
    if (path.includes(nodeId)) {
      const start = path.indexOf(nodeId);
      return [...path.slice(start), nodeId];
    }

    const nextPath = [...path, nodeId];

    for (const next of adjacency.get(nodeId) || []) {
      const found = visit(next, nextPath);

      if (found) {
        return found;
      }
    }

    visited.add(nodeId);
    return null;
  }

  for (const node of nodes) {
    if (visited.has(node.id)) {
      continue;
    }

    const found = visit(node.id, []);

    if (found) {
      return found;
    }
  }

  return null;
}
