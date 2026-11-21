import { describe, expect, it } from 'vitest';
import {
  WORKFLOW_CONTRACT_VERSION,
  WorkflowValidationError,
  validateWorkflowDefinition,
  findCycle,
} from '../../server/lib/workflows/contract.js';
import {
  NODE_TYPES,
  describeNodeTypes,
  knownToolNames,
  toolPermissions,
} from '../../server/lib/workflows/node-types.js';
import { topologicalOrder, materializeTasks, dependenciesOf } from '../../server/lib/workflows/graph.js';

const registry = {
  find: (id) => {
    const permissions = {
      castor: ['model.generate', 'task.assign', 'approval.request'],
      john: ['model.generate', 'github.repository.read'],
      siti: ['model.generate'],
      laurent: ['model.generate'],
      labu: ['model.generate', 'deployment.preview'],
      verifier: ['model.generate', 'verification.read', 'qc.run'],
    };

    if (!permissions[id]) {
      return null;
    }

    return { id, enabled: true, permissions: permissions[id] };
  },
};

const knownTaskTypes = () => ['plan', 'scout', 'research', 'design', 'build', 'deploy', 'verify'];

function baseDefinition(overrides = {}) {
  return {
    workflowId: 'zap-scout',
    version: 1,
    name: 'ZAP Scout',
    status: 'draft',
    nodes: [
      {
        id: 'n_castor',
        type: 'castor',
        position: { x: 0, y: 0 },
        config: { agentId: 'castor', routingPolicy: { taskType: 'plan', complexity: 'high' } },
      },
      {
        id: 'n_john',
        type: 'john',
        position: { x: 200, y: 0 },
        config: { agentId: 'john', routingPolicy: { taskType: 'scout' } },
      },
      {
        id: 'n_out',
        type: 'output',
        position: { x: 400, y: 0 },
        config: { artifactTypes: ['research_report'] },
      },
    ],
    edges: [
      { id: 'e1', source: 'n_castor', target: 'n_john' },
      { id: 'e2', source: 'n_john', target: 'n_out' },
    ],
    execution: {
      maxParallelTasks: 2,
      leaseSeconds: 120,
      defaultMaxAttempts: 3,
      defaultBackoffMs: 2000,
      maxBackoffMs: 60000,
      requireVerification: true,
      stopOnFailure: true,
    },
    approvals: [],
    modelPreferences: { defaultPolicy: { taskType: 'scout' }, fallbackEnabled: true },
    budget: { maxTotalCostUsd: 5, maxModelCalls: 10 },
    acceptanceCriteria: [],
    ...overrides,
  };
}

describe('workflow contract', () => {
  it('accepts a valid definition', () => {
    const definition = validateWorkflowDefinition(baseDefinition(), { registry, knownTaskTypes });

    expect(definition.workflowId).toBe('zap-scout');
    expect(definition.nodes).toHaveLength(3);
  });

  it('exposes a stable contract version', () => {
    expect(WORKFLOW_CONTRACT_VERSION).toBe('zes.workflow/v1');
  });

  it('rejects a definition with an unknown node type', () => {
    const definition = baseDefinition();
    definition.nodes[1].type = 'mystery';

    expect(() => validateWorkflowDefinition(definition, { registry, knownTaskTypes })).toThrow(
      WorkflowValidationError,
    );
  });

  it('rejects a definition whose agent does not exist', () => {
    const definition = baseDefinition();
    definition.nodes[1].config.agentId = 'ghost';

    expect(() => validateWorkflowDefinition(definition, { registry, knownTaskTypes })).toThrow(/Unknown agent/);
  });

  it('rejects a node bound to an agent without the required permissions', () => {
    const definition = baseDefinition();
    definition.nodes[1].type = 'laurent';
    definition.nodes[1].config.agentId = 'laurent';

    expect(() => validateWorkflowDefinition(definition, { registry, knownTaskTypes })).toThrow(/lacks permissions/);
  });

  it('rejects an unknown routing policy task type', () => {
    const definition = baseDefinition();
    definition.nodes[1].config.routingPolicy.taskType = 'teleport';

    expect(() => validateWorkflowDefinition(definition, { registry, knownTaskTypes })).toThrow(/Unknown task type/);
  });

  it('rejects a browser supplied model identifier', () => {
    const definition = baseDefinition();
    definition.nodes[1].config.model = 'openai/gpt-6-astra';

    expect(() => validateWorkflowDefinition(definition, { registry, knownTaskTypes })).toThrow(
      /Model identifiers are resolved by the hub/,
    );
  });

  it('rejects a cycle', () => {
    const definition = baseDefinition();
    definition.edges.push({ id: 'e3', source: 'n_out', target: 'n_castor' });

    expect(() => validateWorkflowDefinition(definition, { registry, knownTaskTypes })).toThrow(/cycle/);
  });

  it('rejects a workflow without an output node', () => {
    const definition = baseDefinition();
    definition.nodes = definition.nodes.filter((node) => node.type !== 'output');
    definition.edges = definition.edges.filter((edge) => edge.target !== 'n_out');

    expect(() => validateWorkflowDefinition(definition, { registry, knownTaskTypes })).toThrow(
      /output or report node/,
    );
  });

  it('accepts a start node and a report node', () => {
    const definition = baseDefinition();
    definition.nodes = [
      {
        id: 'n_start',
        type: 'start',
        position: { x: 0, y: 0 },
        config: { trigger: 'manual', objective: 'Scout the repository' },
      },
      ...definition.nodes,
      {
        id: 'n_report',
        type: 'report',
        position: { x: 600, y: 0 },
        config: { artifactTypes: ['research_report'] },
      },
    ];
    definition.edges = [
      { id: 'e0', source: 'n_start', target: 'n_castor' },
      ...definition.edges,
      { id: 'e3', source: 'n_out', target: 'n_report' },
    ];

    const validated = validateWorkflowDefinition(definition, { registry, knownTaskTypes });

    expect(validated.nodes).toHaveLength(5);
    expect(validated.nodes[0].type).toBe('start');
  });

  it('rejects a second start node', () => {
    const definition = baseDefinition();
    definition.nodes.push({
      id: 'n_start',
      type: 'start',
      position: { x: 0, y: 200 },
      config: { trigger: 'manual' },
    });
    definition.nodes.push({
      id: 'n_start_2',
      type: 'start',
      position: { x: 0, y: 400 },
      config: { trigger: 'api' },
    });

    expect(() => validateWorkflowDefinition(definition, { registry, knownTaskTypes })).toThrow(
      /only one start node/,
    );
  });

  it('rejects an edge that points into the start node', () => {
    const definition = baseDefinition();
    definition.nodes.push({
      id: 'n_start',
      type: 'start',
      position: { x: 0, y: 200 },
      config: { trigger: 'manual' },
    });
    definition.edges.push({ id: 'e3', source: 'n_john', target: 'n_start' });

    expect(() => validateWorkflowDefinition(definition, { registry, knownTaskTypes })).toThrow(
      /start node cannot have incoming edges/,
    );
  });

  it('requires an approval for a protected deployment action', () => {
    const definition = baseDefinition();
    definition.nodes.push({
      id: 'n_deploy',
      type: 'deployment_tool',
      position: { x: 600, y: 0 },
      config: { toolName: 'deployment.publish', operation: 'deployment.publish', parameters: {}, requiresApproval: true },
    });
    definition.edges.push({ id: 'e3', source: 'n_out', target: 'n_deploy' });

    expect(() => validateWorkflowDefinition(definition, { registry, knownTaskTypes })).toThrow(
      /requires an approval/,
    );
  });

  it('requires a budget', () => {
    const definition = baseDefinition({ budget: {} });

    expect(() => validateWorkflowDefinition(definition, { registry, knownTaskTypes })).toThrow(/budget/);
  });

  it('requires a verifier node when acceptance criteria exist', () => {
    const definition = baseDefinition({
      acceptanceCriteria: [
        {
          id: 'ac1',
          description: 'Findings are evidence backed',
          verifierAgentId: 'verifier',
          required: true,
        },
      ],
    });

    expect(() => validateWorkflowDefinition(definition, { registry, knownTaskTypes })).toThrow(/verifier node/);
  });
});

describe('workflow node types', () => {
  it('describes every node type', () => {
    const described = describeNodeTypes();

    expect(described).toHaveLength(NODE_TYPES.length);
    expect(described.map((entry) => entry.type).sort()).toEqual([...NODE_TYPES].sort());
  });

  it('never exposes a model identifier', () => {
    const described = describeNodeTypes();

    for (const entry of described) {
      expect(entry.defaultRoutingPolicy?.model).toBeUndefined();
      expect(entry.model).toBeUndefined();
    }
  });

  it('maps every tool to permissions', () => {
    for (const toolName of knownToolNames()) {
      expect(toolPermissions(toolName).length).toBeGreaterThan(0);
    }
  });
});

describe('workflow graph', () => {
  it('orders nodes topologically', () => {
    const definition = validateWorkflowDefinition(baseDefinition(), { registry, knownTaskTypes });

    expect(topologicalOrder(definition)).toEqual(['n_castor', 'n_john', 'n_out']);
  });

  it('reports dependencies', () => {
    const definition = validateWorkflowDefinition(baseDefinition(), { registry, knownTaskTypes });
    const dependencies = dependenciesOf(definition);

    expect([...dependencies.get('n_john')]).toEqual(['n_castor']);
    expect([...dependencies.get('n_castor')]).toEqual([]);
  });

  it('detects a cycle directly', () => {
    const nodes = [{ id: 'a' }, { id: 'b' }];
    const edges = [
      { id: '1', source: 'a', target: 'b' },
      { id: '2', source: 'b', target: 'a' },
    ];

    expect(findCycle(nodes, edges)).toEqual(['a', 'b', 'a']);
  });

  it('materialises tasks in dependency order', () => {
    const definition = validateWorkflowDefinition(baseDefinition(), { registry, knownTaskTypes });
    const tasks = materializeTasks(definition, { objective: 'find a repo' });

    expect(tasks.map((task) => task.nodeId)).toEqual(['n_castor', 'n_john', 'n_out']);
    expect(tasks[0].kind).toBe('agent');
    expect(tasks[2].kind).toBe('output');
  });

  it('materialises a start node as a marker and a report node as an output task', () => {
    const definition = baseDefinition();
    definition.nodes = [
      {
        id: 'n_start',
        type: 'start',
        position: { x: 0, y: 0 },
        config: { trigger: 'manual', objective: 'Scout the repository' },
      },
      ...definition.nodes,
      {
        id: 'n_report',
        type: 'report',
        position: { x: 600, y: 0 },
        config: { artifactTypes: ['research_report'] },
      },
    ];
    definition.edges = [
      { id: 'e0', source: 'n_start', target: 'n_castor' },
      ...definition.edges,
      { id: 'e3', source: 'n_out', target: 'n_report' },
    ];

    const validated = validateWorkflowDefinition(definition, { registry, knownTaskTypes });
    const tasks = materializeTasks(validated, { objective: 'find a repo' });

    expect(tasks.map((task) => task.nodeId)).toEqual(['n_castor', 'n_john', 'n_out', 'n_report']);
    expect(tasks[3].kind).toBe('output');
  });
});

describe('scout template contract', () => {
  function scoutDefinition() {
    return {
      workflowId: 'scout-zescode-zes-builder',
      version: 1,
      name: 'Scout ZESCODE/zes-builder',
      status: 'draft',
      nodes: [
        {
          id: 'castor_plan',
          type: 'castor',
          position: { x: 0, y: 0 },
          config: {
            agentId: 'castor',
            routingPolicy: { taskType: 'plan', complexity: 'high' },
            objective: 'Plan the evaluation of https://github.com/ZESCODE/zes-builder',
          },
        },
        {
          id: 'github_read',
          type: 'github_tool',
          position: { x: 260, y: 0 },
          config: {
            toolName: 'github.repository.read',
            operation: 'read',
            parameters: { owner: 'ZESCODE', repo: 'zes-builder' },
            requiresApproval: false,
          },
        },
        {
          id: 'john_scout',
          type: 'john',
          position: { x: 520, y: 0 },
          config: {
            agentId: 'john',
            routingPolicy: { taskType: 'scout', complexity: 'medium' },
          },
        },
        {
          id: 'verifier_check',
          type: 'verifier',
          position: { x: 780, y: 0 },
          config: {
            agentId: 'verifier',
            routingPolicy: { taskType: 'verify', complexity: 'high' },
          },
        },
        {
          id: 'report_output',
          type: 'output',
          position: { x: 1040, y: 0 },
          config: { artifactTypes: ['research_report', 'verification_report'] },
        },
      ],
      edges: [
        { id: 'e1', source: 'castor_plan', target: 'github_read' },
        { id: 'e2', source: 'github_read', target: 'john_scout' },
        { id: 'e3', source: 'john_scout', target: 'verifier_check' },
        { id: 'e4', source: 'verifier_check', target: 'report_output' },
      ],
      execution: {
        maxParallelTasks: 1,
        leaseSeconds: 120,
        defaultMaxAttempts: 3,
        defaultBackoffMs: 1000,
        maxBackoffMs: 30000,
        requireVerification: true,
        stopOnFailure: true,
      },
      approvals: [],
      modelPreferences: { defaultPolicy: { taskType: 'scout' }, fallbackEnabled: true },
      budget: { maxTotalCostUsd: 5, maxModelCalls: 200 },
      acceptanceCriteria: [
        {
          id: 'criterion_1',
          description: 'The report names the top level files the GitHub tool returned.',
          verifierAgentId: 'verifier',
          required: true,
        },
      ],
    };
  }

  it('accepts the scout template', () => {
    const definition = validateWorkflowDefinition(scoutDefinition(), { registry, knownTaskTypes });

    expect(definition.nodes).toHaveLength(5);
    expect(definition.acceptanceCriteria).toHaveLength(1);
  });

  it('materialises the scout template in dependency order', () => {
    const definition = validateWorkflowDefinition(scoutDefinition(), { registry, knownTaskTypes });
    const tasks = materializeTasks(definition, { objective: 'Evaluate the repository' });

    expect(tasks.map((task) => task.nodeId)).toEqual([
      'castor_plan',
      'github_read',
      'john_scout',
      'verifier_check',
      'report_output',
    ]);
  });
});
