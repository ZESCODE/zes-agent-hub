import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const ADMIN_KEY = 'test-admin-key';
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

describe('ZAP v1 HTTP API', () => {
  it('rejects unauthenticated API access', async () => {
    const response = await fetch(`${baseUrl}/api/v1/jobs`);
    expect(response.status).toBe(401);
  });

  it('rejects a wrong admin key', async () => {
    const response = await fetch(`${baseUrl}/api/v1/jobs`, { headers: { Authorization: 'Bearer nope' } });
    expect(response.status).toBe(401);
  });

  it('exposes health without secrets', async () => {
    const response = await fetch(`${baseUrl}/health`);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(JSON.stringify(body)).not.toContain('sk_');
  });

  it('reports readiness with the database check', async () => {
    const response = await fetch(`${baseUrl}/ready`);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.checks.database).toBe('ok');
    expect(body.migrations).toContain('001_zap_v1.sql');
  });

  it('protects metrics', async () => {
    expect((await fetch(`${baseUrl}/metrics`)).status).toBe(401);
    const response = await fetch(`${baseUrl}/metrics`, { headers: authHeaders() });
    expect(response.status).toBe(200);
  });

  it('creates a job and returns it', async () => {
    const response = await fetch(`${baseUrl}/api/v1/jobs`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        title: 'Scout an agent repo',
        objective: 'Find a suitable repository and prepare a recommendation',
        workflowType: 'scout_fork_build_sell',
      }),
    });

    const body = await response.json();
    expect(response.status).toBe(201);
    expect(body.status).toBe('requested');
    expect(body.jobId).toBeTruthy();
  });

  it('rejects an invalid job payload', async () => {
    const response = await fetch(`${baseUrl}/api/v1/jobs`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ title: '' }),
    });

    expect(response.status).toBe(400);
  });

  it('validates job transitions over HTTP', async () => {
    const created = await fetch(`${baseUrl}/api/v1/jobs`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ title: 'Transition test', objective: 'Check transitions' }),
    });
    const { jobId } = await created.json();

    const ok = await fetch(`${baseUrl}/api/v1/jobs/${jobId}/transitions`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ nextState: 'planning' }),
    });
    expect(ok.status).toBe(200);

    const invalid = await fetch(`${baseUrl}/api/v1/jobs/${jobId}/transitions`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ nextState: 'deploying' }),
    });
    expect(invalid.status).toBe(409);
  });

  it('lists jobs for an owner with pagination fields', async () => {
    const response = await fetch(`${baseUrl}/api/v1/jobs?limit=5&offset=0`, { headers: authHeaders() });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(Array.isArray(body.jobs)).toBe(true);
    expect(body.limit).toBe(5);
  });

  it('exposes the tool registry', async () => {
    const response = await fetch(`${baseUrl}/api/v1/tools`, { headers: authHeaders() });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.tools.some((tool) => tool.name === 'qc.check')).toBe(true);
  });
});
