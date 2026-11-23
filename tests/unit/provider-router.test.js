import { afterEach, describe, expect, it, vi } from 'vitest';

import { routeFor, knownTaskTypes } from '../../server/lib/providers/router.js';
import {
  costPerMillionTokens,
  defaultModelFor,
  getProvider,
  isKnownProvider,
  providerCatalog,
  providerIds,
} from '../../server/lib/providers/registry.js';

describe('provider registry', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('exposes the gateway, pollinations and apinexgate', () => {
    expect(providerIds().sort()).toEqual(['apinexgate', 'newapi', 'pollinations']);
  });

  it('routes through the ZESCODE gateway by default', () => {
    expect(getProvider('nope').id).toBe('newapi');
  });

  it('knows which providers are configured', () => {
    vi.stubEnv('NEW_API_API_KEY', 'sk-gateway');
    vi.stubEnv('POLLINATIONS_API_KEY', 'sk-p');
    vi.stubEnv('APINEXGATE_API_KEY', '');

    const catalog = providerCatalog();
    const gateway = catalog.find((entry) => entry.id === 'newapi');
    const pollinations = catalog.find((entry) => entry.id === 'pollinations');
    const apinexgate = catalog.find((entry) => entry.id === 'apinexgate');

    expect(gateway.configured).toBe(true);
    expect(gateway.envKeys).toContain('NEW_API_API_KEY');
    expect(pollinations.configured).toBe(true);
    expect(apinexgate.configured).toBe(false);
    expect(apinexgate.envKeys).toContain('APINEXGATE_API_KEY');
  });

  it('falls back to the default provider for an unknown id', () => {
    expect(isKnownProvider('nope')).toBe(false);
    expect(getProvider('nope').id).toBe('newapi');
  });

  it('reads the default model per provider', () => {
    vi.stubEnv('NEW_API_DEFAULT_MODEL', 'gateway-default');
    vi.stubEnv('APINEXGATE_DEFAULT_MODEL', 'reseller-default');

    expect(defaultModelFor('newapi')).toBe('gateway-default');
    expect(defaultModelFor('apinexgate')).toBe('reseller-default');
    expect(defaultModelFor('pollinations')).toBe('');
  });

  it('keeps the cost rate of each provider separate', () => {
    vi.stubEnv('NEW_API_COST_PER_MILLION_TOKENS', '1.5');
    vi.stubEnv('APINEXGATE_COST_PER_MILLION_TOKENS', '2.5');
    vi.stubEnv('POLLINATIONS_COST_PER_MILLION_TOKENS', '0.25');

    expect(costPerMillionTokens('newapi')).toBe(1.5);
    expect(costPerMillionTokens('apinexgate')).toBe(2.5);
    expect(costPerMillionTokens('pollinations')).toBe(0.25);
  });
});

describe('router', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('keeps the default route on the gateway', () => {
    const route = routeFor({ taskType: 'scout' });

    expect(route.provider).toBe('newapi');
    expect(route.model).toBe('gpt-6.2-astra');
    expect(route.fallbackProvider).toBeNull();
    expect(route.fallbackModel).toBeNull();
  });

  it('uses the gateway default model when one is configured', () => {
    vi.stubEnv('NEW_API_DEFAULT_MODEL', 'gateway-default');

    const route = routeFor({ taskType: 'scout' });

    expect(route.provider).toBe('newapi');
    expect(route.model).toBe('gateway-default');
  });

  it('keeps the default route for an unknown task type', () => {
    const route = routeFor({ taskType: 'not-a-task' });

    expect(route.provider).toBe('newapi');
    expect(route.model).toBe('deepseek-v4.1-flash');
  });

  it('routes to apinexgate when a seat asks for it', () => {
    const route = routeFor({ taskType: 'scout', provider: 'apinexgate', model: 'claude-fable-5.1' });

    expect(route.provider).toBe('apinexgate');
    expect(route.model).toBe('claude-fable-5.1');
    expect(route.fallbackProvider).toBeNull();
  });

  it('uses the configured default model for apinexgate when no model is given', () => {
    vi.stubEnv('APINEXGATE_DEFAULT_MODEL', 'gateway-default');

    const route = routeFor({ taskType: 'scout', provider: 'apinexgate' });

    expect(route.model).toBe('gateway-default');
  });

  it('never falls back to another provider without an explicit request', () => {
    const route = routeFor({ taskType: 'scout', provider: 'newapi' });

    expect(route.fallbackProvider).toBeNull();
  });

  it('keeps an explicit fallback provider', () => {
    vi.stubEnv('POLLINATIONS_DEFAULT_MODEL', 'pollinations-default');

    const route = routeFor({ taskType: 'scout', fallbackProvider: 'pollinations' });

    expect(route.fallbackProvider).toBe('pollinations');
    expect(route.fallbackModel).toBe('pollinations-default');
  });

  it('ignores an unknown provider instead of breaking the route', () => {
    const route = routeFor({ taskType: 'scout', provider: 'not-a-provider' });

    expect(route.provider).toBe('newapi');
    expect(route.model).toBe('gpt-6.2-astra');
  });

  it('keeps the task type list stable', () => {
    expect(knownTaskTypes()).toContain('scout');
    expect(knownTaskTypes()).toContain('verification');
  });
});
