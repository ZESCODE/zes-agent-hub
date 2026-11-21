import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { createDatabase, migrate } from '../../server/lib/db/pool.js';
import { createRepositories } from '../../server/lib/repositories/index.js';
import { createWorkflowRepository } from '../../server/lib/repositories/workflows.js';
import { createEngine } from '../../server/lib/workflows/engine.js';
import { createDefinitionService, WorkflowAccessError } from '../../server/lib/workflows/definition-service.js';
import { buildAgentRegistry } from '../../server/lib/agents/registry.js';

const ADMIN_KEY = 'workflow-ownership-key';
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
});

afterAll(async () => {
  await db.close();
});

let counter = 0;

function uniqueWorkflowId() {
  counter += 1;
  return `owned-scout-${counter}`;
}

function scoutDefinition(workflowId = uniqueWorkflowId()) {
  return {
    workflowId,
    version: 1,
    name: 'Owned Scout',
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
        type: 'report',
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
    acceptanceCriteria: [],
  };
}

describe('workflow ownership', () => {
  it('records the owner of a definition', async () => {
    const created = await definitions.createDefinition(scoutDefinition(), { ownerPrincipal: 'alice@zes.codes' });

    expect(created.owner_principal).toBe('alice@zes.codes');
  });

  it('keeps a definition without an owner visible to every caller', async () => {
    const created = await definitions.createDefinition(scoutDefinition(), { ownerPrincipal: null });

    const found = await workflowRepos.definitions.findVersion(created.workflow_id, created.version);

    expect(found.owner_principal).toBeNull();
  });

  it('lets the owner read, edit and publish the definition', async () => {
    const definition = scoutDefinition();
    const created = await definitions.createDefinition(definition, { ownerPrincipal: 'alice@zes.codes' });

    const resolved = await definitions.resolveDefinition(created.workflow_id, created.version, {
      ownerPrincipal: 'alice@zes.codes',
    });
    expect(resolved.workflow_id).toBe(created.workflow_id);

    const updated = await definitions.updateDefinition(
      created.workflow_id,
      { ...definition, name: 'Owned Scout v2' },
      { ownerPrincipal: 'alice@zes.codes' },
    );
    expect(updated.version).toBe(created.version + 1);

    const published = await definitions.publishDefinition(created.workflow_id, updated.version, {
      ownerPrincipal: 'alice@zes.codes',
    });
    expect(published.status).toBe('published');
  });

  it('does not let another user read the definition', async () => {
    const created = await definitions.createDefinition(scoutDefinition(), { ownerPrincipal: 'alice@zes.codes' });

    await expect(
      definitions.resolveDefinition(created.workflow_id, created.version, { ownerPrincipal: 'bob@zes.codes' }),
    ).rejects.toThrow(WorkflowAccessError);
  });

  it('does not let another user edit the definition', async () => {
    const created = await definitions.createDefinition(scoutDefinition(), { ownerPrincipal: 'alice@zes.codes' });

    await expect(
      definitions.updateDefinition(created.workflow_id, scoutDefinition(created.workflow_id), {
        ownerPrincipal: 'bob@zes.codes',
      }),
    ).rejects.toThrow(/not allowed to edit/);
  });

  it('does not let another user publish the definition', async () => {
    const created = await definitions.createDefinition(scoutDefinition(), { ownerPrincipal: 'alice@zes.codes' });

    await expect(
      definitions.publishDefinition(created.workflow_id, created.version, { ownerPrincipal: 'bob@zes.codes' }),
    ).rejects.toThrow(/not allowed to publish/);
  });

  it('does not let another user delete the definition', async () => {
    const created = await definitions.createDefinition(scoutDefinition(), { ownerPrincipal: 'alice@zes.codes' });

    await expect(
      definitions.deleteDefinition(created.workflow_id, { ownerPrincipal: 'bob@zes.codes' }),
    ).rejects.toThrow(/not allowed to delete/);
  });

  it('does not let another user start a job with the definition', async () => {
    const created = await definitions.createDefinition(scoutDefinition(), { ownerPrincipal: 'alice@zes.codes' });
    await definitions.publishDefinition(created.workflow_id, created.version, { ownerPrincipal: 'alice@zes.codes' });

    const owner = await repos.users.ensure({ email: 'alice@zes.codes' });
    const job = await engine.createJob({
      title: 'Owned scout',
      objective: 'Scout the repository',
      ownerEmail: owner.email,
    });

    await expect(
      definitions.attachToJob(job.id, { workflowId: created.workflow_id, version: created.version }, {
        ownerPrincipal: 'bob@zes.codes',
      }),
    ).rejects.toThrow(/not allowed to run/);
  });

  it('lets the owner start a job with the definition', async () => {
    const created = await definitions.createDefinition(scoutDefinition(), { ownerPrincipal: 'alice@zes.codes' });
    await definitions.publishDefinition(created.workflow_id, created.version, { ownerPrincipal: 'alice@zes.codes' });

    const owner = await repos.users.ensure({ email: 'alice@zes.codes' });
    const job = await engine.createJob({
      title: 'Owned scout',
      objective: 'Scout the repository',
      ownerEmail: owner.email,
    });

    const attached = await definitions.attachToJob(
      job.id,
      { workflowId: created.workflow_id, version: created.version },
      { ownerPrincipal: 'alice@zes.codes' },
    );

    expect(attached.run.workflow_version).toBe(created.version);
    expect(attached.definition.workflowId).toBe(created.workflow_id);
  });

  it('lists only the definitions of the caller and the shared ones', async () => {
    const privateWorkflow = scoutDefinition();
    await definitions.createDefinition(privateWorkflow, { ownerPrincipal: 'alice@zes.codes' });
    await definitions.createDefinition(scoutDefinition(), { ownerPrincipal: null });

    const forAlice = await workflowRepos.definitions.list({ ownerPrincipal: 'alice@zes.codes' });
    const forBob = await workflowRepos.definitions.list({ ownerPrincipal: 'bob@zes.codes' });

    expect(forAlice.some((entry) => entry.workflow_id === privateWorkflow.workflowId)).toBe(true);
    expect(forBob.some((entry) => entry.workflow_id === privateWorkflow.workflowId)).toBe(false);
    expect(forBob.every((entry) => !entry.owner_principal)).toBe(true);
  });

  it('keeps the owner of every version of a workflow', async () => {
    const definition = scoutDefinition();
    const created = await definitions.createDefinition(definition, { ownerPrincipal: 'alice@zes.codes' });
    const updated = await definitions.updateDefinition(created.workflow_id, definition, {
      ownerPrincipal: 'alice@zes.codes',
    });

    expect(updated.owner_principal).toBe('alice@zes.codes');
  });
});
