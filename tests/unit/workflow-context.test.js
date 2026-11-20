import { describe, expect, it } from 'vitest';

import { materializeTasks } from '../../server/lib/workflows/graph.js';

describe('workflow context', () => {
  it('threads the job objective into every agent task', () => {
    const definition = {
      workflowId: 'scout',
      version: 1,
      name: 'Scout',
      status: 'draft',
      nodes: [
        {
          id: 'castor_plan',
          type: 'castor',
          position: { x: 0, y: 0 },
          config: { agentId: 'castor', routingPolicy: { taskType: 'plan', complexity: 'high' } },
        },
        {
          id: 'john_scout',
          type: 'john',
          position: { x: 200, y: 0 },
          config: { agentId: 'john', routingPolicy: { taskType: 'scout', complexity: 'medium' } },
        },
      ],
      edges: [{ id: 'e1', source: 'castor_plan', target: 'john_scout' }],
      execution: {
        maxParallelTasks: 1,
        leaseSeconds: 120,
        defaultMaxAttempts: 3,
        defaultBackoffMs: 1000,
        maxBackoffMs: 30000,
        requireVerification: true,
        stopOnFailure: true,
      },
      approvals: [],
      modelPreferences: { defaultPolicy: { taskType: 'scout' }, fallbackEnabled: true },
      budget: { maxTotalCostUsd: 5, maxModelCalls: 200 },
      acceptanceCriteria: [],
    };

    const tasks = materializeTasks(definition, { objective: 'Evaluate the ZESCODE/zes-builder repository' });

    for (const task of tasks) {
      expect(task.input.userObjective).toBe('Evaluate the ZESCODE/zes-builder repository');
      expect(task.objective).toContain('Evaluate the ZESCODE/zes-builder repository');
    }
  });
});
