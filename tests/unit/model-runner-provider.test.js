import { afterEach, describe, expect, it, vi } from 'vitest';

const pollinationsGenChat = vi.fn();
const apinexGateGenChat = vi.fn();

vi.mock('../../server/pollinations-client.js', () => ({
  pollinationsGenChat: (...args) => pollinationsGenChat(...args),
  pollinationsListModels: vi.fn(),
}));

vi.mock('../../server/apinexgate-client.js', () => ({
  apinexGateGenChat: (...args) => apinexGateGenChat(...args),
  apinexGateListModels: vi.fn(),
  apinexGateBalance: vi.fn(),
  isApinexGateConfigured: () => true,
}));

const { runTaskWithModel } = await import('../../server/lib/orchestrator/model-runner.js');

const AGENT = { id: 'john', name: 'John', role: 'research' };
const TASK = {
  objective: 'Summarise the repository',
  expected_outputs: ['summary'],
  acceptance_criteria: ['mentions the repository'],
  input: {},
};

function completion(content = '{"summary":"ok","outputs":["a"],"issues":[],"evidence":["e"]}') {
  return { content, model: 'model-a', tokens: 100, inputTokens: 70, outputTokens: 30 };
}

describe('model runner provider dispatch', () => {
  afterEach(() => {
    pollinationsGenChat.mockReset();
    apinexGateGenChat.mockReset();
  });

  it('calls the routed provider', async () => {
    apinexGateGenChat.mockResolvedValue(completion());

    const outcome = await runTaskWithModel({
      agent: AGENT,
      task: TASK,
      route: {
        provider: 'apinexgate',
        model: 'model-a',
        fallbackProvider: 'pollinations',
        fallbackModel: 'openai/gpt-5.4-nano',
      },
    });

    expect(apinexGateGenChat).toHaveBeenCalledTimes(1);
    expect(pollinationsGenChat).not.toHaveBeenCalled();
    expect(outcome.provider).toBe('apinexgate');
    expect(outcome.model).toBe('model-a');
    expect(outcome.result.status).toBe('completed');
    expect(outcome.inputTokens).toBe(70);
    expect(outcome.outputTokens).toBe(30);
  });

  it('falls back to the fallback provider when the routed provider fails', async () => {
    apinexGateGenChat.mockRejectedValue(new Error('APInexGate error: 503 no capacity'));
    pollinationsGenChat.mockResolvedValue({ ...completion(), model: 'openai/gpt-5.4-nano' });

    const outcome = await runTaskWithModel({
      agent: AGENT,
      task: TASK,
      route: {
        provider: 'apinexgate',
        model: 'model-a',
        fallbackProvider: 'pollinations',
        fallbackModel: 'openai/gpt-5.4-nano',
      },
    });

    expect(apinexGateGenChat).toHaveBeenCalledTimes(1);
    expect(pollinationsGenChat).toHaveBeenCalledTimes(1);
    expect(pollinationsGenChat.mock.calls[0][0]).toBe('openai/gpt-5.4-nano');
    expect(outcome.provider).toBe('pollinations');
    expect(outcome.model).toBe('openai/gpt-5.4-nano');
    expect(outcome.fallback).toBe(true);
    expect(outcome.fallbackReason).toContain('503');
  });

  it('fails the task when no fallback provider is available', async () => {
    apinexGateGenChat.mockRejectedValue(new Error('APInexGate error: 401 invalid key'));

    await expect(
      runTaskWithModel({
        agent: AGENT,
        task: TASK,
        route: { provider: 'apinexgate', model: 'model-a', fallbackProvider: 'apinexgate' },
      }),
    ).rejects.toThrow('invalid key');
  });

  it('does not call a fallback when the routed provider is the default one', async () => {
    pollinationsGenChat.mockResolvedValue(completion());

    const outcome = await runTaskWithModel({
      agent: AGENT,
      task: TASK,
      route: {
        provider: 'pollinations',
        model: 'openai/gpt-6-astra',
        fallbackProvider: 'pollinations',
        fallbackModel: 'openai/gpt-5.4-nano',
      },
    });

    expect(pollinationsGenChat).toHaveBeenCalledTimes(1);
    expect(outcome.fallback).toBe(false);
    expect(outcome.provider).toBe('pollinations');
  });
});
