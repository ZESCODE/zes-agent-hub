// zes-agent-hub — Castor planner (ZAP v1 §4.2, Milestone 2)
// Turns an objective into a task plan with complete task contracts.

const PLAN_TEMPLATES = {
  scout_fork_build_sell: [
    {
      taskType: 'scout',
      assignedAgent: 'john',
      objective: 'Research candidate repositories for the objective and score them.',
      expectedOutputs: ['candidate list with scores', 'source links', 'risk summary'],
      acceptanceCriteria: ['Repository exists', 'License reviewed', 'Recommendation supported by evidence'],
      priority: 1,
    },
    {
      taskType: 'design',
      assignedAgent: 'siti',
      objective: 'Define the product identity and interface requirements for the selected candidate.',
      expectedOutputs: ['brand direction', 'interface requirements'],
      acceptanceCriteria: ['Identity covers name, tone and palette', 'Requirements are implementable'],
      priority: 2,
    },
    {
      taskType: 'build',
      assignedAgent: 'laurent',
      objective: 'Implement the approved rebrand and configuration changes on an isolated branch.',
      expectedOutputs: ['branch with changes', 'reviewable diff', 'build and test output'],
      acceptanceCriteria: ['Build completes', 'Type checks pass', 'No privileged secrets in client bundles'],
      priority: 3,
    },
    {
      taskType: 'deploy',
      assignedAgent: 'labu',
      objective: 'Deploy a preview and record the deployment evidence.',
      expectedOutputs: ['deployment id', 'public URL', 'health check result'],
      acceptanceCriteria: ['Correct project selected', 'Health check passes'],
      priority: 4,
    },
    {
      taskType: 'verify',
      assignedAgent: 'verifier',
      objective: 'Independently verify the objective, acceptance criteria and deployment evidence.',
      expectedOutputs: ['verification result with checks'],
      acceptanceCriteria: ['Every mandatory check evaluated', 'Missing evidence is not a pass'],
      priority: 5,
    },
  ],
};

const DEFAULT_PLAN = PLAN_TEMPLATES.scout_fork_build_sell;

export function createPlanner({ engine, registry, logger = () => {} }) {
  /**
   * Create the task plan for a job.
   * @param {string} jobId
   * @param {{taskType?: string, template?: string}} options
   */
  async function planJob(jobId, options = {}) {
    const job = await engine.getJob(jobId);

    if (!job) {
      throw new Error(`Job not found: ${jobId}`);
    }

    const template = options.template || job.workflow_type || 'scout_fork_build_sell';
    const steps = PLAN_TEMPLATES[template] || DEFAULT_PLAN;

    if (job.status === 'requested') {
      await engine.transitionJob(jobId, 'planning', { reason: 'castor planning started' });
    }

    const existing = await engine.listTasks(jobId);

    if (existing.length > 0) {
      return { jobId, tasks: existing, reused: true };
    }

    const tasks = [];

    for (const step of steps) {
      const agent = registry.forTaskType(step.taskType) || registry.find(step.assignedAgent);

      if (!agent) {
        throw new Error(`No agent available for task type ${step.taskType}`);
      }

      const task = await engine.createTask(jobId, {
        assignedAgent: agent.id,
        taskType: step.taskType,
        objective: `${step.objective}\n\nUser objective: ${job.objective}`,
        input: { workflowType: template, userObjective: job.objective },
        expectedOutputs: step.expectedOutputs,
        acceptanceCriteria: step.acceptanceCriteria,
        priority: step.priority,
        maxAttempts: agent.maxRetries + 1,
      });

      tasks.push(task);
      logger(`[plan] ${agent.id} <- ${step.taskType}`);
    }

    await engine.transitionJob(jobId, 'scouting', { reason: 'plan created' });

    return { jobId, tasks, reused: false };
  }

  return { planJob, templates: Object.keys(PLAN_TEMPLATES) };
}
