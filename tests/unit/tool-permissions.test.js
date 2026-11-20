import { describe, expect, it } from 'vitest';

import { createToolRegistry } from '../../server/lib/tools/registry.js';

const AGENT_PERMISSIONS = {
  john: ['model.generate', 'github.repository.read'],
  labu: ['model.generate', 'deployment.preview'],
};

function registry(overrides = {}) {
  return createToolRegistry({
    agentPermissions: (agentId) => AGENT_PERMISSIONS[agentId] || [],
    ...overrides,
  });
}

describe('tool permissions', () => {
  it('allows a tool when the agent holds every required permission', async () => {
    const tools = registry();

    await expect(
      tools.execute({
        toolName: 'github.repository.read',
        agentId: 'john',
        jobId: 'job-1',
        taskId: 'task-1',
        parameters: { owner: 'ZESCODE', repo: 'zes-builder' },
        idempotencyKey: 'job-1:task-1:github.repository.read',
      }),
    ).rejects.toThrow(/GITHUB_TOKEN|not configured/i);
  });

  it('denies a tool when the agent misses a permission', async () => {
    const tools = registry();

    await expect(
      tools.execute({
        toolName: 'deployment.preview',
        agentId: 'john',
        jobId: 'job-1',
        taskId: 'task-2',
        parameters: { title: 'Test', niche: 'coffee' },
        idempotencyKey: 'job-1:task-2:deployment.preview',
      }),
    ).rejects.toMatchObject({ name: 'ToolPermissionError' });
  });

  it('denies every mutating tool until publishing is granted explicitly', async () => {
    const tools = registry();

    await expect(
      tools.execute({
        toolName: 'deployment.publish',
        agentId: 'labu',
        jobId: 'job-1',
        taskId: 'task-3',
        parameters: { title: 'Test', niche: 'coffee' },
        idempotencyKey: 'job-1:task-3:deployment.publish',
      }),
    ).rejects.toThrow(/not enabled|not allowed/i);
  });

  it('keeps publishing denied until an operator grants the permission', () => {
    process.env.AGORA_ENABLE_MUTATING_TOOLS = 'true';
    process.env.AGORA_TOOL_PERMISSION_GRANTS = JSON.stringify({ labu: ['deployment.publish'] });

    try {
      const tools = registry();

      expect(tools.canUse('deployment.publish', 'labu')).toEqual({
        allowed: true,
        reason: null,
        missing: [],
      });

      expect(tools.canUse('deployment.publish', 'verifier')).toMatchObject({
        allowed: false,
        reason: 'permission_denied',
        missing: ['deployment.preview', 'deployment.publish'],
      });
    } finally {
      delete process.env.AGORA_ENABLE_MUTATING_TOOLS;
      delete process.env.AGORA_TOOL_PERMISSION_GRANTS;
    }
  });

  it('keeps mutating tools disabled by default', () => {
    const tools = registry();

    expect(tools.canUse('deployment.publish', 'labu')).toMatchObject({ allowed: false, reason: 'disabled' });
    expect(tools.canUse('github.repository.write', 'john')).toMatchObject({ allowed: false, reason: 'disabled' });
  });
});
