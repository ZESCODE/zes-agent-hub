// zes-agent-hub — workflow engine (ZAP v1 §5.4)
// Owns authoritative state transitions, task creation, audit events and resumption.

import crypto from 'crypto';
import { assertTransition, InvalidTransitionError } from './transitions.js';

export function createEngine({ db, repos, logger = () => {} }) {
  async function recordEvent(jobId, eventType, payload, { taskId = null, agentId = null } = {}) {
    const event = await repos.events.append({ jobId, taskId, agentId, eventType, payload });
    logger(`[event] ${eventType}`, event.id);
    return event;
  }

  async function recordAudit(jobId, action, { actorType = 'system', actorId = 'engine', ownerId = null, resourceType = 'job', resourceId = jobId, details = {} } = {}) {
    return repos.audit.append({ jobId, ownerId, actorType, actorId, action, resourceType, resourceId, details });
  }

  async function createJob(input) {
    const owner = await repos.users.ensure({ email: input.ownerEmail || 'owner@zes.codes', displayName: input.ownerDisplayName });
    const job = await repos.jobs.create({
      ownerId: owner.id,
      projectId: input.projectId || null,
      title: input.title,
      objective: input.objective,
      workflowType: input.workflowType || 'scout_fork_build_sell',
      metadata: input.metadata || {},
      approvalRequired: Boolean(input.approvalRequired),
    });

    await recordEvent(job.id, 'job.created', { title: job.title, workflowType: job.workflow_type }, { actorType: 'user', actorId: owner.id });
    await recordAudit(job.id, 'job.created', { actorType: 'user', actorId: owner.id, ownerId: owner.id });

    return job;
  }

  async function createTask(jobId, input) {
    const job = await repos.jobs.findById(jobId);

    if (!job) {
      throw new Error(`Job not found: ${jobId}`);
    }

    const task = await repos.tasks.create({
      jobId,
      parentTaskId: input.parentTaskId || null,
      assignedAgent: input.assignedAgent,
      taskType: input.taskType,
      objective: input.objective,
      input: input.input || {},
      expectedOutputs: input.expectedOutputs || [],
      acceptanceCriteria: input.acceptanceCriteria || [],
      priority: input.priority ?? 5,
      maxAttempts: input.maxAttempts ?? 3,
    });

    await recordEvent(jobId, 'task.created', { taskType: task.task_type, assignedAgent: task.assigned_agent }, { taskId: task.id, agentId: task.assigned_agent });
    return task;
  }

  async function transitionJob(jobId, nextState, { requestedBy = 'engine', reason = '', evidenceIds = [], actorType = 'system', actorId = 'engine' } = {}) {
    const job = await repos.jobs.findById(jobId);

    if (!job) {
      throw new Error(`Job not found: ${jobId}`);
    }

    assertTransition('job', job.status, nextState);

    const updated = await db.transaction(async (tx) => {
      const result = await tx.query('UPDATE jobs SET status = $2, updated_at = NOW() WHERE id = $1 AND status = $3 RETURNING *', [jobId, nextState, job.status]);

      if (result.rows.length === 0) {
        throw new InvalidTransitionError('job', job.status, nextState);
      }

      return result.rows[0];
    });

    await recordEvent(jobId, `job.${nextState}`, { previousState: job.status, nextState, reason, evidenceIds }, { actorType, actorId });
    await recordAudit(jobId, 'job.transition', { actorType, actorId, ownerId: job.owner_id, details: { from: job.status, to: nextState, reason } });

    return updated;
  }

  async function transitionTask(taskId, nextState, { requestedBy = 'engine', reason = '', result, actorType = 'system', actorId = 'engine' } = {}) {
    const task = await repos.tasks.findById(taskId);

    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    assertTransition('task', task.status, nextState);

    const updated = await repos.tasks.updateStatus(taskId, nextState, { result });
    await recordEvent(task.job_id, `task.${nextState}`, { previousState: task.status, nextState, reason }, { taskId, agentId: task.assigned_agent });
    await recordAudit(task.job_id, 'task.transition', { actorType, actorId, resourceType: 'task', resourceId: taskId, details: { from: task.status, to: nextState, reason } });

    return updated;
  }

  async function requestApproval(jobId, { taskId = null, requestedBy, actionType, actionDescription, requestedPayload = {}, expiresAt = null }) {
    const approval = await repos.approvals.create({
      jobId,
      taskId,
      requestedBy,
      actionType,
      actionDescription,
      requestedPayload,
      expiresAt,
    });

    await recordEvent(jobId, 'approval.requested', { actionType, actionDescription }, { taskId });
    return approval;
  }

  async function decideApproval(approvalId, { status, decidedBy, decisionReason = null }) {
    // decided_by references users(id); accept an email and resolve it first.
    let decidedById = decidedBy;

    if (decidedBy && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(decidedBy)) {
      const user = await repos.users.ensure({ email: decidedBy });
      decidedById = user.id;
    }

    const approval = await repos.approvals.decide(approvalId, { status, decidedBy: decidedById, decisionReason });

    if (!approval) {
      throw new Error('Approval not found or already decided');
    }

    await recordEvent(approval.job_id, `approval.${status}`, { approvalId, decisionReason }, { taskId: approval.task_id });
    await recordAudit(approval.job_id, `approval.${status}`, { actorType: 'user', actorId: decidedById, resourceType: 'approval', resourceId: approvalId, details: { decisionReason } });

    return approval;
  }

  /**
   * Resume a job: report incomplete tasks and expired leases.
   */
  async function resumeJob(jobId) {
    const job = await repos.jobs.findById(jobId);

    if (!job) {
      throw new Error(`Job not found: ${jobId}`);
    }

    const tasks = await repos.tasks.listByJob(jobId);
    const incomplete = tasks.filter((task) => !['completed', 'cancelled'].includes(task.status));
    const expiredLeases = incomplete.filter((task) => task.locked_until && new Date(task.locked_until) < new Date());

    for (const task of expiredLeases) {
      await repos.tasks.updateStatus(task.id, 'pending', { lockedBy: null, lockedUntil: null });
    }

    await recordEvent(jobId, 'job.resumed', { incompleteTasks: incomplete.length, reclaimed: expiredLeases.length });

    return { job, incomplete, expiredLeases };
  }

  async function recordArtifact(jobId, input) {
    const artifact = await repos.artifacts.create({ jobId, ...input });
    await recordEvent(jobId, 'artifact.created', { artifactType: artifact.artifact_type, name: artifact.name }, { taskId: artifact.task_id });
    return artifact;
  }

  async function recordToolExecution(jobId, { taskId = null, toolName, idempotencyKey, requestedBy, input = {} }) {
    const outcome = await repos.toolExecutions.create({ jobId, taskId, toolName, idempotencyKey, requestedBy, input });

    if (!outcome.created) {
      return { ...outcome, replayed: true };
    }

    await recordEvent(jobId, 'tool.started', { toolName, idempotencyKey }, { taskId });
    return { ...outcome, replayed: false };
  }

  return {
    createJob,
    createTask,
    transitionJob,
    transitionTask,
    requestApproval,
    decideApproval,
    resumeJob,
    recordArtifact,
    recordToolExecution,
    recordEvent,
    recordAudit,
    newCorrelationId: () => crypto.randomUUID(),
  };
}
