import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createDatabase, migrate } from '../../server/lib/db/pool.js';
import { createRepositories } from '../../server/lib/repositories/index.js';
import { createEngine } from '../../server/lib/workflows/engine.js';
import { buildAgentRegistry } from '../../server/lib/agents/registry.js';
import { createPlanner } from '../../server/lib/orchestrator/planner.js';
import { createScheduler } from '../../server/lib/orchestrator/scheduler.js';

const seatsConfig = JSON.parse(readFileSync(fileURLToPath(new URL('../../seats/config.json', import.meta.url)), 'utf8'));

let db;
let repos;
let engine;
let registry;
let planner;
let scheduler;
let observedRoute = null;

beforeAll(async () => {
  db = await createDatabase({});
  await migrate(db);
  repos = createRepositories(db);
  engine = createEngine({ db, repos });

  const config = structuredClone(seatsConfig);
  const john = config.seats.find((seat) => seat.id === 'john');
  john.provider = 'apinexgate';
  john.model = 'claude-fable-5.1';
  john.fallbackProvider = 'pollinations';
  john.fallbackModel = 'openai/gpt-5.4-nano';

  registry = buildAgentRegistry(config);
  planner = createPlanner({ engine, registry });
  scheduler = createScheduler({
    engine,
    registry,
    repos,
    modelRunner: async ({ agent, task, route }) => {
      observedRoute = route;

      return {
        result: {
          status: 'completed',
          summary: `${agent.id} handled ${task.task_type}`,
          outputs: ['stub output'],
          issues: [],
          evidence: [],
          requiresApproval: false,
          model: route.model,
          provider: route.provider,
        },
        inputTokens: 10,
        outputTokens: 20,
        estimatedCost: 0.001,
        provider: route.provider,
        model: route.model,
      };
    },
  });
});

afterAll(async () => {
  await db.close();
});

describe('seat level provider routing', () => {
  it('keeps a seat that did not opt in on the ZESCODE gateway', async () => {
    const siti = registry.find('siti');

    expect(siti.provider).toBe('newapi');
    expect(siti.model).toBe(seatsConfig.seats.find((seat) => seat.id === 'siti').model);
  });

  it('carries the seat provider and model into the agent definition', () => {
    const john = registry.find('john');

    expect(john.provider).toBe('apinexgate');
    expect(john.model).toBe('claude-fable-5.1');
    expect(john.fallbackProvider).toBe('pollinations');
    expect(john.fallbackModel).toBe('openai/gpt-5.4-nano');
  });

  it('routes a job through the provider override stored on the job', async () => {
    const job = await engine.createJob({
      title: 'Provider override job',
      objective: 'Find a repository and prepare it for ZESCODE',
      ownerEmail: 'phase2@zes.codes',
      metadata: { provider: 'apinexgate', model: 'claude-fable-5.1' },
    });

    await planner.planJob(job.id);
    const outcome = await scheduler.runNextTask(job.id, { workerId: 'test-worker' });

    expect(outcome.ran).toBe(true);
    expect(observedRoute.provider).toBe('apinexgate');
    expect(observedRoute.model).toBe('claude-fable-5.1');
  });

  it('runs the scout task through the seat provider and books it in model_usage', async () => {
    const job = await engine.createJob({
      title: 'Provider routing job',
      objective: 'Find a repository and prepare it for ZESCODE',
      ownerEmail: 'phase2@zes.codes',
    });

    await planner.planJob(job.id);
    const outcome = await scheduler.runNextTask(job.id, { workerId: 'test-worker' });

    expect(outcome.ran).toBe(true);
    expect(observedRoute.provider).toBe('apinexgate');
    expect(observedRoute.model).toBe('claude-fable-5.1');
    expect(observedRoute.fallbackProvider).toBe('pollinations');

    const usage = await repos.modelUsage.listByJob(job.id);
    expect(usage.length).toBe(1);
    expect(usage[0].provider).toBe('apinexgate');
    expect(usage[0].model).toBe('claude-fable-5.1');
    expect(usage[0].success).toBe(true);
  });
});
