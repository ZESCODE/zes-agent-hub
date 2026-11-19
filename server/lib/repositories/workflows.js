// zes-agent-hub — workflow definition repository
// Stores versioned workflow definitions and the graph snapshot a job runs against.

import crypto from 'crypto';

function uuid() {
  return crypto.randomUUID();
}

function toJson(value) {
  return JSON.stringify(value ?? {});
}

export function createWorkflowRepository(db) {
  const definitions = {
    async create({
      id = uuid(),
      workflowId,
      version,
      name,
      description = null,
      status = 'draft',
      contractVersion,
      definition,
      createdBy = null,
    }) {
      const { rows } = await db.query(
        `INSERT INTO workflow_definitions
           (id, workflow_id, version, name, description, status, contract_version, definition, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)
         RETURNING *`,
        [id, workflowId, version, name, description, status, contractVersion, toJson(definition), createdBy],
      );

      return rows[0];
    },

    async findById(id) {
      const { rows } = await db.query('SELECT * FROM workflow_definitions WHERE id = $1', [id]);
      return rows[0] || null;
    },

    async findVersion(workflowId, version) {
      const { rows } = await db.query(
        'SELECT * FROM workflow_definitions WHERE workflow_id = $1 AND version = $2',
        [workflowId, version],
      );

      return rows[0] || null;
    },

    async latestVersion(workflowId) {
      const { rows } = await db.query(
        'SELECT * FROM workflow_definitions WHERE workflow_id = $1 ORDER BY version DESC LIMIT 1',
        [workflowId],
      );

      return rows[0] || null;
    },

    async latestPublished(workflowId) {
      const { rows } = await db.query(
        `SELECT * FROM workflow_definitions
         WHERE workflow_id = $1 AND status = 'published'
         ORDER BY version DESC LIMIT 1`,
        [workflowId],
      );

      return rows[0] || null;
    },

    async nextVersion(workflowId) {
      const { rows } = await db.query(
        'SELECT COALESCE(MAX(version), 0) + 1 AS next FROM workflow_definitions WHERE workflow_id = $1',
        [workflowId],
      );

      return rows[0]?.next || 1;
    },

    async list({ status, limit = 50, offset = 0 } = {}) {
      const params = [];
      let sql = 'SELECT * FROM workflow_definitions';

      if (status) {
        params.push(status);
        sql += ` WHERE status = $${params.length}`;
      }

      params.push(limit, offset);
      sql += ` ORDER BY workflow_id ASC, version DESC LIMIT $${params.length - 1} OFFSET $${params.length}`;

      const { rows } = await db.query(sql, params);
      return rows;
    },

    async listVersions(workflowId) {
      const { rows } = await db.query(
        'SELECT * FROM workflow_definitions WHERE workflow_id = $1 ORDER BY version DESC',
        [workflowId],
      );

      return rows;
    },

    async publish(id) {
      const { rows } = await db.query(
        `UPDATE workflow_definitions
         SET status = 'published', published_at = NOW(), updated_at = NOW()
         WHERE id = $1 AND status = 'draft'
         RETURNING *`,
        [id],
      );

      return rows[0] || null;
    },

    async archive(id) {
      const { rows } = await db.query(
        `UPDATE workflow_definitions
         SET status = 'archived', updated_at = NOW()
         WHERE id = $1
         RETURNING *`,
        [id],
      );

      return rows[0] || null;
    },
  };

  const runs = {
    async create({
      id = uuid(),
      jobId,
      workflowDefinitionId,
      workflowId,
      workflowVersion,
      contractVersion,
      graphSnapshot,
      status = 'planned',
    }) {
      const { rows } = await db.query(
        `INSERT INTO workflow_runs
           (id, job_id, workflow_definition_id, workflow_id, workflow_version, contract_version, graph_snapshot, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
         RETURNING *`,
        [id, jobId, workflowDefinitionId, workflowId, workflowVersion, contractVersion, toJson(graphSnapshot), status],
      );

      return rows[0];
    },

    async findByJob(jobId) {
      const { rows } = await db.query('SELECT * FROM workflow_runs WHERE job_id = $1', [jobId]);
      return rows[0] || null;
    },

    async updateStatus(id, status) {
      const { rows } = await db.query(
        `UPDATE workflow_runs
         SET status = $2, updated_at = NOW(),
             completed_at = CASE WHEN $2 IN ('completed', 'failed', 'cancelled') THEN NOW() ELSE completed_at END
         WHERE id = $1
         RETURNING *`,
        [id, status],
      );

      return rows[0] || null;
    },
  };

  return { definitions, runs };
}
