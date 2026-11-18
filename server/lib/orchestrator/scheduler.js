// zes-agent-hub — task scheduler (ZAP v1 §5.4, §11.3)
// Claims a task with a lease, executes it through the routed model, stores the
// structured result, records usage and releases the lease.

import { routeFor } from '../providers/router.js';

/*
 * Each task type advances the job through the canonical ZAP v1 workflow chain.
 * The engine validates every hop against the job state machine.
 */
const JOB_PATH_AFTER_TASK = {
  scout: ['scouted'],
  design: ['forking', 'forked', 'rebranding'],
  build: ['reviewing', 'building'],
  deploy: ['deploying'],
  verify: ['verifying', 'verified'],
};

export function createScheduler({
  engine,
  registry,
  repos,
  modelRunner,
  logger = () => {},
}) {
  async function advanceJob(jobId, states) {
    for (const state of states) {
      try {
        await engine.transitionJob(jobId, state, { reason: `task advanced job to ${state}` });
      } catch (error) {
        if (error.name !== 'InvalidTransitionError') {
          throw error;
        }

        logger(`[scheduler] job ${jobId} could not enter ${state}: ${error.message}`);
        return false;
      }
    }

    return true;
  }

  async function allTasksSettled(jobId) {
    const tasks = await repos.tasks.listByJob(jobId);

    return tasks.length > 0 && tasks.every((task) => ['completed', 'cancelled'].includes(task.status));
  }

  /**
   * Execute the next eligible task of a job.
   * @param {string} jobId
   * @param {{workerId?: string, taskType?: string, agentId?: string}} options
   */
  async function runNextTask(jobId, options = {}) {
    const workerId = options.workerId || `worker-${process.pid}`;
    const tasks = await repos.tasks.listByJob(jobId);
    const eligible = tasks.filter((task) => {
      if (!['pending', 'failed'].includes(task.status)) {
        return false;
      }

      if (options.taskType && task.task_type !== options.taskType) {
        return false;
      }

      if (options.agentId && task.assigned_agent !== options.agentId) {
        return false;
      }

      return task.attempt < task.max_attempts;
    });

    if (eligible.length === 0) {
      return { ran: false, reason: 'no eligible task' };
    }

    eligible.sort((a, b) => a.priority - b.priority || new Date(a.created_at) - new Date(b.created_at));
    const task = eligible[0];

    const claimed = await repos.tasks.claimLease(task.id, workerId, 120_000);

    if (!claimed) {
      return { ran: false, reason: 'lease held by another worker', taskId: task.id };
    }

    const agent = registry.find(task.assigned_agent);

    if (!agent) {
      await repos.tasks.updateStatus(task.id, 'blocked', { lockedBy: null, lockedUntil: null });
      await engine.recordEvent(jobId, 'task.blocked', { reason: 'unknown agent', assignedAgent: task.assigned_agent }, { taskId: task.id });
      return { ran: false, reason: 'unknown agent', taskId: task.id };
    }

    await engine.transitionTask(task.id, 'running', { reason: `claimed by ${workerId}` });

    const route = routeFor({ taskType: task.task_type });
    const startedAt = Date.now();

    try {
      const result = await modelRunner({
        agent,
        task,
        route,
        timeoutMs: agent.timeoutMs,
      });

      const latencyMs = Date.now() - startedAt;

      await repos.modelUsage.create({
        jobId,
        taskId: task.id,
        agentId: agent.id,
        provider: route.provider,
        model: route.model,
        inputTokens: result.inputTokens ?? null,
        outputTokens: result.outputTokens ?? null,
        latencyMs,
        success: true,
      });

      await repos.tasks.updateStatus(task.id, 'completed', { result: result.result, lockedBy: null, lockedUntil: null });
      await engine.recordEvent(jobId, 'task.completed', { agentId: agent.id, taskType: task.task_type }, { taskId: task.id, agentId: agent.id });
      await engine.recordAudit(jobId, 'task.completed', { actorType: 'agent', actorId: agent.id, resourceType: 'task', resourceId: task.id, details: { latencyMs } });

      const path = JOB_PATH_AFTER_TASK[task.task_type];

      if (path) {
        await advanceJob(jobId, path);
      }

      if (await allTasksSettled(jobId)) {
        try {
          await engine.transitionJob(jobId, 'completed', { reason: 'all tasks settled' });
        } catch (error) {
          if (error.name !== 'InvalidTransitionError') {
            throw error;
          }

          logger(`[scheduler] job ${jobId} could not complete: ${error.message}`);
        }
      }

      return { ran: true, taskId: task.id, agentId: agent.id, result: result.result };
    } catch (error) {
      const latencyMs = Date.now() - startedAt;
      const attempt = (task.attempt || 0) + 1;

      await repos.modelUsage.create({
        jobId,
        taskId: task.id,
        agentId: agent.id,
        provider: route.provider,
        model: route.model,
        latencyMs,
        success: false,
      });

      await repos.tasks.updateStatus(task.id, 'failed', { attempt, lockedBy: null, lockedUntil: null });
      await engine.recordEvent(jobId, 'task.failed', { error: error.message, attempt }, { taskId: task.id, agentId: agent.id });

      logger(`[scheduler] task ${task.id} failed: ${error.message}`);
      return { ran: true, taskId: task.id, failed: true, error: error.message };
    }
  }

  return { runNextTask };
}
