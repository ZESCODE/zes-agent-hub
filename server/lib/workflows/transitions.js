// zes-agent-hub — workflow state machine (ZAP v1 §5)
// Only the workflow engine performs authoritative transitions.

export const JOB_TRANSITIONS = {
  requested: ['planning', 'cancelled', 'failed'],
  planning: ['scouting', 'waiting_approval', 'blocked', 'failed', 'cancelled', 'paused'],
  scouting: ['scouted', 'blocked', 'failed', 'cancelled', 'paused'],
  scouted: ['forking', 'waiting_approval', 'blocked', 'failed', 'cancelled', 'paused'],
  forking: ['forked', 'waiting_approval', 'blocked', 'failed', 'cancelled', 'paused'],
  forked: ['rebranding', 'waiting_approval', 'blocked', 'failed', 'cancelled', 'paused'],
  rebranding: ['reviewing', 'waiting_approval', 'blocked', 'failed', 'cancelled', 'paused'],
  reviewing: ['building', 'waiting_approval', 'blocked', 'failed', 'cancelled', 'paused'],
  building: ['deploying', 'waiting_approval', 'blocked', 'failed', 'cancelled', 'paused'],
  deploying: ['verifying', 'waiting_approval', 'blocked', 'failed', 'cancelled', 'paused'],
  verifying: ['verified', 'building', 'blocked', 'failed', 'cancelled', 'paused'],
  verified: ['whop_drafting', 'completed', 'blocked', 'failed', 'cancelled'],
  whop_drafting: ['completed', 'waiting_approval', 'blocked', 'failed', 'cancelled'],
  completed: [],
  waiting_approval: ['planning', 'forking', 'building', 'deploying', 'completed', 'blocked', 'failed', 'cancelled', 'paused'],
  blocked: ['planning', 'building', 'cancelled', 'failed'],
  failed: ['planning', 'cancelled'],
  cancelled: [],
  paused: ['planning', 'scouting', 'scouted', 'forking', 'forked', 'rebranding', 'reviewing', 'building', 'deploying', 'verifying', 'verified', 'waiting_approval', 'blocked', 'failed', 'cancelled'],
};

export const TASK_TRANSITIONS = {
  pending: ['running', 'cancelled'],
  running: ['completed', 'failed', 'blocked', 'waiting_approval', 'cancelled'],
  waiting_approval: ['running', 'cancelled', 'failed'],
  completed: [],
  failed: ['pending', 'cancelled'],
  blocked: ['pending', 'cancelled'],
  cancelled: [],
};

export class InvalidTransitionError extends Error {
  constructor(entity, from, to) {
    super(`Invalid ${entity} transition: ${from} -> ${to}`);
    this.name = 'InvalidTransitionError';
    this.entity = entity;
    this.from = from;
    this.to = to;
  }
}

function graphFor(entity) {
  if (entity === 'job') {
    return JOB_TRANSITIONS;
  }

  if (entity === 'task') {
    return TASK_TRANSITIONS;
  }

  throw new Error(`Unknown entity: ${entity}`);
}

/**
 * Validate a transition against the permitted graph.
 * @throws {InvalidTransitionError}
 */
export function assertTransition(entity, from, to) {
  const graph = graphFor(entity);
  const allowed = graph[from];

  if (!allowed) {
    throw new InvalidTransitionError(entity, from, to);
  }

  if (!allowed.includes(to)) {
    throw new InvalidTransitionError(entity, from, to);
  }

  return true;
}

export function canTransition(entity, from, to) {
  try {
    assertTransition(entity, from, to);
    return true;
  } catch {
    return false;
  }
}

export function allowedTransitions(entity, from) {
  return graphFor(entity)[from] || [];
}
