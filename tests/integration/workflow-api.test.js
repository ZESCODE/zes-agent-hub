import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const ADMIN_KEY = 'workflow-api-key';
process.env.AGORA_HUB_ADMIN_KEY = ADMIN_KEY;
process.env.AGORA_HUB_PORT = '0';

let server;
let baseUrl;

beforeAll(async () => {
  const module = await import('../../server/index.js');
  server = module.httpServer;

  await new Promise((resolve) => {
    if (server.listening) {
      resolve();
      return;
    }

    server.once('listening', resolve);
  });

  const address = server.address();
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

function authHeaders(extra = {}) {
  return { Authorization: `Bearer ${ADMIN_KEY}`, 'Content-Type': 'application/json', ...extra };
}

function definition(workflowId) {
  return {
    workflowId,
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

describe('workflow API', () => {
  it('requires the admin key', async () => {
    const response = await fetch(`${baseUrl}/api/v1/workflows`);
    expect(response.status).toBe(401);
  });

  it('exposes the node type registry', async () => {
    const response = await fetch(`${baseUrl}/api/v1/node-types`, { headers: authHeaders() });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.contractVersion).toBe('zes.workflow/v1');
    expect(body.nodeTypes.length).toBeGreaterThanOrEqual(13);
    expect(body.nodeTypes.find((entry) => entry.type === 'verifier').agentId).toBe('verifier');
  });

  it('creates, versions and publishes a definition', async () => {
    const workflowId = `api-scout-${Date.now()}`;

    const created = await fetch(`${baseUrl}/api/v1/workflows`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(definition(workflowId)),
    });
    const createdBody = await created.json();

    expect(created.status).toBe(201);
    expect(createdBody.workflow.status).toBe('draft');

    const published = await fetch(`${baseUrl}/api/v1/workflows/${workflowId}/publish`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ version: createdBody.workflow.version }),
    });
    const publishedBody = await published.json();

    expect(published.status).toBe(200);
    expect(publishedBody.workflow.status).toBe('published');

    const versions = await fetch(`${baseUrl}/api/v1/workflows/${workflowId}/versions`, { headers: authHeaders() });
    const versionsBody = await versions.json();

    expect(versionsBody.versions).toHaveLength(1);
  });

  it('rejects a definition with a browser supplied model', async () => {
    const broken = definition(`api-broken-${Date.now()}`);
    broken.nodes[1].config.model = 'openai/gpt-6-astra';

    const response = await fetch(`${baseUrl}/api/v1/workflows`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(broken),
    });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toMatch(/Model identifiers are resolved by the hub/);
  });

  it('rejects a definition with a cycle', async () => {
    const broken = definition(`api-cycle-${Date.now()}`);
    broken.edges.push({ id: 'e3', source: 'n_out', target: 'n_castor' });

    const response = await fetch(`${baseUrl}/api/v1/workflows`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(broken),
    });

    expect(response.status).toBe(400);
  });

  it('creates a job from a published definition and exposes its graph', async () => {
    const workflowId = `api-job-${Date.now()}`;

    const created = await fetch(`${baseUrl}/api/v1/workflows`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(definition(workflowId)),
    });
    const createdBody = await created.json();

    await fetch(`${baseUrl}/api/v1/workflows/${workflowId}/publish`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ version: createdBody.workflow.version }),
    });

    const job = await fetch(`${baseUrl}/api/v1/jobs`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        title: 'Scout from the API',
        objective: 'Evaluate a repository',
        workflowId,
        workflowVersion: createdBody.workflow.version,
      }),
    });
    const jobBody = await job.json();

    expect(job.status).toBe(201);
    expect(jobBody.workflow.workflowId).toBe(workflowId);

    const graph = await fetch(`${baseUrl}/api/v1/jobs/${jobBody.jobId}/graph`, { headers: authHeaders() });
    const graphBody = await graph.json();

    expect(graph.status).toBe(200);
    expect(graphBody.workflow.definition.nodes).toHaveLength(3);
    expect(graphBody.tasks).toEqual([]);
  });

  it('plans a job from its definition', async () => {
    const workflowId = `api-plan-${Date.now()}`;

    const created = await fetch(`${baseUrl}/api/v1/workflows`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(definition(workflowId)),
    });
    const createdBody = await created.json();

    await fetch(`${baseUrl}/api/v1/workflows/${workflowId}/publish`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ version: createdBody.workflow.version }),
    });

    const job = await fetch(`${baseUrl}/api/v1/jobs`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ title: 'Plan me', objective: 'Evaluate a repository', workflowId }),
    });
    const jobBody = await job.json();

    const plan = await fetch(`${baseUrl}/api/v1/jobs/${jobBody.jobId}/plan`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({}),
    });
    const planBody = await plan.json();

    expect(plan.status).toBe(201);
    expect(planBody.tasks.map((task) => task.nodeId)).toEqual(['n_castor', 'n_john', 'n_out']);

    const graph = await fetch(`${baseUrl}/api/v1/jobs/${jobBody.jobId}/graph`, { headers: authHeaders() });
    const graphBody = await graph.json();

    expect(graphBody.tasks).toHaveLength(3);
    expect(graphBody.tasks[1].dependsOn).toHaveLength(1);
  });

  it('deletes a workflow and detaches the jobs that used it', async () => {
    const create = await fetch(`${baseUrl}/api/v1/workflows`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(definition('smoke-delete')),
    });
    expect(create.status).toBe(201);

    const publish = await fetch(`${baseUrl}/api/v1/workflows/smoke-delete/publish`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({}),
    });
    expect(publish.status).toBe(200);

    const job = await fetch(`${baseUrl}/api/v1/jobs`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        title: 'Delete me',
        objective: 'Run the workflow that will be deleted',
        workflowId: 'smoke-delete',
      }),
    });
    const jobBody = await job.json();
    expect(job.status).toBe(201);

    await fetch(`${baseUrl}/api/v1/jobs/${jobBody.jobId}/cancel`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({}),
    });

    const removed = await fetch(`${baseUrl}/api/v1/workflows/smoke-delete`, {
      method: 'DELETE',
      headers: authHeaders(),
    });
    const removedBody = await removed.json();

    expect(removed.status).toBe(200);
    expect(removedBody.deletedVersions).toContain(1);
    expect(removedBody.detachedRuns).toBe(1);

    const lookup = await fetch(`${baseUrl}/api/v1/workflows/smoke-delete`, { headers: authHeaders() });
    expect(lookup.status).toBe(404);

    const list = await fetch(`${baseUrl}/api/v1/workflows`, { headers: authHeaders() });
    const listBody = await list.json();
    expect(listBody.workflows.some((row) => row.workflowId === 'smoke-delete')).toBe(false);
  });

  it('refuses to delete a workflow that an active job still uses', async () => {
    const create = await fetch(`${baseUrl}/api/v1/workflows`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(definition('smoke-in-use')),
    });
    expect(create.status).toBe(201);

    const publish = await fetch(`${baseUrl}/api/v1/workflows/smoke-in-use/publish`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({}),
    });
    expect(publish.status).toBe(200);

    const job = await fetch(`${baseUrl}/api/v1/jobs`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        title: 'Still running',
        objective: 'Keep this workflow alive',
        workflowId: 'smoke-in-use',
      }),
    });
    const jobBody = await job.json();

    const removed = await fetch(`${baseUrl}/api/v1/workflows/smoke-in-use`, {
      method: 'DELETE',
      headers: authHeaders(),
    });
    const removedBody = await removed.json();

    expect(removed.status).toBe(409);
    expect(removedBody.error).toContain('still used by');

    const cancel = await fetch(`${baseUrl}/api/v1/jobs/${jobBody.jobId}/cancel`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({}),
    });
    expect(cancel.status).toBe(200);
  });

  it('pauses a job', async () => {
    const job = await fetch(`${baseUrl}/api/v1/jobs`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ title: 'Pause me', objective: 'Pause a job' }),
    });
    const jobBody = await job.json();

    await fetch(`${baseUrl}/api/v1/jobs/${jobBody.jobId}/plan`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({}),
    });

    const paused = await fetch(`${baseUrl}/api/v1/jobs/${jobBody.jobId}/pause`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ reason: 'operator asked' }),
    });
    const pausedBody = await paused.json();

    expect(paused.status).toBe(200);
    expect(pausedBody.status).toBe('paused');
  });
});
