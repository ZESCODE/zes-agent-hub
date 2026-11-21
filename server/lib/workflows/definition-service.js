// zes-agent-hub — workflow definition service
// Creates, versions, publishes and snapshots workflow definitions. Every write
// is validated against the contract and recorded in the audit log.

import { validateWorkflowDefinition, WORKFLOW_CONTRACT_VERSION } from './contract.js';
import { materializeTasks, taskDependencyEdges } from './graph.js';

const TERMINAL_JOB_STATUSES = ['completed', 'cancelled', 'failed'];

export class WorkflowAccessError extends Error {
  constructor(message, status = 404) {
    super(message);
    this.name = 'WorkflowAccessError';
    this.status = status;
  }
}

/**
 * A definition is visible to its owner and to every caller when it has no
 * owner, because a definition without an owner is a platform shared
 * definition. A caller without a principal is an internal caller and sees
 * everything.
 */
function canAccess(stored, ownerPrincipal) {
  if (!ownerPrincipal) {
    return true;
  }

  if (!stored.owner_principal) {
    return true;
  }

  return stored.owner_principal === ownerPrincipal;
}

export function createDefinitionService({
  repos,
  workflowRepos,
  engine,
  registry,
  knownTaskTypes = () => [],
  logger = () => {},
}) {
  function validate(definition) {
    return validateWorkflowDefinition(definition, { registry, knownTaskTypes });
  }

  function assertAccess(stored, ownerPrincipal, action) {
    if (!stored) {
      throw new WorkflowAccessError('Workflow not found', 404);
    }

    if (!canAccess(stored, ownerPrincipal)) {
      throw new WorkflowAccessError(`You are not allowed to ${action} this workflow`, 403);
    }
  }

  async function createDefinition(
    input,
    { actorType = 'user', actorId = 'engine', ownerPrincipal = null } = {},
  ) {
    const definition = validate({ ...input, version: input.version || 1, status: 'draft' });
    const version = await workflowRepos.definitions.nextVersion(definition.workflowId);

    const stored = await workflowRepos.definitions.create({
      workflowId: definition.workflowId,
      version,
      name: definition.name,
      description: definition.description || null,
      status: 'draft',
      contractVersion: WORKFLOW_CONTRACT_VERSION,
      definition: { ...definition, version, status: 'draft' },
      createdBy: null,
      ownerPrincipal,
    });

    await repos.audit.append({
      actorType,
      actorId,
      action: 'workflow.definition.created',
      resourceType: 'workflow_definition',
      resourceId: stored.id,
      details: { workflowId: stored.workflow_id, version: stored.version, ownerPrincipal },
    });

    logger(`[workflow] definition ${stored.workflow_id} v${stored.version} created`);
    return stored;
  }

  async function updateDefinition(
    workflowId,
    input,
    { actorType = 'user', actorId = 'engine', ownerPrincipal = null } = {},
  ) {
    const latest = await workflowRepos.definitions.latestVersion(workflowId);

    if (!latest) {
      throw new Error(`Workflow not found: ${workflowId}`);
    }

    assertAccess(latest, ownerPrincipal, 'edit');

    const version = await workflowRepos.definitions.nextVersion(workflowId);
    const definition = validate({ ...input, workflowId, version, status: 'draft' });

    const stored = await workflowRepos.definitions.create({
      workflowId,
      version,
      name: definition.name,
      description: definition.description || null,
      status: 'draft',
      contractVersion: WORKFLOW_CONTRACT_VERSION,
      definition,
      createdBy: null,
      ownerPrincipal: latest.owner_principal,
    });

    await repos.audit.append({
      actorType,
      actorId,
      action: 'workflow.definition.updated',
      resourceType: 'workflow_definition',
      resourceId: stored.id,
      details: { workflowId, version, previousVersion: latest.version },
    });

    return stored;
  }

  /**
   * Delete every version of a workflow. Jobs that already ran it keep their
   * tasks and artifacts; only the definition link and the stored snapshot are
   * removed. A job that is still running blocks the delete.
   */
  async function deleteDefinition(
    workflowId,
    { actorType = 'user', actorId = 'engine', ownerPrincipal = null } = {},
  ) {
    const versions = await workflowRepos.definitions.listVersions(workflowId);

    if (versions.length === 0) {
      throw new Error(`Workflow not found: ${workflowId}`);
    }

    assertAccess(versions[0], ownerPrincipal, 'delete');

    const jobs = await repos.jobs.listByWorkflow(workflowId);
    const active = jobs.filter((job) => !TERMINAL_JOB_STATUSES.includes(job.status));

    if (active.length > 0) {
      const error = new Error(
        `Workflow ${workflowId} is still used by ${active.length} active job(s): ${active
          .map((job) => `${job.id.slice(0, 8)} (${job.status})`)
          .join(', ')}`,
      );
      error.name = 'WorkflowInUseError';
      throw error;
    }

    const result = await workflowRepos.definitions.deleteWorkflow(workflowId);

    await repos.audit.append({
      actorType,
      actorId,
      action: 'workflow.definition.deleted',
      resourceType: 'workflow_definition',
      resourceId: workflowId,
      details: {
        workflowId,
        versions: result.versions.map((version) => version.version),
        detachedRuns: result.detachedRuns,
        detachedJobs: result.detachedJobs,
      },
    });

    logger(`[workflow] definition ${workflowId} deleted (${result.versions.length} version(s))`);
    return result;
  }

  async function publishDefinition(
    workflowId,
    version,
    { actorType = 'user', actorId = 'engine', ownerPrincipal = null } = {},
  ) {
    const stored = version
      ? await workflowRepos.definitions.findVersion(workflowId, version)
      : await workflowRepos.definitions.latestVersion(workflowId);

    if (!stored) {
      throw new Error(`Workflow not found: ${workflowId}`);
    }

    assertAccess(stored, ownerPrincipal, 'publish');

    if (stored.status !== 'draft') {
      throw new Error(`Workflow version ${stored.version} is already ${stored.status}`);
    }

    validate(stored.definition);

    const published = await workflowRepos.definitions.publish(stored.id);

    if (!published) {
      throw new Error(`Workflow version ${stored.version} could not be published`);
    }

    await repos.audit.append({
      actorType,
      actorId,
      action: 'workflow.definition.published',
      resourceType: 'workflow_definition',
      resourceId: published.id,
      details: { workflowId, version: published.version },
    });

    return published;
  }

  async function resolveDefinition(workflowId, version, { ownerPrincipal = null, action = 'access' } = {}) {
    const stored = version
      ? await workflowRepos.definitions.findVersion(workflowId, version)
      : await workflowRepos.definitions.latestPublished(workflowId) ||
        (await workflowRepos.definitions.latestVersion(workflowId));

    if (!stored) {
      throw new Error(`Workflow not found: ${workflowId}`);
    }

    assertAccess(stored, ownerPrincipal, action);

    return stored;
  }

  /**
   * Attach a definition to a job and store the graph snapshot the job runs
   * against. Editing the definition afterwards never changes a running job.
   */
  async function attachToJob(
    jobId,
    { workflowId, version },
    { actorType = 'user', actorId = 'engine', ownerPrincipal = null } = {},
  ) {
    const stored = await resolveDefinition(workflowId, version, { ownerPrincipal, action: 'run' });
    const definition = validate(stored.definition);

    const run = await workflowRepos.runs.create({
      jobId,
      workflowDefinitionId: stored.id,
      workflowId: stored.workflow_id,
      workflowVersion: stored.version,
      contractVersion: stored.contract_version,
      graphSnapshot: definition,
    });

    const job = await repos.jobs.updateWorkflowLink(jobId, {
      workflowDefinitionId: stored.id,
      workflowId: stored.workflow_id,
      workflowVersion: stored.version,
      workflowRunId: run.id,
    });

    await repos.audit.append({
      jobId,
      actorType,
      actorId,
      action: 'workflow.run.attached',
      resourceType: 'workflow_run',
      resourceId: run.id,
      details: { workflowId: stored.workflow_id, version: stored.version },
    });

    return { job, run, definition };
  }

  /**
   * Create the tasks of a job from its attached definition.
   */
  async function materializeJob(jobId) {
    const run = await workflowRepos.runs.findByJob(jobId);

    if (!run) {
      throw new Error(`Job ${jobId} has no workflow definition`);
    }

    const definition = validate(run.graph_snapshot);
    const job = await repos.jobs.findById(jobId);
    const startNode = definition.nodes.find((node) => node.type === 'start');
    const startObjective = startNode?.config?.objective?.trim();
    const contracts = materializeTasks(definition, {
      objective: startObjective || job?.objective || run.graph_snapshot.objective,
    });

    if (job?.status === 'requested') {
      await engine.transitionJob(jobId, 'planning', { reason: 'workflow definition planning started' });
    }

    const taskIdByNodeId = new Map();

    for (const contract of contracts) {
      const task = await engine.createTask(jobId, {
        assignedAgent: contract.assignedAgent,
        taskType: contract.taskType,
        objective: contract.objective,
        input: contract.input,
        expectedOutputs: contract.expectedOutputs,
        acceptanceCriteria: contract.acceptanceCriteria,
        priority: contract.priority,
        maxAttempts: contract.maxAttempts,
        nodeId: contract.nodeId,
        nodeType: contract.nodeType,
        taskKind: contract.kind,
      });

      taskIdByNodeId.set(contract.nodeId, task.id);
    }

    const edges = taskDependencyEdges(definition, taskIdByNodeId);

    for (const edge of edges) {
      const target = await repos.tasks.findById(edge.target);

      if (!target) {
        continue;
      }

      const dependsOn = Array.isArray(target.depends_on) ? target.depends_on : [];
      await repos.tasks.updateStatus(edge.target, target.status, { dependsOn: [...dependsOn, edge.source] });
    }

    const current = await repos.jobs.findById(jobId);

    if (current?.status === 'planning') {
      await engine.transitionJob(jobId, 'scouting', { reason: 'workflow definition plan created' });
    }

    await workflowRepos.runs.updateStatus(run.id, 'planned');

    return { run, definition, tasks: await repos.tasks.listByJob(jobId) };
  }

  return {
    createDefinition,
    updateDefinition,
    deleteDefinition,
    publishDefinition,
    resolveDefinition,
    attachToJob,
    materializeJob,
    validate,
    contractVersion: WORKFLOW_CONTRACT_VERSION,
  };
}
