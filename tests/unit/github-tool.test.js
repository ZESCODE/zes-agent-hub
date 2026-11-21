import { describe, expect, it } from 'vitest';

import { createToolRegistry } from '../../server/lib/tools/registry.js';

describe('github tool', () => {
  it('returns the repository listing next to its metadata', async () => {
    const tools = createToolRegistry({
      logger: () => {},
      agentPermissions: (agentId) =>
        agentId === 'john' ? ['model.generate', 'github.repository.read'] : [],
    });

    const result = await tools.execute({
      toolName: 'github.repository.read',
      agentId: 'john',
      jobId: 'job-1',
      taskId: 'task-1',
      parameters: { owner: 'ZESCODE', repo: 'zes-builder' },
      idempotencyKey: 'job-1:task-1:github.repository.read',
    });

    expect(result.name).toBe('ZESCODE/zes-builder');
    expect(Array.isArray(result.files)).toBe(true);
    expect(result.files.length).toBeGreaterThan(0);
    expect(result.files[0]).toHaveProperty('name');
  });
});
