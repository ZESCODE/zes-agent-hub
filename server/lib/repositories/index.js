// zes-agent-hub — repositories (ZAP v1 §6)
// All reads and writes go through PostgreSQL; no in-memory Maps hold authoritative state.

import crypto from 'crypto';

function uuid() {
  return crypto.randomUUID();
}

function toJson(value) {
  return JSON.stringify(value ?? {});
}

function fromJson(value, fallback) {
  if (value === null || value === undefined) {
    return fallback;
  }

  if (typeof value === 'object') {
    return value;
  }

  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export function createRepositories(db) {
  const jobs = {
    async create({ id = uuid(), projectId = null, ownerId, title, objective, workflowType, metadata = {}, approvalRequired = false }) {
      const status = 'requested';
      const { rows } = await db.query(
        `INSERT INTO jobs (id, project_id, owner_id, title, objective, workflow_type, status, metadata, approval_required)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)
         RETURNING *`,
        [id, projectId, ownerId, title, objective, workflowType, status, toJson(metadata), approvalRequired],
      );

      return rows[0];
    },
    async findById(id) {
      const { rows } = await db.query('SELECT * FROM jobs WHERE id = $1', [id]);
      return rows[0] || null;
    },
    async listByOwner(ownerId, { status, limit = 50, offset = 0 } = {}) {
      const params = [ownerId];
      let sql = 'SELECT * FROM jobs WHERE owner_id = $1';

      if (status) {
        params.push(status);
        sql += ` AND status = $${params.length}`;
      }

      params.push(limit, offset);
      sql += ` ORDER BY created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`;

      const { rows } = await db.query(sql, params);
      return rows;
    },
    async updateStatus(id, status, patch = {}) {
      const params = [id, status];
      let sql = 'UPDATE jobs SET status = $2, updated_at = NOW()';

      if (patch.currentPhase !== undefined) {
        params.push(patch.currentPhase);
        sql += `, current_phase = $${params.length}`;
      }

      if (patch.currentAgent !== undefined) {
        params.push(patch.currentAgent);
        sql += `, current_agent = $${params.length}`;
      }

      if (patch.retryCount !== undefined) {
        params.push(patch.retryCount);
        sql += `, retry_count = $${params.length}`;
      }

      if (patch.metadata !== undefined) {
        params.push(toJson(patch.metadata));
        sql += `, metadata = $${params.length}::jsonb`;
      }

      if (status === 'completed' || status === 'failed' || status === 'cancelled') {
        sql += ', completed_at = NOW()';
      }

      sql += ' WHERE id = $1 RETURNING *';

      const { rows } = await db.query(sql, params);
      return rows[0] || null;
    },
    async remove(id) {
      const { rows } = await db.query('DELETE FROM jobs WHERE id = $1 RETURNING id', [id]);
      return rows[0] || null;
    },
  };

  const tasks = {
    async create({
      id = uuid(),
      jobId,
      parentTaskId = null,
      assignedAgent,
      taskType,
      objective,
      input = {},
      expectedOutputs = [],
      acceptanceCriteria = [],
      priority = 5,
      maxAttempts = 3,
    }) {
      const { rows } = await db.query(
        `INSERT INTO tasks (id, job_id, parent_task_id, assigned_agent, task_type, objective, input, expected_outputs, acceptance_criteria, priority, max_attempts)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9::jsonb, $10, $11)
         RETURNING *`,
        [
          id,
          jobId,
          parentTaskId,
          assignedAgent,
          taskType,
          objective,
          toJson(input),
          toJson(expectedOutputs),
          toJson(acceptanceCriteria),
          priority,
          maxAttempts,
        ],
      );

      return rows[0];
    },
    async findById(id) {
      const { rows } = await db.query('SELECT * FROM tasks WHERE id = $1', [id]);
      return rows[0] || null;
    },
    async listByJob(jobId) {
      const { rows } = await db.query('SELECT * FROM tasks WHERE job_id = $1 ORDER BY created_at ASC', [jobId]);
      return rows;
    },
    async updateStatus(id, status, patch = {}) {
      const params = [id, status];
      let sql = 'UPDATE tasks SET status = $2, updated_at = NOW()';

      if (patch.result !== undefined) {
        params.push(toJson(patch.result));
        sql += `, result = $${params.length}::jsonb`;
      }

      if (patch.attempt !== undefined) {
        params.push(patch.attempt);
        sql += `, attempt = $${params.length}`;
      }

      if (patch.lockedBy !== undefined) {
        params.push(patch.lockedBy);
        sql += `, locked_by = $${params.length}`;
      }

      if (patch.lockedUntil !== undefined) {
        params.push(patch.lockedUntil);
        sql += `, locked_until = $${params.length}`;
      }

      if (status === 'running') {
        sql += ', started_at = NOW()';
      }

      if (status === 'completed' || status === 'failed' || status === 'cancelled') {
        sql += ', completed_at = NOW()';
      }

      sql += ' WHERE id = $1 RETURNING *';

      const { rows } = await db.query(sql, params);
      return rows[0] || null;
    },
    async claimLease(id, workerId, leaseMs = 60_000) {
      const { rows } = await db.query(
        `UPDATE tasks
         SET locked_by = $2, locked_until = NOW() + ($3 || ' milliseconds')::interval, updated_at = NOW()
         WHERE id = $1 AND (locked_until IS NULL OR locked_until < NOW())
         RETURNING *`,
        [id, workerId, String(leaseMs)],
      );

      return rows[0] || null;
    },
  };

  const events = {
    async append({ id = uuid(), jobId, taskId = null, agentId = null, eventType, payload = {} }) {
      const { rows } = await db.query(
        `INSERT INTO agent_events (id, job_id, task_id, agent_id, event_type, payload)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb)
         RETURNING *`,
        [id, jobId, taskId, agentId, eventType, toJson(payload)],
      );

      return rows[0];
    },
    async listByJob(jobId, { limit = 100, offset = 0 } = {}) {
      const { rows } = await db.query(
        'SELECT * FROM agent_events WHERE job_id = $1 ORDER BY created_at ASC LIMIT $2 OFFSET $3',
        [jobId, limit, offset],
      );

      return rows;
    },
  };

  const audit = {
    async append({ id = uuid(), ownerId = null, jobId = null, actorType, actorId, action, resourceType = null, resourceId = null, details = {} }) {
      const { rows } = await db.query(
        `INSERT INTO audit_logs (id, owner_id, job_id, actor_type, actor_id, action, resource_type, resource_id, details)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
         RETURNING *`,
        [id, ownerId, jobId, actorType, actorId, action, resourceType, resourceId, toJson(details)],
      );

      return rows[0];
    },
    async listByJob(jobId, { limit = 100, offset = 0 } = {}) {
      const { rows } = await db.query(
        'SELECT * FROM audit_logs WHERE job_id = $1 ORDER BY created_at ASC LIMIT $2 OFFSET $3',
        [jobId, limit, offset],
      );

      return rows;
    },
  };

  const artifacts = {
    async create({ id = uuid(), jobId, taskId = null, artifactType, name, storageUri, contentType = null, checksum = null, metadata = {} }) {
      const { rows } = await db.query(
        `INSERT INTO artifacts (id, job_id, task_id, artifact_type, name, storage_uri, content_type, checksum, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
         RETURNING *`,
        [id, jobId, taskId, artifactType, name, storageUri, contentType, checksum, toJson(metadata)],
      );

      return rows[0];
    },
    async listByJob(jobId) {
      const { rows } = await db.query('SELECT * FROM artifacts WHERE job_id = $1 ORDER BY created_at ASC', [jobId]);
      return rows;
    },
  };

  const approvals = {
    async create({ id = uuid(), jobId, taskId = null, requestedBy, actionType, actionDescription, requestedPayload = {}, expiresAt = null }) {
      const { rows } = await db.query(
        `INSERT INTO approvals (id, job_id, task_id, requested_by, action_type, action_description, requested_payload, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
         RETURNING *`,
        [id, jobId, taskId, requestedBy, actionType, actionDescription, toJson(requestedPayload), expiresAt],
      );

      return rows[0];
    },
    async decide(id, { status, decidedBy, decisionReason = null }) {
      const decidedById = decidedBy;

      const { rows } = await db.query(
        `UPDATE approvals
         SET status = $2, decided_by = $3, decision_reason = $4, decided_at = NOW()
         WHERE id = $1 AND status = 'pending'
         RETURNING *`,
        [id, status, decidedById, decisionReason],
      );

      return rows[0] || null;
    },
    async listPending(limit = 50) {
      const { rows } = await db.query(
        `SELECT * FROM approvals
         WHERE status = 'pending' AND (expires_at IS NULL OR expires_at > NOW())
         ORDER BY created_at ASC LIMIT $1`,
        [limit],
      );

      return rows;
    },
  };

  const users = {
    async ensure({ id = uuid(), email, displayName = null }) {
      const { rows } = await db.query(
        `INSERT INTO users (id, email, display_name)
         VALUES ($1, $2, $3)
         ON CONFLICT (email) DO UPDATE SET display_name = COALESCE(EXCLUDED.display_name, users.display_name)
         RETURNING *`,
        [id, email, displayName],
      );

      return rows[0];
    },
    async findByEmail(email) {
      const { rows } = await db.query('SELECT * FROM users WHERE email = $1', [email]);
      return rows[0] || null;
    },
  };

  const toolExecutions = {
    async create({ id = uuid(), jobId, taskId = null, toolName, idempotencyKey, requestedBy, status = 'pending', input = {} }) {
      const { rows } = await db.query(
        `INSERT INTO tool_executions (id, job_id, task_id, tool_name, idempotency_key, requested_by, status, input)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
         ON CONFLICT (idempotency_key) DO NOTHING
         RETURNING *`,
        [id, jobId, taskId, toolName, idempotencyKey, requestedBy, status, toJson(input)],
      );

      if (rows[0]) {
        return { created: true, execution: rows[0] };
      }

      const existing = await db.query('SELECT * FROM tool_executions WHERE idempotency_key = $1', [idempotencyKey]);
      return { created: false, execution: existing.rows[0] };
    },
    async complete(id, { status, result = null, errorCode = null, errorMessage = null }) {
      const { rows } = await db.query(
        `UPDATE tool_executions
         SET status = $2, result = $3::jsonb, error_code = $4, error_message = $5, completed_at = NOW()
         WHERE id = $1
         RETURNING *`,
        [id, status, toJson(result), errorCode, errorMessage],
      );

      return rows[0] || null;
    },
  };

  const modelUsage = {
    async create({ id = uuid(), jobId, taskId = null, agentId, provider, model, inputTokens = null, outputTokens = null, estimatedCost = null, latencyMs = null, success }) {
      const { rows } = await db.query(
        `INSERT INTO model_usage (id, job_id, task_id, agent_id, provider, model, input_tokens, output_tokens, estimated_cost, latency_ms, success)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING *`,
        [id, jobId, taskId, agentId, provider, model, inputTokens, outputTokens, estimatedCost, latencyMs, success],
      );

      return rows[0];
    },
    async listByJob(jobId) {
      const { rows } = await db.query('SELECT * FROM model_usage WHERE job_id = $1 ORDER BY created_at ASC', [jobId]);
      return rows;
    },
  };

  return { jobs, tasks, events, audit, artifacts, approvals, users, toolExecutions, modelUsage };
}

export { fromJson };
