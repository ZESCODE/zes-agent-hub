import { describe, expect, it } from 'vitest';

import {
  ConditionEvaluationError,
  conditionContext,
  evaluateCondition,
} from '../../server/lib/workflows/conditions.js';

const context = {
  inputs: { ok: true, count: 3, licence: 'MIT', nested: { state: 'ready' } },
  nodes: { john_1: { status: 'completed' }, castor_1: { status: 'failed' } },
  job: { id: 'job-1', status: 'scouting' },
};

describe('evaluateCondition', () => {
  it('compares literals', () => {
    expect(evaluateCondition("inputs.licence === 'MIT'", context)).toBe(true);
    expect(evaluateCondition("inputs.licence === 'GPL'", context)).toBe(false);
    expect(evaluateCondition('inputs.count > 2', context)).toBe(true);
    expect(evaluateCondition('inputs.count <= 2', context)).toBe(false);
  });

  it('reads nested paths', () => {
    expect(evaluateCondition("inputs.nested.state === 'ready'", context)).toBe(true);
  });

  it('supports booleans and negation', () => {
    expect(evaluateCondition('inputs.ok === true', context)).toBe(true);
    expect(evaluateCondition('inputs.ok', context)).toBe(true);
    expect(evaluateCondition('!inputs.ok', context)).toBe(false);
    expect(evaluateCondition('inputs.missing === null', context)).toBe(true);
  });

  it('supports && and || with grouping', () => {
    expect(evaluateCondition("inputs.ok && nodes.john_1.status === 'completed'", context)).toBe(true);
    expect(evaluateCondition("nodes.castor_1.status === 'completed' || inputs.ok", context)).toBe(true);
    expect(evaluateCondition("(inputs.ok && nodes.castor_1.status === 'completed')", context)).toBe(false);
  });

  it('rejects unknown context prefixes', () => {
    expect(() => evaluateCondition('process.env.SECRET === "x"', context)).toThrow(ConditionEvaluationError);
    expect(() => evaluateCondition('globalThis.x', context)).toThrow(ConditionEvaluationError);
  });

  it('rejects function calls and empty expressions', () => {
    expect(() => evaluateCondition('inputs.ok()', context)).toThrow(ConditionEvaluationError);
    expect(() => evaluateCondition('   ', context)).toThrow(ConditionEvaluationError);
  });

  it('builds a context from task results', () => {
    const built = conditionContext({
      job: { id: 'job-1', status: 'scouting', title: 't' },
      tasks: [
        {
          node_id: 'john_1',
          status: 'completed',
          task_type: 'scout',
          assigned_agent: 'john',
          result: { ok: true, licence: 'MIT' },
        },
      ],
    });

    expect(built.inputs.licence).toBe('MIT');
    expect(built.nodes.john_1.status).toBe('completed');
    expect(built.job.id).toBe('job-1');
  });
});
