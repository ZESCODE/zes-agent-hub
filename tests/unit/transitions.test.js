import { describe, expect, it } from 'vitest';
import { InvalidTransitionError, allowedTransitions, assertTransition, canTransition } from '../../server/lib/workflows/transitions.js';

describe('workflow state machine', () => {
  it('allows the documented happy path', () => {
    const path = [
      ['requested', 'planning'],
      ['planning', 'scouting'],
      ['scouting', 'scouted'],
      ['scouted', 'forking'],
      ['forking', 'forked'],
      ['forked', 'rebranding'],
      ['rebranding', 'reviewing'],
      ['reviewing', 'building'],
      ['building', 'deploying'],
      ['deploying', 'verifying'],
      ['verifying', 'verified'],
      ['verified', 'whop_drafting'],
      ['whop_drafting', 'completed'],
    ];

    for (const [from, to] of path) {
      expect(canTransition('job', from, to)).toBe(true);
    }
  });

  it('rejects invalid transitions', () => {
    expect(() => assertTransition('job', 'requested', 'deploying')).toThrow(InvalidTransitionError);
    expect(() => assertTransition('job', 'completed', 'building')).toThrow(InvalidTransitionError);
    expect(() => assertTransition('task', 'pending', 'completed')).toThrow(InvalidTransitionError);
  });

  it('keeps terminal states terminal', () => {
    expect(allowedTransitions('job', 'completed')).toEqual([]);
    expect(allowedTransitions('job', 'cancelled')).toEqual([]);
    expect(allowedTransitions('task', 'completed')).toEqual([]);
  });

  it('allows a failed task to be retried', () => {
    expect(canTransition('task', 'failed', 'pending')).toBe(true);
    expect(canTransition('task', 'pending', 'running')).toBe(true);
    expect(canTransition('task', 'running', 'completed')).toBe(true);
  });
});
