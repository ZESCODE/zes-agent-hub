import { describe, expect, it } from 'vitest';

import { apinexGateBalance, apinexGateGenChat, apinexGateListModels } from '../../server/apinexgate-client.js';
import { routeFor } from '../../server/lib/providers/router.js';
import { runTaskWithModel } from '../../server/lib/orchestrator/model-runner.js';

const baseUrl = process.env.APINEXGATE_BASE_URL;
const apiKey = process.env.APINEXGATE_API_KEY;
const configured = Boolean(baseUrl && apiKey);

const GATEWAY_ERROR_CODES = [
  'apinexgate_unavailable',
  'apinexgate_error',
  'apinexgate_auth',
  'apinexgate_rate_limited',
  'apinexgate_forbidden',
];

describe.skipIf(!configured)('apinexgate provider against a live gateway', () => {
  it('lists the gateway catalogue', async () => {
    const models = await apinexGateListModels();

    expect(Array.isArray(models)).toBe(true);
    expect(models.length).toBeGreaterThan(0);
    expect(typeof models[0].id).toBe('string');
  });

  it('reads the customer balance', async () => {
    const balance = await apinexGateBalance();

    expect(balance).toHaveProperty('balance_usd');
  });

  it('calls the gateway and surfaces its answer or a mapped gateway error', async () => {
    const models = await apinexGateListModels();

    let response = null;
    let failure = null;

    try {
      response = await apinexGateGenChat(models[0].id, [{ role: 'user', content: 'ping' }], { maxTokens: 16 });
    } catch (error) {
      failure = error;
    }

    if (response) {
      expect(typeof response.content).toBe('string');
    } else {
      // A gateway without a valid upstream key answers 503; the adapter must
      // surface that as a gateway error, not as an unhandled crash.
      expect(failure.message).toMatch(/APInexGate error/);
      expect(GATEWAY_ERROR_CODES).toContain(failure.code);
    }
  });

  it('routes a seat to the gateway and keeps the pollinations fallback in the route', async () => {
    const models = await apinexGateListModels();
    const route = routeFor({ taskType: 'scout', provider: 'apinexgate', model: models[0].id });

    expect(route.provider).toBe('apinexgate');
    expect(route.model).toBe(models[0].id);
    expect(route.fallbackProvider).toBe('pollinations');

    let outcome = null;
    let failure = null;

    try {
      outcome = await runTaskWithModel({
        agent: { id: 'john', name: 'John', role: 'research' },
        task: { objective: 'Answer with JSON only', expected_outputs: [], acceptance_criteria: [], input: {} },
        // The fallback is pinned to the gateway so the test never spends a
        // Pollinations call; the fallback itself is covered by the unit tests.
        route: { ...route, fallbackProvider: 'apinexgate' },
        timeoutMs: 30_000,
      });
    } catch (error) {
      failure = error;
    }

    if (outcome) {
      expect(outcome.provider).toBe('apinexgate');
      expect(outcome.result.status).toBe('completed');
    } else {
      expect(failure.message).toMatch(/APInexGate error/);
      expect(GATEWAY_ERROR_CODES).toContain(failure.code);
    }
  });

  it('maps an invalid customer key to an authentication error', async () => {
    await expect(
      apinexGateGenChat('any-model', [{ role: 'user', content: 'ping' }], { apiKey: 'sk-invalid-key' }),
    ).rejects.toThrow(/APInexGate error/);
  });
});
