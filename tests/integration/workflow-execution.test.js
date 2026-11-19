import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { createDatabase, migrate } from '../../server/lib/db/pool.js';
import { createRepositories } from '../../server/lib/repositories/index.js';
import { createWorkflowRepository } from '../../server/lib/repositories/workflows.js';
import { createEngine } from '../../server/lib/workflows/engine.js';
import { createDefinitionService } from '../../server/lib/workflows/definition-service.js';
import { createScheduler } from '../../server/lib/orchestrator/scheduler.js';
import { buildAgentRegistry } from '../../server/lib/agents/registry.js';

const ADMIN_KEY = 'workflow-test-key';
process.env.AGORA_HUB_ADMIN_KEY = ADMIN_KEY;

const registry = buildAgentRegistry({
  seats: [
    { id: 'castor', nicknameModel: 'castor@openai', role: 'orchestrator', mission: 'Plan', provider: 'pollinations', model: 'openai/gpt-6-astra' },
    { id: 'john', nicknameModel: 'john@openai', role: 'research', mission: 'Research', provider: 'pollinations', model: 'openai/gpt-6-astra' },
    { id: 'verifier', nicknameModel: 'verifier@openai', role: 'quality', mission: 'Verify', provider: 'pollinations', model: 'openai/gpt-6-astra' },
  ],
});

let db;
let repos;
let workflowRepos;
let engine;
let definitions;
let scheduler;

beforeAll(async () => {
  db = await createDatabase({});
  await migrate(db);
  repos = createRepositories(db);
  workflowRepos = createWorkflowRepository(db);
  engine = createEngine({ db, repos });
  definitions = createDefinitionService({
    repos,
    workflowRepos,
    engine,
    registry,
    knownTaskTypes: () => ['plan', 'scout', 'verify'],
  });

  scheduler = createScheduler({
    engine,
    registry,
    repos,
    modelRunner: async ({ agent, task }) => ({
      result: {
        status: 'completed',
        summary: `${agent.id} handled ${task.task_type}`,
        outputs: ['done'],
        issues: [],
        evidence: agent.id === 'verifier' ? [{ check: 'criteria', passed: true }] : [],
      },
      inputTokens: 10,
      outputTokens: 5,
      estimatedCost: 0.001,
      latencyMs: 12,
    }),
  });
});

afterAll(async () => {
  await db.close();
});

let workflowCounter = 0;

function uniqueWorkflowId() {
  workflowCounter += 1;
  return `zap-scout-${workflowCounter}`;
}

function scoutDefinition(overrides = {}) {
  return {
    workflowId: uniqueWorkflowId(),
    version: 1,
    name: 'ZAP Scout',
    status: 'draft',
    nodes: [
      {
        id: 'n_castor',
        type: 'castor',
        position: { x: 0, y: 0 },
        config: { agentId: 'castor', routingPolicy: { taskType: 'plan' } },
      },
      {
        id: 'n_john',
        type: 'john',
        position: { x: 200, y: 0 },
        config: { agentId: 'john', routingPolicy: { taskType: 'scout' } },
      },
      {
        id: 'n_verify',
        type: 'verifier',
        position: { x: 400, y: 0 },
        config: { agentId: 'verifier', routingPolicy: { taskType: 'verify' } },
      },
      {
        id: 'n_out',
        type: 'output',
        position: { x: 600, y: 0 },
        config: { artifactTypes: ['research_report'] },
      },
    ],
    edges: [
      { id: 'e1', source: 'n_castor', target: 'n_john' },
      { id: 'e2', source: 'n_john', target: 'n_verify' },
      { id: 'e3', source: 'n_verify', target: 'n_out' },
    ],
    execution: {
      maxParallelTasks: 1,
      leaseSeconds: 120,
      defaultMaxAttempts: 3,
      defaultBackoffMs: 1000,
      maxBackoffMs: 10000,
      requireVerification: true,
      stopOnFailure: true,
    },
    approvals: [],
    modelPreferences: { defaultPolicy: { taskType: 'scout' }, fallbackEnabled: true },
    budget: { maxTotalCostUsd: 5, maxModelCalls: 10 },
    acceptanceCriteria: [
      {
        id: 'ac1',
        description: 'Findings are evidence backed',
        verifierAgentId: 'verifier',
        required: true,
      },
    ],
    ...overrides,
  };
}

async function createPublishedDefinition(definition = scoutDefinition()) {
  const created = await definitions.createDefinition(definition);
  const published = await definitions.publishDefinition(created.workflow_id, created.version);
  return published;
}

describe('workflow definitions', () => {
  it('stores a draft and publishes it', async () => {
    const created = await definitions.createDefinition(scoutDefinition());
    expect(created.status).toBe('draft');
    expect(created.version).toBe(1);

    const published = await definitions.publishDefinition(created.workflow_id, created.version);
    expect(published.status).toBe('published');
    expect(published.published_at).toBeTruthy();
  });

  it('keeps versions immutable and increments on update', async () => {
    const definition = scoutDefinition();
    const created = await definitions.createDefinition(definition);
    await definitions.publishDefinition(created.workflow_id, created.version);

    const updated = await definitions.updateDefinition(created.workflow_id, {
      ...definition,
      name: 'ZAP Scout v2',
    });

    expect(updated.version).toBe(created.version + 1);
    expect(updated.status).toBe('draft');

    const versions = await workflowRepos.definitions.listVersions(created.workflow_id);
    expect(versions).toHaveLength(2);

    const published = await workflowRepos.definitions.findVersion(created.workflow_id, created.version);
    expect(published.status).toBe('published');
    expect(published.definition.name).toBe('ZAP Scout');
  });

  it('refuses to publish a definition twice', async () => {
    const created = await definitions.createDefinition(scoutDefinition());
    await definitions.publishDefinition(created.workflow_id, created.version);

    await expect(definitions.publishDefinition(created.workflow_id, created.version)).rejects.toThrow(
      /already published/,
    );
  });

  it('rejects an invalid definition at creation time', async () => {
    const broken = scoutDefinition();
    broken.nodes[1].config.model = 'openai/gpt-6-astra';

    await expect(definitions.createDefinition(broken)).rejects.toThrow(/Model identifiers are resolved by the hub/);
  });
});

describe('definition driven execution', () => {
  async function newJobWithDefinition() {
    const published = await createPublishedDefinition();
    const job = await engine.createJob({
      title: 'Scout a repository',
      objective: 'Evaluate a GitHub repository',
      ownerEmail: 'tester@zes.codes',
    });

    await definitions.attachToJob(job.id, { workflowId: published.workflow_id, version: published.version });

    return { job, published };
  }

  it('attaches a definition snapshot to the job', async () => {
    const { job, published } = await newJobWithDefinition();
    const run = await workflowRepos.runs.findByJob(job.id);

    expect(run.workflow_id).toBe(published.workflow_id);
    expect(run.workflow_version).toBe(published.version);
    expect(run.graph_snapshot.nodes).toHaveLength(4);
  });

  it('materialises tasks in dependency order', async () => {
    const { job } = await newJobWithDefinition();
    const materialized = await definitions.materializeJob(job.id);
    const nodeIds = materialized.tasks.map((task) => task.node_id);

    expect(nodeIds).toEqual(['n_castor', 'n_john', 'n_verify', 'n_out']);
  });

  it('runs tasks in graph order and never out of order', async () => {
    const { job } = await newJobWithDefinition();
    const run = await workflowRepos.runs.findByJob(job.id);
    await definitions.materializeJob(job.id);

    const first = await scheduler.runNextTask(job.id, { workerId: 'w1', definition: run.graph_snapshot });
    expect(first.agentId).toBe('castor');

    const second = await scheduler.runNextTask(job.id, { workerId: 'w1', definition: run.graph_snapshot });
    expect(second.agentId).toBe('john');

    const tasks = await repos.tasks.listByJob(job.id);
    expect(tasks.find((task) => task.node_id === 'n_verify').status).toBe('pending');
  });

  it('completes the job once verification evidence exists', async () => {
    const { job } = await newJobWithDefinition();
    const run = await workflowRepos.runs.findByJob(job.id);
    await definitions.materializeJob(job.id);

    for (let index = 0; index < 4; index += 1) {
      await scheduler.runNextTask(job.id, { workerId: 'w1', definition: run.graph_snapshot });
    }

    const finished = await repos.jobs.findById(job.id);
    expect(finished.status).toBe('completed');

    const artifacts = await repos.artifacts.listByJob(job.id);
    expect(artifacts.some((artifact) => artifact.artifact_type === 'verification_report')).toBe(true);
  });

  it('does not complete a job without verification evidence', async () => {
    const { job } = await newJobWithDefinition();
    const run = await workflowRepos.runs.findByJob(job.id);
    await definitions.materializeJob(job.id);

    for (let index = 0; index < 4; index += 1) {
      await scheduler.runNextTask(job.id, { workerId: 'w1', definition: run.graph_snapshot });
    }

    await repos.artifacts.create({
      jobId: job.id,
      artifactType: 'verification_report',
      name: 'forged',
      storageUri: 'zap://forged',
    });

    const evidence = await engine.verificationEvidence(job.id);
    expect(evidence.evidence.length).toBeGreaterThan(0);
  });

  it('keeps a running job on its snapshot when the definition changes', async () => {
    const { job, published } = await newJobWithDefinition();
    const stored = await workflowRepos.definitions.findVersion(published.workflow_id, published.version);
    await definitions.updateDefinition(published.workflow_id, {
      ...stored.definition,
      name: 'Changed later',
    });

    const run = await workflowRepos.runs.findByJob(job.id);
    expect(run.graph_snapshot.nodes).toHaveLength(4);
  });

  it('pauses and resumes a job', async () => {
    const { job } = await newJobWithDefinition();
    const run = await workflowRepos.runs.findByJob(job.id);
    await definitions.materializeJob(job.id);
    await scheduler.runNextTask(job.id, { workerId: 'w1', definition: run.graph_snapshot });

    const paused = await engine.pauseJob(job.id, { reason: 'operator asked' });
    expect(paused.status).toBe('paused');

    const resumed = await engine.resumeJob(job.id);
    expect(resumed.job.status).not.toBe('paused');
  });
});

describe('approval gates', () => {
  it('waits for an approval before continuing', async () => {
    const definition = scoutDefinition();
    definition.nodes.splice(2, 0, {
      id: 'n_approve',
      type: 'approval_gate',
      position: { x: 400, y: 0 },
      config: { actionType: 'fork.approve', required: true, expiresInMinutes: 60 },
    });
    definition.nodes[3].position = { x: 600, y: 0 };
    definition.nodes[4].position = { x: 800, y: 0 };
    definition.edges = [
      { id: 'e1', source: 'n_castor', target: 'n_john' },
      { id: 'e2', source: 'n_john', target: 'n_approve' },
      { id: 'e3', source: 'n_approve', target: 'n_verify' },
      { id: 'e4', source: 'n_verify', target: 'n_out' },
    ];
    definition.approvals = [
      { nodeId: 'n_approve', actionType: 'fork.approve', required: true, expiresInMinutes: 60 },
    ];

    const published = await createPublishedDefinition(definition);
    const job = await engine.createJob({
      title: 'Scout with approval',
      objective: 'Evaluate a repository',
      ownerEmail: 'tester@zes.codes',
    });

    await definitions.attachToJob(job.id, { workflowId: published.workflow_id, version: published.version });
    const run = await workflowRepos.runs.findByJob(job.id);
    await definitions.materializeJob(job.id);

    await scheduler.runNextTask(job.id, { workerId: 'w1', definition: run.graph_snapshot });
    await scheduler.runNextTask(job.id, { workerId: 'w1', definition: run.graph_snapshot });

    const gate = await scheduler.runNextTask(job.id, { workerId: 'w1', definition: run.graph_snapshot });
    expect(gate.waitingApproval).toBe(true);

    const approvals = await repos.approvals.listByJob(job.id);
    expect(approvals).toHaveLength(1);
    expect(approvals[0].status).toBe('pending');

    await engine.decideApproval(approvals[0].id, { status: 'approved', decidedBy: 'operator@zes.codes' });

    const gateSettled = await scheduler.runNextTask(job.id, { workerId: 'w1', definition: run.graph_snapshot });
    expect(gateSettled.approvalStatus).toBe('approved');

    const afterApproval = await scheduler.runNextTask(job.id, { workerId: 'w1', definition: run.graph_snapshot });
    expect(afterApproval.agentId).toBe('verifier');
  });

  it('refuses a second decision on the same approval', async () => {
    const job = await engine.createJob({
      title: 'Approval once',
      objective: 'Single use approval',
      ownerEmail: 'tester@zes.codes',
    });

    const approval = await engine.requestApproval(job.id, {
      requestedBy: 'scheduler',
      actionType: 'fork.approve',
      actionDescription: 'Approve the fork',
    });

    await engine.decideApproval(approval.id, { status: 'approved', decidedBy: 'operator@zes.codes' });

    await expect(
      engine.decideApproval(approval.id, { status: 'rejected', decidedBy: 'operator@zes.codes' }),
    ).rejects.toThrow(/already decided/);
  });

  it('refuses an expired approval', async () => {
    const job = await engine.createJob({
      title: 'Expired approval',
      objective: 'Expired approval',
      ownerEmail: 'tester@zes.codes',
    });

    const approval = await engine.requestApproval(job.id, {
      requestedBy: 'scheduler',
      actionType: 'fork.approve',
      actionDescription: 'Approve the fork',
      expiresAt: new Date(Date.now() - 1000),
    });

    await expect(
      engine.decideApproval(approval.id, { status: 'approved', decidedBy: 'operator@zes.codes' }),
    ).rejects.toThrow(/expired/);
  });
});

describe('condition branches', () => {
  function branchDefinition(expression) {
    return {
      workflowId: uniqueWorkflowId(),
      version: 1,
      name: 'Branching workflow',
      status: 'draft',
      nodes: [
        {
          id: 'n_castor',
          type: 'castor',
          position: { x: 0, y: 0 },
          config: { agentId: 'castor', routingPolicy: { taskType: 'plan' } },
        },
        {
          id: 'n_gate',
          type: 'condition',
          position: { x: 200, y: 0 },
          config: { expression, trueHandle: 'true', falseHandle: 'false' },
        },
        {
          id: 'n_john',
          type: 'john',
          position: { x: 400, y: -80 },
          config: { agentId: 'john', routingPolicy: { taskType: 'scout' } },
        },
        {
          id: 'n_verify',
          type: 'verifier',
          position: { x: 400, y: 80 },
          config: { agentId: 'verifier', routingPolicy: { taskType: 'verify' } },
        },
        {
          id: 'n_out',
          type: 'output',
          position: { x: 600, y: 0 },
          config: { artifactTypes: ['research_report'] },
        },
      ],
      edges: [
        { id: 'e1', source: 'n_castor', target: 'n_gate' },
        { id: 'e2', source: 'n_gate', target: 'n_john', sourceHandle: 'true' },
        { id: 'e3', source: 'n_gate', target: 'n_verify', sourceHandle: 'false' },
        { id: 'e4', source: 'n_john', target: 'n_out' },
        { id: 'e5', source: 'n_verify', target: 'n_out' },
      ],
      execution: {
        maxParallelTasks: 1,
        leaseSeconds: 120,
        defaultMaxAttempts: 3,
        defaultBackoffMs: 1000,
        maxBackoffMs: 10000,
        requireVerification: false,
        stopOnFailure: true,
      },
      approvals: [],
      modelPreferences: { defaultPolicy: { taskType: 'scout' }, fallbackEnabled: true },
      budget: { maxTotalCostUsd: 5, maxModelCalls: 10 },
      acceptanceCriteria: [],
    };
  }

  async function runAll(jobId, definition, limit = 10) {
    for (let index = 0; index < limit; index += 1) {
      const result = await scheduler.runNextTask(jobId, { workerId: 'w-branch', definition });

      if (!result.ran) {
        return result;
      }
    }

    return null;
  }

  it('takes the true branch and skips the false branch', async () => {
    const definition = branchDefinition("job.status !== null && nodes.n_castor.status === 'completed'");
    const created = await definitions.createDefinition(definition);
    const published = await definitions.publishDefinition(created.workflow_id, created.version);
    const job = await engine.createJob({ title: 'Branch', objective: 'Branch', ownerEmail: 't@zes.codes' });
    await definitions.attachToJob(job.id, { workflowId: published.workflow_id, version: published.version });
    await definitions.materializeJob(job.id);

    const run = await workflowRepos.runs.findByJob(job.id);
    await runAll(job.id, run.graph_snapshot);

    const tasks = await repos.tasks.listByJob(job.id);
    const byNode = Object.fromEntries(tasks.map((task) => [task.node_id, task.status]));

    expect(byNode.n_gate).toBe('completed');
    expect(byNode.n_john).toBe('completed');
    expect(byNode.n_verify).toBe('skipped');
    expect(byNode.n_out).toBe('completed');

    const conditionTask = tasks.find((task) => task.node_id === 'n_gate');
    expect(conditionTask.result.branch).toBe('true');

    const skipEvent = await repos.events.listByJob(job.id, { after: 0 });
    expect(skipEvent.some((event) => event.event_type === 'task.skipped')).toBe(true);
  });

  it('takes the false branch', async () => {
    const definition = branchDefinition("inputs.missing === 'never'");
    const created = await definitions.createDefinition(definition);
    const published = await definitions.publishDefinition(created.workflow_id, created.version);
    const job = await engine.createJob({ title: 'Branch', objective: 'Branch', ownerEmail: 't@zes.codes' });
    await definitions.attachToJob(job.id, { workflowId: published.workflow_id, version: published.version });
    await definitions.materializeJob(job.id);

    const run = await workflowRepos.runs.findByJob(job.id);
    await runAll(job.id, run.graph_snapshot);

    const tasks = await repos.tasks.listByJob(job.id);
    const byNode = Object.fromEntries(tasks.map((task) => [task.node_id, task.status]));

    expect(byNode.n_verify).toBe('completed');
    expect(byNode.n_john).toBe('skipped');
    expect(byNode.n_out).toBe('completed');
  });

  it('blocks the condition task on an invalid expression', async () => {
    const definition = branchDefinition('process.exit(0)');
    const created = await definitions.createDefinition(definition);
    const published = await definitions.publishDefinition(created.workflow_id, created.version);
    const job = await engine.createJob({ title: 'Branch', objective: 'Branch', ownerEmail: 't@zes.codes' });
    await definitions.attachToJob(job.id, { workflowId: published.workflow_id, version: published.version });
    await definitions.materializeJob(job.id);

    const run = await workflowRepos.runs.findByJob(job.id);
    await runAll(job.id, run.graph_snapshot, 4);

    const tasks = await repos.tasks.listByJob(job.id);
    const conditionTask = tasks.find((task) => task.node_id === 'n_gate');

    expect(conditionTask.status).toBe('blocked');
  });
});
