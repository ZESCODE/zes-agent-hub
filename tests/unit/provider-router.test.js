import { afterEach, describe, expect, it, vi } from 'vitest';

import { routeFor, knownTaskTypes } from '../../server/lib/providers/router.js';
import { getProvider, isKnownProvider, providerCatalog, providerIds } from '../../server/lib/providers/registry.js';

describe('provider registry', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('exposes pollinations and apinexgate', () => {
    expect(providerIds().sort()).toEqual(['apinexgate', 'pollinations']);
  });

  it('knows which providers are configured', () => {
    vi.stubEnv('POLLINATIONS_API_KEY', 'sk-p');
    vi.stubEnv('APINEXGATE_API_KEY', '');

    const catalog = providerCatalog();
    const pollinations = catalog.find((entry) => entry.id === 'pollinations');
    const apinexgate = catalog.find((entry) => entry.id === 'apinexgate');

    expect(pollinations.configured).toBe(true);
    expect(apinexgate.configured).toBe(false);
    expect(apinexgate.envKeys).toContain('APINEXGATE_API_KEY');
  });

  it('falls back to the default provider for an unknown id', () => {
    expect(isKnownProvider('nope')).toBe(false);
    expect(getProvider('nope').id).toBe('pollinations');
  });
});

describe('router', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('keeps the default route on pollinations', () => {
    const route = routeFor({ taskType: 'scout' });

    expect(route.provider).toBe('pollinations');
    expect(route.model).toBe('openai/gpt-6-astra');
    expect(route.fallbackProvider).toBe('pollinations');
    expect(route.fallbackModel).toBe('openai/gpt-5.4-nano');
  });

  it('keeps the default route for an unknown task type', () => {
    const route = routeFor({ taskType: 'not-a-task' });

    expect(route.provider).toBe('pollinations');
    expect(route.model).toBe('openai/gpt-5.4-nano');
  });

  it('routes to apinexgate when a seat asks for it', () => {
    const route = routeFor({ taskType: 'scout', provider: 'apinexgate', model: 'claude-fable-5.1' });

    expect(route.provider).toBe('apinexgate');
    expect(route.model).toBe('claude-fable-5.1');
    expect(route.fallbackProvider).toBe('pollinations');
  });

  it('uses the configured default model for apinexgate when no model is given', () => {
    vi.stubEnv('APINEXGATE_DEFAULT_MODEL', 'gateway-default');

    const route = routeFor({ taskType: 'scout', provider: 'apinexgate' });

    expect(route.model).toBe('gateway-default');
  });

  it('ignores an unknown provider instead of breaking the route', () => {
    const route = routeFor({ taskType: 'scout', provider: 'not-a-provider' });

    expect(route.provider).toBe('pollinations');
    expect(route.model).toBe('openai/gpt-6-astra');
  });

  it('keeps the task type list stable', () => {
    expect(knownTaskTypes()).toContain('scout');
    expect(knownTaskTypes()).toContain('verification');
  });
});
