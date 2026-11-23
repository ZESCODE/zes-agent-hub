// zes-agent-hub — task scheduler (ZAP v1 §5.4, §11.3)
// Claims a task with a lease, executes it through the routed model, stores the
// structured result, records usage and releases the lease.
//
// A task is eligible when every task it depends on is settled. Dependencies come
// from the workflow definition attached to the job; jobs without a definition
// keep the legacy priority order.

import { routeFor } from '../providers/router.js';
import { DEFAULT_PROVIDER, isKnownProvider } from '../providers/registry.js';
import { ConditionEvaluationError, conditionContext, evaluateCondition } from '../workflows/conditions.js';
import { JOB_TRANSITIONS } from '../workflows/transitions.js';
import { dependenciesOf } from '../workflows/graph.js';

const JOB_PHASE_BY_TASK_TYPE = {
  scout: 'scouted',
  research: 'scouted',
  design: 'rebranding',
  branding: 'rebranding',
  build: 'building',
  implementation: 'building',
  deploy: 'deploying',
  infrastructure: 'deploying',
  verify: 'verified',
  verification: 'verified',
};

const JOB_PHASE_BY_NODE_TYPE = {
  castor: 'scouting',
  john: 'scouted',
  siti: 'rebranding',
  laurent: 'building',
  labu: 'deploying',
  verifier: 'verified',
  output: 'completed',
  report: 'completed',
};

const SETTLED_STATUSES = ['completed', 'cancelled', 'skipped'];

/**
 * Shortest sequence of job states that leads from one state to another.
 */
export function jobStatePath(from, to) {
  if (from === to) {
    return [];
  }

  const queue = [[from]];
  const seen = new Set([from]);

  while (queue.length > 0) {
    const path = queue.shift();
    const current = path[path.length - 1];
    const allowed = JOB_TRANSITIONS[current] || [];

    for (const next of allowed) {
      if (next === to) {
        return [...path.slice(1), next];
      }

      if (seen.has(next)) {
        continue;
      }

      seen.add(next);
      queue.push([...path, next]);
    }
  }

  return null;
}

export function createScheduler({
  engine,
  registry,
  repos,
  modelRunner,
  tools = null,
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

  async function advanceJobTo(jobId, target) {
    const job = await repos.jobs.findById(jobId);

    if (!job || !target || job.status === target) {
      return false;
    }

    const path = jobStatePath(job.status, target);

    if (!path) {
      logger(`[scheduler] job ${jobId} has no path from ${job.status} to ${target}`);
      return false;
    }

    return advanceJob(jobId, path);
  }

  function phaseForTask(task) {
    if (task.node_type && JOB_PHASE_BY_NODE_TYPE[task.node_type]) {
      return JOB_PHASE_BY_NODE_TYPE[task.node_type];
    }

    return JOB_PHASE_BY_TASK_TYPE[task.task_type] || null;
  }

  async function allTasksSettled(jobId) {
    const tasks = await repos.tasks.listByJob(jobId);

    return tasks.length > 0 && tasks.every((task) => SETTLED_STATUSES.includes(task.status));
  }

  function dependenciesSatisfied(task, tasksById) {
    const dependsOn = Array.isArray(task.depends_on) ? task.depends_on : [];

    return dependsOn.every((dependencyId) => {
      const dependency = tasksById.get(dependencyId);
      return dependency ? SETTLED_STATUSES.includes(dependency.status) : true;
    });
  }

  function backoffFor(task, definition) {
    const attempt = task.attempt || 0;
    const base = task.next_attempt_backoff_ms || definition?.execution?.defaultBackoffMs || 2000;
    const ceiling = definition?.execution?.maxBackoffMs || 60_000;
    const delay = Math.min(base * 2 ** Math.max(attempt - 1, 0), ceiling);

    return new Date(Date.now() + delay);
  }

  async function eligibleTasks(jobId, options) {
    const tasks = await repos.tasks.listByJob(jobId);
    const tasksById = new Map(tasks.map((task) => [task.id, task]));
    const now = Date.now();

    const eligible = tasks.filter((task) => {
      if (!['pending', 'failed', 'waiting_approval'].includes(task.status)) {
        return false;
      }

      if (task.attempt >= task.max_attempts) {
        return false;
      }

      if (task.next_attempt_at && new Date(task.next_attempt_at).getTime() > now) {
        return false;
      }

      if (!dependenciesSatisfied(task, tasksById)) {
        return false;
      }

      if (options.taskType && task.task_type !== options.taskType) {
        return false;
      }

      if (options.agentId && task.assigned_agent !== options.agentId) {
        return false;
      }

      return true;
    });

    eligible.sort((a, b) => a.priority - b.priority || new Date(a.created_at) - new Date(b.created_at));

    return eligible;
  }

  async function runApprovalTask(jobId, task, _definition) {
    const actionType = task.input?.actionType || 'approval';
    const expiresInMinutes = task.input?.expiresInMinutes || null;
    const expiresAt = expiresInMinutes ? new Date(Date.now() + expiresInMinutes * 60_000) : null;

    const existing = await repos.approvals.listByJob(jobId);
    const decided = existing.find(
      (approval) => approval.task_id === task.id && ['approved', 'rejected', 'expired'].includes(approval.status),
    );

    if (decided) {
      if (decided.status !== 'approved') {
        await engine.transitionTask(task.id, 'blocked', { reason: `approval ${decided.status}` });
        await engine.recordEvent(jobId, 'task.blocked', { reason: `approval ${decided.status}` }, { taskId: task.id });
        return { ran: true, taskId: task.id, blocked: true, approvalStatus: decided.status };
      }

      await repos.tasks.updateStatus(task.id, 'completed', { lockedBy: null, lockedUntil: null });
      await engine.recordEvent(jobId, 'task.completed', { approvalStatus: decided.status }, { taskId: task.id });

      const phase = phaseForTask(task);

      if (phase) {
        await advanceJobTo(jobId, phase);
      }

      return { ran: true, taskId: task.id, approvalStatus: decided.status };
    }

    const pending = existing.find((approval) => approval.task_id === task.id && approval.status === 'pending');

    if (!pending) {
      await engine.requestApproval(jobId, {
        taskId: task.id,
        requestedBy: 'scheduler',
        actionType,
        actionDescription: task.objective,
        requestedPayload: { nodeId: task.node_id, parameters: task.input?.parameters || {} },
        expiresAt,
      });

      await repos.tasks.updateStatus(task.id, 'waiting_approval', { lockedBy: null, lockedUntil: null });
      await engine.recordEvent(jobId, 'task.waiting_approval', { actionType }, { taskId: task.id });
      return { ran: true, taskId: task.id, waitingApproval: true };
    }

    await repos.tasks.updateStatus(task.id, 'waiting_approval', { lockedBy: null, lockedUntil: null });
    return { ran: true, taskId: task.id, waitingApproval: true };
  }

  function targetsOf(edges, nodeId, handle) {
    return edges
      .filter((edge) => edge.source === nodeId && (handle === undefined ? true : edge.sourceHandle === handle))
      .map((edge) => edge.target);
  }

  function descendantsOf(edges, startNodes) {
    const adjacency = new Map();

    for (const edge of edges) {
      if (!adjacency.has(edge.source)) {
        adjacency.set(edge.source, []);
      }

      adjacency.get(edge.source).push(edge.target);
    }

    const seen = new Set();
    const queue = [...startNodes];

    while (queue.length > 0) {
      const node = queue.shift();

      if (seen.has(node)) {
        continue;
      }

      seen.add(node);

      for (const next of adjacency.get(node) || []) {
        queue.push(next);
      }
    }

    return seen;
  }

  async function runConditionTask(jobId, task, definition) {
    const taskNodeId = task.input?.nodeId;
    const expression = task.input?.expression;
    const trueHandle = task.input?.trueHandle || 'true';
    const falseHandle = task.input?.falseHandle || 'false';
    const edges = definition?.edges || [];
    const job = await repos.jobs.findById(jobId);
    const tasks = await repos.tasks.listByJob(jobId);

    let branch;

    try {
      branch = evaluateCondition(expression, conditionContext({ job, tasks })) ? 'true' : 'false';
    } catch (error) {
      if (!(error instanceof ConditionEvaluationError)) {
        throw error;
      }

      await engine.transitionTask(task.id, 'blocked', {
        reason: `condition failed: ${error.message}`,
        result: { status: 'blocked', summary: error.message },
      });
      await repos.tasks.updateStatus(task.id, 'blocked', { lockedBy: null, lockedUntil: null });
      await engine.recordAudit(jobId, 'task.blocked', {
        actorType: 'system',
        actorId: 'scheduler',
        resourceType: 'task',
        resourceId: task.id,
        details: { expression, error: error.message },
      });

      return { ran: false, taskId: task.id, reason: `condition failed: ${error.message}` };
    }

    const takenHandle = branch === 'true' ? trueHandle : falseHandle;
    const untakenHandle = branch === 'true' ? falseHandle : trueHandle;

    await engine.transitionTask(task.id, 'completed', {
      reason: `condition evaluated to ${branch}`,
      result: {
        status: 'completed',
        summary: `Condition evaluated to ${branch}`,
        branch,
        expression,
      },
    });
    await repos.tasks.updateStatus(task.id, 'completed', { lockedBy: null, lockedUntil: null });
    await engine.recordEvent(jobId, 'task.completed', { branch, expression }, { taskId: task.id });

    const takenTargets = targetsOf(edges, taskNodeId, takenHandle);
    const alwaysTargets = edges
      .filter((edge) => edge.source === taskNodeId && edge.sourceHandle === undefined)
      .map((edge) => edge.target);
    const untakenTargets = targetsOf(edges, taskNodeId, untakenHandle);
    const kept = descendantsOf(edges, [...takenTargets, ...alwaysTargets]);
    const skippedNodes = [...descendantsOf(edges, untakenTargets)].filter((nodeId) => !kept.has(nodeId));
    const tasksByNode = new Map(tasks.filter((entry) => entry.node_id).map((entry) => [entry.node_id, entry]));

    for (const nodeId of skippedNodes) {
      const entry = tasksByNode.get(nodeId);

      if (!entry || !['pending', 'failed', 'blocked', 'waiting_approval'].includes(entry.status)) {
        continue;
      }

      await repos.tasks.updateStatus(entry.id, 'skipped', {
        result: { status: 'skipped', summary: `Branch "${untakenHandle}" not taken`, branch: untakenHandle },
        lockedBy: null,
        lockedUntil: null,
      });
      await engine.recordEvent(jobId, 'task.skipped', { nodeId, branch: untakenHandle }, { taskId: entry.id });
    }

    if (await allTasksSettled(jobId)) {
      try {
        await engine.completeJob(jobId, {
          requireVerification: definition ? definition.execution?.requireVerification !== false : false,
          reason: 'all tasks settled',
        });
      } catch (error) {
        logger(`[scheduler] job ${jobId} is not complete yet: ${error.message}`);
        await engine.recordEvent(jobId, 'job.blocked', { reason: error.message });
      }
    }

    return { ran: true, taskId: task.id, branch, skipped: [...skippedNodes] };
  }

  async function runToolTask(jobId, task, definition) {
    const toolName = task.input?.toolName;
    const parameters = task.input?.parameters || {};
    const idempotencyKey = `${jobId}:${task.node_id || task.id}:${toolName}`;

    if (task.input?.requiresApproval) {
      const approvals = await repos.approvals.listByJob(jobId);
      const approved = approvals.find(
        (approval) => approval.task_id === task.id && approval.status === 'approved',
      );

      if (!approved) {
        const pending = approvals.find((approval) => approval.task_id === task.id && approval.status === 'pending');

        if (!pending) {
          await engine.requestApproval(jobId, {
            taskId: task.id,
            requestedBy: 'scheduler',
            actionType: task.input?.operation || toolName,
            actionDescription: task.objective,
            requestedPayload: { nodeId: task.node_id, parameters },
          });

          await repos.tasks.updateStatus(task.id, 'waiting_approval', { lockedBy: null, lockedUntil: null });
          await engine.recordEvent(jobId, 'task.waiting_approval', { toolName }, { taskId: task.id });
          return { ran: true, taskId: task.id, waitingApproval: true };
        }

        await repos.tasks.updateStatus(task.id, 'waiting_approval', { lockedBy: null, lockedUntil: null });
        return { ran: true, taskId: task.id, waitingApproval: true };
      }
    }

    const outcome = await engine.recordToolExecution(jobId, {
      taskId: task.id,
      toolName,
      idempotencyKey,
      requestedBy: task.assigned_agent,
      input: parameters,
    });

    if (outcome.replayed) {
      await repos.tasks.updateStatus(task.id, 'completed', { result: outcome.execution.result, lockedBy: null, lockedUntil: null });
      await engine.recordEvent(jobId, 'task.completed', { toolName, replayed: true }, { taskId: task.id });
      return { ran: true, taskId: task.id, toolName, replayed: true };
    }
    const registryTools = tools;

    if (!registryTools || typeof registryTools.execute !== 'function') {
      await repos.toolExecutions.complete(outcome.execution.id, {
        status: 'failed',
        errorCode: 'tool_unavailable',
        errorMessage: `Tool ${toolName} is not registered`,
      });

      await repos.tasks.updateStatus(task.id, 'failed', { attempt: (task.attempt || 0) + 1, lockedBy: null, lockedUntil: null });
      return { ran: true, taskId: task.id, failed: true, error: `Tool ${toolName} is not registered` };
    }

    try {
      const result = await registryTools.execute({
        toolName,
        jobId,
        taskId: task.id,
        agentId: task.assigned_agent,
        parameters,
        idempotencyKey,
      });

      await repos.toolExecutions.complete(outcome.execution.id, { status: 'succeeded', result });
      await repos.tasks.updateStatus(task.id, 'completed', { result, lockedBy: null, lockedUntil: null });

      if (result && typeof result === 'object') {
        await engine.recordArtifact(jobId, {
          taskId: task.id,
          artifactType: 'tool_result',
          name: `${toolName} result`,
          storageUri: `zap://jobs/${jobId}/tasks/${task.id}/tool-result`,
          contentType: 'application/json',
          metadata: { toolName, parameters, result },
        });
      }

      await engine.recordEvent(jobId, 'task.completed', { toolName }, { taskId: task.id });
      await engine.recordAudit(jobId, 'tool.executed', {
        actorType: 'agent',
        actorId: task.assigned_agent,
        resourceType: 'tool_execution',
        resourceId: outcome.execution.id,
        details: { toolName, idempotencyKey },
      });

      const phase = phaseForTask(task);

      if (phase) {
        await advanceJobTo(jobId, phase);
      }

      return { ran: true, taskId: task.id, toolName, result };
    } catch (error) {
      const denied = error.name === 'ToolPermissionError';

      await repos.toolExecutions.complete(outcome.execution.id, {
        status: 'failed',
        errorCode: denied ? 'tool_permission_denied' : 'tool_failed',
        errorMessage: error.message,
      });

      if (denied) {
        await repos.tasks.updateStatus(task.id, 'blocked', { lockedBy: null, lockedUntil: null });
        await engine.recordEvent(jobId, 'task.blocked', { error: error.message, toolName }, { taskId: task.id });
        await engine.recordAudit(jobId, 'tool.permission_denied', {
          actorType: 'system',
          actorId: 'scheduler',
          resourceType: 'tool_execution',
          resourceId: outcome.execution.id,
          details: { toolName, agentId: task.assigned_agent, missing: error.missingPermissions || [] },
        });
        return { ran: true, taskId: task.id, blocked: true, error: error.message };
      }

      const attempt = (task.attempt || 0) + 1;
      await repos.tasks.updateStatus(task.id, 'failed', {
        attempt,
        nextAttemptAt: backoffFor({ ...task, attempt }, definition),
        lockedBy: null,
        lockedUntil: null,
      });

      await engine.recordEvent(jobId, 'task.failed', { error: error.message, attempt, toolName }, { taskId: task.id });
      return { ran: true, taskId: task.id, failed: true, error: error.message };
    }
  }

  /**
   * Results of the tasks this task depends on. Agents need the evidence their
   * predecessors produced, otherwise they answer without any context.
   */
  async function upstreamContext(jobId, task, definition) {
    if (!definition || !task.node_id) {
      return [];
    }

    const dependencies = dependenciesOf(definition).get(task.node_id) || new Set();
    const tasks = await repos.tasks.listByJob(jobId);
    const context = [];

    for (const upstream of tasks) {
      if (!dependencies.has(upstream.node_id)) {
        continue;
      }

      if (upstream.status !== 'completed') {
        continue;
      }

      const result = upstream.result || {};

      context.push({
        nodeId: upstream.node_id,
        taskType: upstream.task_type,
        summary: result.summary || '',
        outputs: Array.isArray(result.outputs) ? result.outputs : [],
        evidence: Array.isArray(result.evidence) ? result.evidence : [],
        data: result.data ?? result.value ?? null,
        raw: typeof result === 'object' && result !== null ? result : { value: result },
      });
    }

    return context;
  }

  async function runAgentTask(jobId, task, agent, route, definition) {
    let spent = null;

    if (definition?.budget) {
      const usage = await repos.modelUsage.listByJob(jobId);
      spent = {
        totalCostUsd: usage.reduce((total, entry) => total + Number(entry.estimated_cost || 0), 0),
        modelCalls: usage.length,
      };
    }

    const upstream = await upstreamContext(jobId, task, definition);
    const artifacts = await repos.artifacts.listByJob(jobId);
    const taskInput = task.input || {};

    const result = await modelRunner({
      agent,
      task: {
        ...task,
        objective: taskInput.userObjective
          ? `${task.objective}\n\nWorkflow objective: ${taskInput.userObjective}`
          : task.objective,
        input: {
          ...taskInput,
          upstream,
          artifacts: artifacts.map((artifact) => ({
            type: artifact.artifact_type,
            name: artifact.name,
            metadata: artifact.metadata,
          })),
        },
      },
      route,
      timeoutMs: agent.timeoutMs,
      budget: definition?.budget || null,
      spent,
    });

    const latencyMs = result.latencyMs ?? 0;

    await repos.modelUsage.create({
      jobId,
      taskId: task.id,
      agentId: agent.id,
      provider: result.provider ?? route.provider,
      model: result.model ?? route.model,
      inputTokens: result.inputTokens ?? null,
      outputTokens: result.outputTokens ?? null,
      estimatedCost: result.estimatedCost ?? null,
      latencyMs,
      success: true,
    });

    const evidence = Array.isArray(result.result?.evidence) ? result.result.evidence : [];

    if (agent.id === 'verifier') {
      await engine.recordArtifact(jobId, {
        taskId: task.id,
        artifactType: 'verification_report',
        name: `Verification for task ${task.id}`,
        storageUri: `zap://jobs/${jobId}/tasks/${task.id}/verification`,
        contentType: 'application/json',
        metadata: { summary: result.result?.summary || '', evidence, outputs: result.result?.outputs || [] },
      });
    }

    await repos.tasks.updateStatus(task.id, 'completed', { result: result.result, lockedBy: null, lockedUntil: null });
    await engine.recordEvent(jobId, 'task.completed', { agentId: agent.id, taskType: task.task_type }, { taskId: task.id, agentId: agent.id });
    await engine.recordAudit(jobId, 'task.completed', { actorType: 'agent', actorId: agent.id, resourceType: 'task', resourceId: task.id, details: { latencyMs } });

    const phase = phaseForTask(task);

    if (phase) {
      await advanceJobTo(jobId, phase);
    }

    return { ran: true, taskId: task.id, agentId: agent.id, result: result.result };
  }

  /**
   * Execute the next eligible task of a job.
   * @param {string} jobId
   * @param {{workerId?: string, taskType?: string, agentId?: string}} options
   */
  async function runNextTask(jobId, options = {}) {
    const workerId = options.workerId || `worker-${process.pid}`;
    const definition = options.definition || null;
    const eligible = await eligibleTasks(jobId, options);

    if (eligible.length === 0) {
      return { ran: false, reason: 'no eligible task' };
    }

    const task = eligible[0];
    const claimed = await repos.tasks.claimLease(task.id, workerId, 120_000);

    if (!claimed) {
      return { ran: false, reason: 'lease held by another worker', taskId: task.id };
    }

    const kind = task.task_kind || 'agent';

    if (claimed.status === 'failed') {
      await engine.transitionTask(claimed.id, 'pending', { reason: 'retry after backoff' });
    }

    if (kind === 'approval') {
      await engine.transitionTask(task.id, 'running', { reason: `claimed by ${workerId}` });
      return runApprovalTask(jobId, claimed, definition);
    }

    if (kind === 'tool') {
      await engine.transitionTask(task.id, 'running', { reason: `claimed by ${workerId}` });
      return runToolTask(jobId, claimed, definition);
    }

    if (kind === 'condition') {
      await engine.transitionTask(task.id, 'running', { reason: `claimed by ${workerId}` });
      return runConditionTask(jobId, claimed, definition);
    }

    const agent = registry.find(task.assigned_agent);

    if (!agent) {
      await repos.tasks.updateStatus(task.id, 'blocked', { lockedBy: null, lockedUntil: null });
      await engine.recordEvent(jobId, 'task.blocked', { reason: 'unknown agent', assignedAgent: task.assigned_agent }, { taskId: task.id });
      return { ran: false, reason: 'unknown agent', taskId: task.id };
    }

    const jobOverride = await jobRouteOverride(jobId);

    await engine.transitionTask(task.id, 'running', { reason: `claimed by ${workerId}` });

    const route = routeFor({
      taskType: task.task_type,
      provider: taskProviderFor(task, agent, jobOverride),
      model: taskModelFor(task, agent, jobOverride),
      fallbackProvider: agent.fallbackProvider,
      fallbackModel: agent.fallbackModel,
    });
    const startedAt = Date.now();

    try {
      const outcome = await runAgentTask(jobId, claimed, agent, route, definition);
      outcome.latencyMs = Date.now() - startedAt;

      if (await allTasksSettled(jobId)) {
        try {
          await engine.completeJob(jobId, {
            requireVerification: definition ? definition.execution?.requireVerification !== false : false,
            reason: 'all tasks settled',
          });
        } catch (error) {
          logger(`[scheduler] job ${jobId} is not complete yet: ${error.message}`);
          await engine.recordEvent(jobId, 'job.blocked', { reason: error.message });
        }
      }

      return outcome;
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

      await repos.tasks.updateStatus(task.id, 'failed', {
        attempt,
        nextAttemptAt: backoffFor({ ...task, attempt }, definition),
        lockedBy: null,
        lockedUntil: null,
      });

      await engine.recordEvent(jobId, 'task.failed', { error: error.message, attempt }, { taskId: task.id, agentId: agent.id });

      logger(`[scheduler] task ${task.id} failed: ${error.message}`);
      return { ran: true, taskId: task.id, failed: true, error: error.message };
    }
  }

  /**
   * Reclaim leases that expired without a result and make the tasks eligible again.
   */
  async function reapExpiredLeases(jobId) {
    const tasks = await repos.tasks.listByJob(jobId);
    const expired = tasks.filter(
      (task) => task.status === 'running' && task.locked_until && new Date(task.locked_until).getTime() < Date.now(),
    );

    for (const task of expired) {
      await repos.tasks.updateStatus(task.id, 'pending', { lockedBy: null, lockedUntil: null });
      await engine.recordEvent(jobId, 'task.lease_reclaimed', { taskId: task.id }, { taskId: task.id });
    }

    return expired;
  }

  /**
   * A seat that names a provider owns its model list, so its own model id is
   * used. The default provider keeps the task-type model from the route table.
   */
  function routeModelFor(agent) {
    if (!agent?.provider || agent.provider === DEFAULT_PROVIDER) {
      return undefined;
    }

    return agent.model || undefined;
  }

  /**
   * A task may name its own provider. The workflow contract validates the id
   * against the provider registry before the task is created, so the scheduler
   * only accepts what it knows. A job level override applies to every task of
   * that job unless the task names its own provider.
   */
  function taskProviderFor(task, agent, jobOverride) {
    const requested = task.input?.provider;

    if (isKnownProvider(requested)) {
      return requested;
    }

    if (isKnownProvider(jobOverride?.provider)) {
      return jobOverride.provider;
    }

    return agent.provider || DEFAULT_PROVIDER;
  }

  /**
   * A task may name its own model. It only applies when the task also names a
   * provider, so a model id never crosses provider boundaries by accident.
   */
  function taskModelFor(task, agent, jobOverride) {
    const requestedModel = task.input?.model;
    const requestedProvider = task.input?.provider;

    if (requestedModel && isKnownProvider(requestedProvider)) {
      return requestedModel;
    }

    if (jobOverride?.model && isKnownProvider(jobOverride.provider)) {
      return jobOverride.model;
    }

    return routeModelFor(agent);
  }

  /**
   * Provider override stored on the job when it was created.
   */
  async function jobRouteOverride(jobId) {
    const job = await repos.jobs.findById(jobId);
    const metadata = job?.metadata;

    if (!metadata || typeof metadata !== 'object') {
      return null;
    }

    const provider = isKnownProvider(metadata.provider) ? metadata.provider : null;
    const model = typeof metadata.model === 'string' && metadata.model.trim() ? metadata.model.trim() : null;

    if (!provider && !model) {
      return null;
    }

    return { provider, model };
  }

  return { runNextTask, reapExpiredLeases };
}
