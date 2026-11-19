// zes-agent-hub — workflow graph helpers (zes.workflow/v1)
// Turns a validated definition into an execution order and into task contracts.
// The graph only describes work; the hub remains the owner of job and task state.

import { isAgentNodeType } from './node-types.js';

export function nodeMap(definition) {
  return new Map(definition.nodes.map((node) => [node.id, node]));
}

/**
 * Dependencies of every node: the nodes that must be settled before it runs.
 */
export function dependenciesOf(definition) {
  const dependencies = new Map(definition.nodes.map((node) => [node.id, new Set()]));

  for (const edge of definition.edges) {
    if (!dependencies.has(edge.target)) {
      continue;
    }

    dependencies.get(edge.target).add(edge.source);
  }

  return dependencies;
}

/**
 * Nodes with no incoming edge.
 */
export function entryNodes(definition) {
  const dependencies = dependenciesOf(definition);

  return definition.nodes.filter((node) => dependencies.get(node.id).size === 0).map((node) => node.id);
}

/**
 * Deterministic topological order. Nodes without edges keep their declared order.
 */
export function topologicalOrder(definition) {
  const dependencies = dependenciesOf(definition);
  const order = [];
  const placed = new Set();
  const remaining = definition.nodes.map((node) => node.id);

  while (remaining.length > 0) {
    const ready = remaining.filter((nodeId) =>
      [...dependencies.get(nodeId)].every((dependency) => placed.has(dependency)),
    );

    if (ready.length === 0) {
      break;
    }

    for (const nodeId of ready) {
      order.push(nodeId);
      placed.add(nodeId);
      remaining.splice(remaining.indexOf(nodeId), 1);
    }
  }

  return order;
}

/**
 * Direct successors of a node.
 */
export function successorsOf(definition, nodeId) {
  return definition.edges.filter((edge) => edge.source === nodeId).map((edge) => edge.target);
}

/**
 * Task contracts for a definition. Agent nodes become model tasks, tool nodes
 * become tool tasks and control nodes become gates that the scheduler waits on.
 */
export function materializeTasks(definition, { objective, userObjective } = {}) {
  const order = topologicalOrder(definition);
  const nodes = nodeMap(definition);
  const tasks = [];

  order.forEach((nodeId, index) => {
    const node = nodes.get(nodeId);
    const config = node.config || {};
    const base = {
      nodeId: node.id,
      nodeType: node.type,
      priority: index + 1,
      expectedOutputs: [],
      acceptanceCriteria: [],
      maxAttempts: node.retry?.maxAttempts || definition.execution.defaultMaxAttempts,
    };

    if (isAgentNodeType(node.type)) {
      tasks.push({
        ...base,
        kind: 'agent',
        assignedAgent: config.agentId,
        taskType: config.routingPolicy.taskType,
        objective:
          config.objective ||
          `${node.label || node.type} contributes to the workflow objective.`,
        input: {
          nodeId: node.id,
          routingPolicy: config.routingPolicy,
          userObjective: userObjective || objective || '',
          workflowId: definition.workflowId,
          workflowVersion: definition.version,
        },
        expectedOutputs: [`${node.label || node.type} result`],
        acceptanceCriteria: definition.acceptanceCriteria
          .filter((criterion) => criterion.verifierAgentId === config.agentId)
          .map((criterion) => criterion.description),
      });

      return;
    }

    if (node.type === 'approval_gate') {
      tasks.push({
        ...base,
        kind: 'approval',
        assignedAgent: 'castor',
        taskType: 'approval',
        objective: config.description || `Approval required for ${config.actionType}`,
        input: {
          nodeId: node.id,
          actionType: config.actionType,
          expiresInMinutes: config.expiresInMinutes || null,
          approvers: config.approvers || [],
        },
        expectedOutputs: ['approval decision'],
        acceptanceCriteria: ['An authorised operator decided the gate'],
      });

      return;
    }

    if (node.type === 'output') {
      tasks.push({
        ...base,
        kind: 'output',
        assignedAgent: 'castor',
        taskType: 'output',
        objective: config.reportName || 'Collect the workflow artifacts into the final report',
        input: {
          nodeId: node.id,
          artifactTypes: config.artifactTypes || [],
        },
        expectedOutputs: ['final report'],
        acceptanceCriteria: ['Every required artifact is present'],
      });

      return;
    }

    if (node.type === 'condition') {
      tasks.push({
        ...base,
        kind: 'condition',
        assignedAgent: 'castor',
        taskType: 'condition',
        objective: `Evaluate condition: ${config.expression}`,
        input: {
          nodeId: node.id,
          expression: config.expression,
          trueHandle: config.trueHandle || 'true',
          falseHandle: config.falseHandle || 'false',
        },
        expectedOutputs: ['branch'],
        acceptanceCriteria: ['Condition evaluated without error'],
      });

      return;
    }

    tasks.push({
      ...base,
      kind: 'tool',
      assignedAgent: 'castor',
      taskType: config.operation || 'tool',
      objective: `Run tool ${config.toolName}`,
      input: {
        nodeId: node.id,
        toolName: config.toolName,
        operation: config.operation,
        parameters: config.parameters || {},
        requiresApproval: Boolean(config.requiresApproval),
      },
      expectedOutputs: [`${config.toolName} result`],
      acceptanceCriteria: ['Tool reported success'],
    });
  });

  return tasks;
}

/**
 * The dependency edges between task ids, used by the scheduler to decide which
 * task may run next.
 */
export function taskDependencyEdges(definition, taskIdByNodeId) {
  const edges = [];

  for (const edge of definition.edges) {
    const source = taskIdByNodeId.get(edge.source);
    const target = taskIdByNodeId.get(edge.target);

    if (source && target) {
      edges.push({ source, target });
    }
  }

  return edges;
}
