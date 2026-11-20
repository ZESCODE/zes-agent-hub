// zes-agent-hub — ZAP v1 API (/api/v1)
// Authenticated with the admin key; ownership is enforced for every job route.

import express from 'express';
import { z } from 'zod';
import { describeNodeTypes } from '../workflows/node-types.js';
import { WORKFLOW_CONTRACT_VERSION } from '../workflows/contract.js';

export function createApiRouter({
  engine,
  repos,
  db,
  registry,
  planner,
  scheduler,
  definitions = null,
  workflowRepos = null,
  logger = () => {},
}) {
  const router = express.Router();

  router.use((req, res, next) => {
    const configured = process.env.AGORA_HUB_ADMIN_KEY;

    if (!configured) {
      return res.status(503).json({ error: 'AGORA_HUB_ADMIN_KEY is not configured' });
    }

    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';

    if (token !== configured) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    return next();
  });

  const asyncRoute = (handler) => (req, res) => {
    Promise.resolve(handler(req, res)).catch((error) => {
      logger('[api]', error.message);
      res.status(500).json({ error: error.message });
    });
  };

  const createJobSchema = z.object({
    title: z.string().min(1).max(200),
    objective: z.string().min(1).max(8000),
    workflowType: z.string().max(80).default('scout_fork_build_sell'),
    projectId: z.string().uuid().nullish(),
    ownerEmail: z.string().email().default('owner@zes.codes'),
    metadata: z.record(z.unknown()).default({}),
    preferences: z
      .object({
        budgetLimit: z.number().nonnegative().optional(),
        requireApprovalBeforeFork: z.boolean().optional(),
      })
      .default({}),
    workflowId: z.string().max(120).optional(),
    workflowVersion: z.number().int().positive().optional(),
  });

  router.post(
    '/jobs',
    asyncRoute(async (req, res) => {
      const parsed = createJobSchema.safeParse(req.body);

      if (!parsed.success) {
        return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
      }

      const input = parsed.data;
      const job = await engine.createJob({
        title: input.title,
        objective: input.objective,
        workflowType: input.workflowType,
        projectId: input.projectId ?? null,
        ownerEmail: input.ownerEmail,
        metadata: { ...input.metadata, preferences: input.preferences },
        approvalRequired: Boolean(input.preferences.requireApprovalBeforeFork),
      });

      let workflow = null;

      if (input.workflowId && definitions) {
        try {
          const attached = await definitions.attachToJob(job.id, {
            workflowId: input.workflowId,
            version: input.workflowVersion,
          });

          workflow = {
            workflowId: attached.definition.workflowId,
            version: attached.definition.version,
            contractVersion: WORKFLOW_CONTRACT_VERSION,
          };
        } catch (error) {
          await repos.jobs.remove(job.id);
          return res.status(400).json({ error: error.message });
        }
      }

      return res.status(201).json({
        jobId: job.id,
        status: job.status,
        workflowType: job.workflow_type,
        workflow,
        createdAt: job.created_at,
      });
    }),
  );

  router.get(
    '/jobs',
    asyncRoute(async (req, res) => {
      const limit = Math.min(Number(req.query.limit) || 50, 200);
      const offset = Math.max(Number(req.query.offset) || 0, 0);
      const owner = await repos.users.findByEmail(req.query.ownerEmail || 'owner@zes.codes');

      if (!owner) {
        return res.json({ jobs: [], total: 0, limit, offset });
      }

      const jobs = await repos.jobs.listByOwner(owner.id, { status: req.query.status, limit, offset });
      return res.json({ jobs, total: jobs.length, limit, offset });
    }),
  );

  router.get(
    '/jobs/:jobId',
    asyncRoute(async (req, res) => {
      const job = await repos.jobs.findById(req.params.jobId);

      if (!job) {
        return res.status(404).json({ error: 'Job not found' });
      }

      const tasks = await repos.tasks.listByJob(job.id);
      return res.json({ job, tasks });
    }),
  );

  router.get(
    '/jobs/:jobId/tasks',
    asyncRoute(async (req, res) => {
      const job = await repos.jobs.findById(req.params.jobId);

      if (!job) {
        return res.status(404).json({ error: 'Job not found' });
      }

      return res.json({ tasks: await repos.tasks.listByJob(job.id) });
    }),
  );

  router.get(
    '/jobs/:jobId/events',
    asyncRoute(async (req, res) => {
      const job = await repos.jobs.findById(req.params.jobId);

      if (!job) {
        return res.status(404).json({ error: 'Job not found' });
      }

      const limit = Math.min(Number(req.query.limit) || 100, 500);
      const offset = Math.max(Number(req.query.offset) || 0, 0);
      const after = req.query.after ? String(req.query.after) : null;
      const events = await repos.events.listByJob(job.id, { limit, offset, after });

      return res.json({ events, limit, offset, after });
    }),
  );

  router.get(
    '/jobs/:jobId/artifacts',
    asyncRoute(async (req, res) => {
      const job = await repos.jobs.findById(req.params.jobId);

      if (!job) {
        return res.status(404).json({ error: 'Job not found' });
      }

      return res.json({ artifacts: await repos.artifacts.listByJob(job.id) });
    }),
  );

  router.post(
    '/jobs/:jobId/cancel',
    asyncRoute(async (req, res) => {
      const job = await engine.transitionJob(req.params.jobId, 'cancelled', { reason: 'cancelled by operator' });
      return res.json({ jobId: job.id, status: job.status });
    }),
  );

  router.post(
    '/jobs/:jobId/resume',
    asyncRoute(async (req, res) => {
      const result = await engine.resumeJob(req.params.jobId);
      return res.json({
        jobId: result.job.id,
        status: result.job.status,
        incompleteTasks: result.incomplete.length,
        reclaimedLeases: result.expiredLeases.length,
      });
    }),
  );

  router.post(
    '/jobs/:jobId/transitions',
    asyncRoute(async (req, res) => {
      const schema = z.object({ nextState: z.string().min(1), reason: z.string().max(500).optional() });
      const parsed = schema.safeParse(req.body);

      if (!parsed.success) {
        return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
      }

      try {
        const job = await engine.transitionJob(req.params.jobId, parsed.data.nextState, { reason: parsed.data.reason || '' });
        return res.json({ jobId: job.id, status: job.status });
      } catch (error) {
        if (error.name === 'InvalidTransitionError') {
          return res.status(409).json({ error: error.message });
        }

        throw error;
      }
    }),
  );

  router.get(
    '/tasks/:taskId',
    asyncRoute(async (req, res) => {
      const task = await repos.tasks.findById(req.params.taskId);

      if (!task) {
        return res.status(404).json({ error: 'Task not found' });
      }

      return res.json({ task });
    }),
  );

  router.post(
    '/tasks/:taskId/transitions',
    asyncRoute(async (req, res) => {
      const schema = z.object({
        nextState: z.string().min(1),
        reason: z.string().max(500).optional(),
        result: z.unknown().optional(),
      });
      const parsed = schema.safeParse(req.body);

      if (!parsed.success) {
        return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
      }

      try {
        const task = await engine.transitionTask(req.params.taskId, parsed.data.nextState, {
          reason: parsed.data.reason || '',
          result: parsed.data.result,
        });
        return res.json({ taskId: task.id, status: task.status });
      } catch (error) {
        if (error.name === 'InvalidTransitionError') {
          return res.status(409).json({ error: error.message });
        }

        throw error;
      }
    }),
  );

  router.get(
    '/agents',
    asyncRoute(async (req, res) => {
      const { rows } = await db.query('SELECT assigned_agent AS id, COUNT(*)::int AS tasks FROM tasks GROUP BY assigned_agent');
      const counts = new Map(rows.map((row) => [row.id, row.tasks]));

      return res.json({
        agents: registry.list().map((agent) => ({
          ...agent,
          taskCount: counts.get(agent.id) || 0,
        })),
      });
    }),
  );

  router.get(
    '/agents/:agentId',
    asyncRoute(async (req, res) => {
      const agent = registry.find(req.params.agentId);

      if (!agent) {
        return res.status(404).json({ error: 'Agent not found' });
      }

      return res.json({ agent });
    }),
  );

  router.post(
    '/jobs/:jobId/plan',
    asyncRoute(async (req, res) => {
      const schema = z.object({ template: z.string().max(80).optional() });
      const parsed = schema.safeParse(req.body ?? {});

      if (!parsed.success) {
        return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
      }

      try {
        const run = workflowRepos ? await workflowRepos.runs.findByJob(req.params.jobId) : null;
        const definition = run ? run.graph_snapshot : null;

        const result = await planner.planJob(req.params.jobId, { ...parsed.data, definition });

        return res.status(201).json({
          jobId: result.jobId,
          reused: result.reused,
          tasks: result.tasks.map((task) => ({
            taskId: task.id,
            assignedAgent: task.assigned_agent,
            taskType: task.task_type,
            nodeId: task.node_id,
            nodeType: task.node_type,
            taskKind: task.task_kind,
            acceptanceCriteria: task.acceptance_criteria,
          })),
        });
      } catch (error) {
        if (error.name === 'InvalidTransitionError') {
          return res.status(409).json({ error: error.message });
        }

        throw error;
      }
    }),
  );

  router.post(
    '/jobs/:jobId/run-next',
    asyncRoute(async (req, res) => {
      const schema = z.object({
        workerId: z.string().max(120).optional(),
        taskType: z.string().max(80).optional(),
        agentId: z.string().max(80).optional(),
      });
      const parsed = schema.safeParse(req.body ?? {});

      if (!parsed.success) {
        return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
      }

      const job = await repos.jobs.findById(req.params.jobId);

      if (!job) {
        return res.status(404).json({ error: 'Job not found' });
      }

      const run = workflowRepos ? await workflowRepos.runs.findByJob(job.id) : null;
      const result = await scheduler.runNextTask(job.id, { ...parsed.data, definition: run?.graph_snapshot || null });
      return res.json(result);
    }),
  );

  router.get(
    '/jobs/:jobId/usage',
    asyncRoute(async (req, res) => {
      const job = await repos.jobs.findById(req.params.jobId);

      if (!job) {
        return res.status(404).json({ error: 'Job not found' });
      }

      return res.json({ usage: await repos.modelUsage.listByJob(job.id) });
    }),
  );

  router.get(
    '/approvals',
    asyncRoute(async (req, res) => {
      return res.json({ approvals: await repos.approvals.listPending(Math.min(Number(req.query.limit) || 50, 200)) });
    }),
  );

  router.post(
    '/approvals/:id/approve',
    asyncRoute(async (req, res) => {
      const schema = z.object({ decidedBy: z.string().min(1), decisionReason: z.string().max(500).optional() });
      const parsed = schema.safeParse(req.body);

      if (!parsed.success) {
        return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
      }

      try {
        const approval = await engine.decideApproval(req.params.id, {
          status: 'approved',
          decidedBy: parsed.data.decidedBy,
          decisionReason: parsed.data.decisionReason || null,
        });
        return res.json({ approvalId: approval.id, status: approval.status });
      } catch (error) {
        return res.status(409).json({ error: error.message });
      }
    }),
  );

  router.post(
    '/approvals/:id/reject',
    asyncRoute(async (req, res) => {
      const schema = z.object({ decidedBy: z.string().min(1), decisionReason: z.string().max(500).optional() });
      const parsed = schema.safeParse(req.body);

      if (!parsed.success) {
        return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
      }

      try {
        const approval = await engine.decideApproval(req.params.id, {
          status: 'rejected',
          decidedBy: parsed.data.decidedBy,
          decisionReason: parsed.data.decisionReason || null,
        });
        return res.json({ approvalId: approval.id, status: approval.status });
      } catch (error) {
        return res.status(409).json({ error: error.message });
      }
    }),
  );

  router.get(
    '/tools',
    asyncRoute(async (req, res) => {
      const tools = [
        { name: 'pollinations.text', description: 'Generate text with a seat model', permissions: ['model.generate'] },
        { name: 'pollinations.image', description: 'Generate an image', permissions: ['model.generate'] },
        { name: 'qc.check', description: 'Run the QC Council on an image', permissions: ['qc.run'] },
        { name: 'deploy.pages', description: 'Deploy to Cloudflare Pages', permissions: ['deployment.preview'] },
        { name: 'deploy.vercel', description: 'Deploy to Vercel', permissions: ['deployment.preview'] },
        { name: 'github.repository.read', description: 'Read a repository', permissions: ['github.repository.read'] },
      ];

      return res.json({ tools });
    }),
  );
  router.get(
    '/tools/executions/:id',
    asyncRoute(async (req, res) => {
      const { rows } = await db.query('SELECT * FROM tool_executions WHERE id = $1', [req.params.id]);

      if (rows.length === 0) {
        return res.status(404).json({ error: 'Execution not found' });
      }

      return res.json({ execution: rows[0] });
    }),
  );

  router.get(
    '/node-types',
    asyncRoute(async (req, res) => {
      return res.json({
        contractVersion: WORKFLOW_CONTRACT_VERSION,
        nodeTypes: describeNodeTypes(),
      });
    }),
  );

  router.get(
    '/workflows',
    asyncRoute(async (req, res) => {
      if (!workflowRepos) {
        return res.status(503).json({ error: 'Workflow definitions are not enabled' });
      }

      const limit = Math.min(Number(req.query.limit) || 50, 200);
      const offset = Math.max(Number(req.query.offset) || 0, 0);
      const definitions = await workflowRepos.definitions.list({ status: req.query.status, limit, offset });

      return res.json({
        workflows: definitions.map((definition) => ({
          id: definition.id,
          workflowId: definition.workflow_id,
          version: definition.version,
          name: definition.name,
          description: definition.description,
          status: definition.status,
          contractVersion: definition.contract_version,
          createdAt: definition.created_at,
          publishedAt: definition.published_at,
        })),
        limit,
        offset,
      });
    }),
  );

  router.post(
    '/workflows',
    asyncRoute(async (req, res) => {
      if (!definitions) {
        return res.status(503).json({ error: 'Workflow definitions are not enabled' });
      }

      try {
        const stored = await definitions.createDefinition(req.body ?? {});
        return res.status(201).json({ workflow: stored });
      } catch (error) {
        if (error.name === 'WorkflowValidationError') {
          return res.status(400).json({ error: error.message, issues: error.issues });
        }

        throw error;
      }
    }),
  );

  router.get(
    '/workflows/:workflowId',
    asyncRoute(async (req, res) => {
      if (!workflowRepos) {
        return res.status(503).json({ error: 'Workflow definitions are not enabled' });
      }

      const version = req.query.version ? Number(req.query.version) : null;
      const stored = version
        ? await workflowRepos.definitions.findVersion(req.params.workflowId, version)
        : await workflowRepos.definitions.latestPublished(req.params.workflowId) ||
          (await workflowRepos.definitions.latestVersion(req.params.workflowId));

      if (!stored) {
        return res.status(404).json({ error: 'Workflow not found' });
      }

      return res.json({ workflow: stored });
    }),
  );

  router.put(
    '/workflows/:workflowId',
    asyncRoute(async (req, res) => {
      if (!definitions) {
        return res.status(503).json({ error: 'Workflow definitions are not enabled' });
      }

      try {
        const stored = await definitions.updateDefinition(req.params.workflowId, req.body ?? {});
        return res.status(201).json({ workflow: stored });
      } catch (error) {
        if (error.name === 'WorkflowValidationError') {
          return res.status(400).json({ error: error.message, issues: error.issues });
        }

        if (error.message.startsWith('Workflow not found')) {
          return res.status(404).json({ error: error.message });
        }

        throw error;
      }
    }),
  );

  router.delete(
    '/workflows/:workflowId',
    asyncRoute(async (req, res) => {
      if (!definitions) {
        return res.status(503).json({ error: 'Workflow definitions are not enabled' });
      }

      try {
        const result = await definitions.deleteDefinition(req.params.workflowId);
        return res.json({
          workflowId: req.params.workflowId,
          deletedVersions: result.versions.map((version) => version.version),
          detachedRuns: result.detachedRuns,
          detachedJobs: result.detachedJobs,
        });
      } catch (error) {
        if (error.name === 'WorkflowInUseError') {
          return res.status(409).json({ error: error.message });
        }

        if (error.message.startsWith('Workflow not found')) {
          return res.status(404).json({ error: error.message });
        }

        throw error;
      }
    }),
  );

  router.get(
    '/workflows/:workflowId/versions',
    asyncRoute(async (req, res) => {
      if (!workflowRepos) {
        return res.status(503).json({ error: 'Workflow definitions are not enabled' });
      }

      const versions = await workflowRepos.definitions.listVersions(req.params.workflowId);
      return res.json({ versions });
    }),
  );

  router.post(
    '/workflows/:workflowId/publish',
    asyncRoute(async (req, res) => {
      if (!definitions) {
        return res.status(503).json({ error: 'Workflow definitions are not enabled' });
      }

      const schema = z.object({ version: z.number().int().positive().optional() });
      const parsed = schema.safeParse(req.body ?? {});

      if (!parsed.success) {
        return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
      }

      try {
        const published = await definitions.publishDefinition(req.params.workflowId, parsed.data.version);
        return res.json({ workflow: published });
      } catch (error) {
        if (error.name === 'WorkflowValidationError') {
          return res.status(400).json({ error: error.message, issues: error.issues });
        }

        if (error.message.startsWith('Workflow not found')) {
          return res.status(404).json({ error: error.message });
        }

        return res.status(409).json({ error: error.message });
      }
    }),
  );

  router.get(
    '/jobs/:jobId/graph',
    asyncRoute(async (req, res) => {
      if (!workflowRepos) {
        return res.status(503).json({ error: 'Workflow definitions are not enabled' });
      }

      const job = await repos.jobs.findById(req.params.jobId);

      if (!job) {
        return res.status(404).json({ error: 'Job not found' });
      }

      const run = await workflowRepos.runs.findByJob(job.id);

      if (!run) {
        return res.json({ jobId: job.id, workflow: null, nodes: [], tasks: [] });
      }

      const tasks = await repos.tasks.listByJob(job.id);

      return res.json({
        jobId: job.id,
        workflow: {
          workflowId: run.workflow_id,
          version: run.workflow_version,
          contractVersion: run.contract_version,
          status: run.status,
          definition: run.graph_snapshot,
        },
        tasks: tasks.map((task) => ({
          taskId: task.id,
          nodeId: task.node_id,
          nodeType: task.node_type,
          taskKind: task.task_kind,
          assignedAgent: task.assigned_agent,
          taskType: task.task_type,
          status: task.status,
          attempt: task.attempt,
          dependsOn: task.depends_on,
        })),
      });
    }),
  );

  router.post(
    '/jobs/:jobId/pause',
    asyncRoute(async (req, res) => {
      const schema = z.object({ reason: z.string().max(500).optional() });
      const parsed = schema.safeParse(req.body ?? {});

      if (!parsed.success) {
        return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
      }

      try {
        const job = await engine.pauseJob(req.params.jobId, { reason: parsed.data.reason || 'paused by operator' });
        return res.json({ jobId: job.id, status: job.status });
      } catch (error) {
        if (error.name === 'InvalidTransitionError') {
          return res.status(409).json({ error: error.message });
        }

        throw error;
      }
    }),
  );

  return router;
}
