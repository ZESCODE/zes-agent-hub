import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { createDatabase, migrate } from '../../server/lib/db/pool.js';
import { createRepositories } from '../../server/lib/repositories/index.js';
import { createEngine } from '../../server/lib/workflows/engine.js';

let db;
let repos;
let engine;

beforeAll(async () => {
  db = await createDatabase({});
  await migrate(db);
  repos = createRepositories(db);
  engine = createEngine({ db, repos });
});

afterAll(async () => {
  await db.close();
});

async function newJob(overrides = {}) {
  return engine.createJob({
    title: 'Find a repository',
    objective: 'Find a public repo for an AI agent project',
    ownerEmail: 'tester@zes.codes',
    ...overrides,
  });
}

describe('persistent foundation', () => {
  it('creates and persists a job', async () => {
    const job = await newJob();
    expect(job.status).toBe('requested');

    const found = await repos.jobs.findById(job.id);
    expect(found.id).toBe(job.id);
    expect(found.objective).toContain('public repo');
  });

  it('survives a new repository instance (state is in the database, not memory)', async () => {
    const job = await newJob();
    const otherRepos = createRepositories(db);
    const found = await otherRepos.jobs.findById(job.id);
    expect(found).toBeTruthy();
    expect(found.title).toBe(job.title);
  });

  it('records an event and an audit entry for job creation', async () => {
    const job = await newJob();
    const events = await repos.events.listByJob(job.id);
    const audit = await repos.audit.listByJob(job.id);

    expect(events.some((event) => event.event_type === 'job.created')).toBe(true);
    expect(audit.some((entry) => entry.action === 'job.created')).toBe(true);
  });

  it('creates tasks with acceptance criteria', async () => {
    const job = await newJob();
    const task = await engine.createTask(job.id, {
      assignedAgent: 'john',
      taskType: 'scout',
      objective: 'Research candidate repositories',
      expectedOutputs: ['candidate list'],
      acceptanceCriteria: ['Repository exists', 'License reviewed'],
    });

    const stored = await repos.tasks.findById(task.id);
    expect(stored.assigned_agent).toBe('john');
    expect(stored.acceptance_criteria).toContain('License reviewed');
  });

  it('validates job transitions and rejects invalid ones', async () => {
    const job = await newJob();

    const updated = await engine.transitionJob(job.id, 'planning', { reason: 'planning started' });
    expect(updated.status).toBe('planning');

    await expect(engine.transitionJob(job.id, 'deploying')).rejects.toThrow(/Invalid job transition/);
  });

  it('rejects a stale transition (concurrent writer already moved the job)', async () => {
    const job = await newJob();
    await engine.transitionJob(job.id, 'planning');

    const stale = async () => {
      const current = await repos.jobs.findById(job.id);
      await repos.jobs.updateStatus(job.id, 'scouting');
      expect(current.status).toBe('planning');
    };

    await stale();
    await expect(engine.transitionJob(job.id, 'verified')).rejects.toThrow(/Invalid job transition/);
  });

  it('records a task result and completes the task', async () => {
    const job = await newJob();
    const task = await engine.createTask(job.id, {
      assignedAgent: 'john',
      taskType: 'scout',
      objective: 'Research candidates',
    });

    await engine.transitionTask(task.id, 'running');
    const done = await engine.transitionTask(task.id, 'completed', { result: { candidates: 3 } });

    expect(done.status).toBe('completed');
    expect(done.result).toEqual({ candidates: 3 });
  });

  it('stores artifacts linked to a job', async () => {
    const job = await newJob();
    await engine.recordArtifact(job.id, {
      artifactType: 'report',
      name: 'scout.md',
      storageUri: 'file:///tmp/scout.md',
      contentType: 'text/markdown',
    });

    const artifacts = await repos.artifacts.listByJob(job.id);
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].name).toBe('scout.md');
  });

  it('handles approvals once only', async () => {
    const job = await newJob();
    const approval = await engine.requestApproval(job.id, {
      requestedBy: 'engine',
      actionType: 'deployment.production',
      actionDescription: 'Deploy to production',
    });

    const decided = await engine.decideApproval(approval.id, { status: 'approved', decidedBy: 'admin' });
    expect(decided.status).toBe('approved');

    await expect(engine.decideApproval(approval.id, { status: 'rejected', decidedBy: 'admin' })).rejects.toThrow(
      /already decided/,
    );
  });

  it('replays an idempotent tool execution instead of duplicating it', async () => {
    const job = await newJob();
    const first = await engine.recordToolExecution(job.id, {
      toolName: 'github.repository.fork',
      idempotencyKey: `${job.id}:github-fork:repo-a`,
      requestedBy: 'engine',
    });

    const second = await engine.recordToolExecution(job.id, {
      toolName: 'github.repository.fork',
      idempotencyKey: `${job.id}:github-fork:repo-a`,
      requestedBy: 'engine',
    });

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.replayed).toBe(true);
    expect(second.execution.id).toBe(first.execution.id);
  });

  it('resumes a job and reports incomplete tasks', async () => {
    const job = await newJob();
    const task = await engine.createTask(job.id, {
      assignedAgent: 'laurent',
      taskType: 'build',
      objective: 'Implement the feature',
    });

    await engine.transitionTask(task.id, 'running');
    await repos.tasks.updateStatus(task.id, 'running', { lockedBy: 'worker-1', lockedUntil: '2000-01-01T00:00:00.000Z' });

    const result = await engine.resumeJob(job.id);
    expect(result.incomplete.length).toBeGreaterThan(0);
    expect(result.expiredLeases.length).toBe(1);

    const reclaimed = await repos.tasks.findById(task.id);
    expect(reclaimed.status).toBe('pending');
    expect(reclaimed.locked_by).toBeNull();
  });

  it('lists jobs for an owner with pagination', async () => {
    const owner = await repos.users.ensure({ email: 'paged@zes.codes' });
    await repos.jobs.create({
      ownerId: owner.id,
      title: 'Job 1',
      objective: 'One',
      workflowType: 'scout',
    });
    await repos.jobs.create({
      ownerId: owner.id,
      title: 'Job 2',
      objective: 'Two',
      workflowType: 'scout',
    });

    const page = await repos.jobs.listByOwner(owner.id, { limit: 1, offset: 0 });
    expect(page).toHaveLength(1);

    const second = await repos.jobs.listByOwner(owner.id, { limit: 1, offset: 1 });
    expect(second).toHaveLength(1);
    expect(second[0].id).not.toBe(page[0].id);
  });
});
