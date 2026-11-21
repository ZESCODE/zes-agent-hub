import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, migrate } from '../../server/lib/db/pool.js';
import { createRepositories } from '../../server/lib/repositories/index.js';
import { createWorkflowRepository } from '../../server/lib/repositories/workflows.js';
import { createEngine } from '../../server/lib/workflows/engine.js';
import { createDefinitionService } from '../../server/lib/workflows/definition-service.js';
import { buildAgentRegistry } from '../../server/lib/agents/registry.js';

const registry = buildAgentRegistry({
  seats: [
    { id: 'castor', nicknameModel: 'castor@openai', role: 'orchestrator', mission: 'Plan', provider: 'pollinations', model: 'openai/gpt-6-astra' },
    { id: 'john', nicknameModel: 'john@openai', role: 'research', mission: 'Research', provider: 'pollinations', model: 'openai/gpt-6-astra' },
  ],
});

const dataDir = path.join(os.homedir(), '.tmp', 'pglite-workflow-designer');

function scoutDefinition(workflowId) {
  return {
    workflowId,
    version: 1,
    name: 'Persisted Scout',
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
        id: 'n_report',
        type: 'report',
        position: { x: 400, y: 0 },
        config: { artifactTypes: ['research_report'] },
      },
    ],
    edges: [
      { id: 'e1', source: 'n_castor', target: 'n_john' },
      { id: 'e2', source: 'n_john', target: 'n_report' },
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
    acceptanceCriteria: [],
  };
}

describe('workflow definitions across a restart', () => {
  let storedWorkflowId = null;

  beforeAll(async () => {
    fs.rmSync(dataDir, { recursive: true, force: true });

    const db = await createDatabase({ dataDir });
    await migrate(db);

    const repos = createRepositories(db);
    const workflowRepos = createWorkflowRepository(db);
    const engine = createEngine({ db, repos });
    const definitions = createDefinitionService({
      repos,
      workflowRepos,
      engine,
      registry,
      knownTaskTypes: () => ['plan', 'scout'],
    });

    storedWorkflowId = `persisted-scout-${Date.now()}`;

    const created = await definitions.createDefinition(scoutDefinition(storedWorkflowId), {
      ownerPrincipal: 'alice@zes.codes',
    });
    await definitions.publishDefinition(created.workflow_id, created.version, {
      ownerPrincipal: 'alice@zes.codes',
    });

    const owner = await repos.users.ensure({ email: 'alice@zes.codes' });
    const job = await engine.createJob({
      title: 'Persisted scout',
      objective: 'Scout the repository',
      ownerEmail: owner.email,
    });

    await definitions.attachToJob(job.id, { workflowId: created.workflow_id, version: created.version }, {
      ownerPrincipal: 'alice@zes.codes',
    });

    await db.close();
  });

  afterAll(() => {
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('keeps the workflow definition after the service restarts', async () => {
    const db = await createDatabase({ dataDir });
    await migrate(db);

    const workflowRepos = createWorkflowRepository(db);
    const stored = await workflowRepos.definitions.findVersion(storedWorkflowId, 1);

    expect(stored).toBeTruthy();
    expect(stored.status).toBe('published');
    expect(stored.owner_principal).toBe('alice@zes.codes');
    expect(stored.definition.nodes.map((node) => node.type)).toEqual(['castor', 'john', 'report']);

    await db.close();
  });

  it('keeps the workflow run and its snapshot after the service restarts', async () => {
    const db = await createDatabase({ dataDir });
    await migrate(db);

    const workflowRepos = createWorkflowRepository(db);
    const runs = await workflowRepos.runs.listByWorkflow(storedWorkflowId);

    expect(runs).toHaveLength(1);
    expect(runs[0].workflow_version).toBe(1);
    expect(runs[0].graph_snapshot.workflowId).toBe(storedWorkflowId);

    await db.close();
  });
});
