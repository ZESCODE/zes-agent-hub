import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { createDatabase, migrate } from '../../server/lib/db/pool.js';
import { createRepositories } from '../../server/lib/repositories/index.js';
import { createEngine } from '../../server/lib/workflows/engine.js';
import { buildAgentRegistry } from '../../server/lib/agents/registry.js';
import { createPlanner } from '../../server/lib/orchestrator/planner.js';
import { createScheduler } from '../../server/lib/orchestrator/scheduler.js';
import { routeFor, knownTaskTypes } from '../../server/lib/providers/router.js';
import seatsConfig from '../../seats/config.json' with { type: 'json' };

let db;
let repos;
let engine;
let registry;
let planner;
let scheduler;

beforeAll(async () => {
  db = await createDatabase({});
  await migrate(db);
  repos = createRepositories(db);
  engine = createEngine({ db, repos });
  registry = buildAgentRegistry(seatsConfig);
  planner = createPlanner({ engine, registry });
  scheduler = createScheduler({
    engine,
    registry,
    repos,
    modelRunner: async ({ agent, task, route }) => ({
      result: {
        status: 'completed',
        summary: `${agent.id} handled ${task.task_type}`,
        outputs: ['stub output'],
        issues: [],
        evidence: [],
        requiresApproval: false,
        model: route.model,
      },
      inputTokens: 10,
      outputTokens: 20,
    }),
  });
});

afterAll(async () => {
  await db.close();
});

async function newJob() {
  return engine.createJob({
    title: 'Scout job',
    objective: 'Find a repository and prepare it for ZESCODE',
    ownerEmail: 'milestone2@zes.codes',
  });
}

describe('milestone 2 — castor orchestration', () => {
  it('registers typed agent definitions', () => {
    const agents = registry.list();

    expect(agents.length).toBeGreaterThanOrEqual(6);
    expect(agents.find((agent) => agent.id === 'castor')).toBeTruthy();
    expect(agents.find((agent) => agent.id === 'verifier')).toBeTruthy();

    for (const agent of agents) {
      expect(agent.enabled).toBe(true);
      expect(Array.isArray(agent.tools)).toBe(true);
      expect(Array.isArray(agent.permissions)).toBe(true);
      expect(agent.maxConcurrentTasks).toBeGreaterThan(0);
      expect(agent.systemPromptVersion).toMatch(/^zap-v1/);
    }
  });

  it('routes models per task type', () => {
    expect(routeFor({ taskType: 'scout' }).model).toBe('openai/gpt-6-astra');
    expect(routeFor({ taskType: 'deploy' }).model).toBe('deepseek/deepseek-v4.1-flash');
    expect(routeFor({ taskType: 'unknown-type' }).model).toBe('openai/gpt-5.4-nano');
    expect(routeFor({ taskType: 'verify' }).complexity).toBe('high');
    expect(knownTaskTypes()).toContain('build');
  });

  it('creates a plan with complete task contracts', async () => {
    const job = await newJob();
    const plan = await planner.planJob(job.id);

    expect(plan.tasks.length).toBeGreaterThanOrEqual(5);

    const scout = plan.tasks.find((task) => task.task_type === 'scout');
    expect(scout.assigned_agent).toBe('john');
    expect(scout.acceptance_criteria.length).toBeGreaterThan(0);
    expect(scout.expected_outputs.length).toBeGreaterThan(0);
    expect(scout.objective).toContain('Find a repository');

    const verify = plan.tasks.find((task) => task.task_type === 'verify');
    expect(verify.assigned_agent).toBe('verifier');
  });

  it('moves the job into scouting after planning', async () => {
    const job = await newJob();
    await planner.planJob(job.id);

    const stored = await repos.jobs.findById(job.id);
    expect(stored.status).toBe('scouting');
  });

  it('does not duplicate a plan when called twice', async () => {
    const job = await newJob();
    await planner.planJob(job.id);
    const second = await planner.planJob(job.id);

    expect(second.reused).toBe(true);
    expect((await repos.tasks.listByJob(job.id)).length).toBe(5);
  });

  it('runs a task, stores the result and records model usage', async () => {
    const job = await newJob();
    await planner.planJob(job.id);

    const outcome = await scheduler.runNextTask(job.id, { workerId: 'test-worker' });
    expect(outcome.ran).toBe(true);
    expect(outcome.agentId).toBe('john');

    const task = await repos.tasks.findById(outcome.taskId);
    expect(task.status).toBe('completed');
    expect(task.result.summary).toContain('john handled scout');

    const usage = await repos.modelUsage.listByJob(job.id);
    expect(usage.length).toBe(1);
    expect(usage[0].model).toBe('openai/gpt-6-astra');
    expect(usage[0].success).toBe(true);
  });

  it('records a failed task and allows a retry', async () => {
    const job = await newJob();
    await planner.planJob(job.id);

    const failingScheduler = createScheduler({
      engine,
      registry,
      repos,
      modelRunner: async () => {
        throw new Error('model unavailable');
      },
    });

    const outcome = await failingScheduler.runNextTask(job.id);
    expect(outcome.failed).toBe(true);

    const task = await repos.tasks.findById(outcome.taskId);
    expect(task.status).toBe('failed');
    expect(task.attempt).toBe(1);

    const usage = await repos.modelUsage.listByJob(job.id);
    expect(usage[0].success).toBe(false);
  });

  it('leaves a task alone when another worker holds the lease', async () => {
    const job = await newJob();
    await planner.planJob(job.id);

    const tasks = await repos.tasks.listByJob(job.id);
    const scout = tasks.find((task) => task.task_type === 'scout');

    await repos.tasks.claimLease(scout.id, 'other-worker', 120_000);

    const outcome = await scheduler.runNextTask(job.id, { taskType: 'scout' });
    expect(outcome.ran).toBe(false);
    expect(outcome.reason).toMatch(/lease/);
  });

  it('walks the job through the workflow chain to completed', async () => {
    const job = await newJob();
    await planner.planJob(job.id);

    const seen = [];

    for (let i = 0; i < 5; i += 1) {
      const outcome = await scheduler.runNextTask(job.id);

      expect(outcome.ran).toBe(true);
      const stored = await repos.jobs.findById(job.id);
      seen.push(stored.status);
    }

    expect(seen).toEqual(['scouted', 'rebranding', 'building', 'deploying', 'completed']);

    const final = await repos.jobs.findById(job.id);
    expect(final.status).toBe('completed');

    const usage = await repos.modelUsage.listByJob(job.id);
    expect(usage.length).toBe(5);
    expect(usage.every((row) => row.success)).toBe(true);
  });
});
