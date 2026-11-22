import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fetchMock = vi.fn();

vi.mock('node-fetch', () => ({
  default: (...args) => fetchMock(...args),
}));

const {
  apinexGateBaseUrl,
  apinexGateBalance,
  apinexGateGenChat,
  apinexGateListModels,
  isApinexGateConfigured,
} = await import('../../server/apinexgate-client.js');

function jsonResponse(body, { status = 200, headers = {} } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  };
}

describe('apinexgate client', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubEnv('APINEXGATE_BASE_URL', 'http://gateway.test/v1/');
    vi.stubEnv('APINEXGATE_API_KEY', 'sk-customer-key');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('reads the base url without a trailing slash', () => {
    expect(apinexGateBaseUrl()).toBe('http://gateway.test/v1');
  });

  it('reports whether the provider is configured', () => {
    expect(isApinexGateConfigured()).toBe(true);
    vi.stubEnv('APINEXGATE_API_KEY', '');
    expect(isApinexGateConfigured()).toBe(false);
  });

  it('refuses to call without a customer key', async () => {
    vi.stubEnv('APINEXGATE_API_KEY', '');

    await expect(apinexGateGenChat('model-a', [{ role: 'user', content: 'hi' }])).rejects.toMatchObject({
      code: 'apinexgate_not_configured',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses to call without a model id', async () => {
    await expect(apinexGateGenChat('', [{ role: 'user', content: 'hi' }])).rejects.toMatchObject({
      code: 'apinexgate_model_required',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends an OpenAI compatible chat request', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        model: 'model-a',
        choices: [{ message: { content: 'hello there' } }],
        usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 },
      }),
    );

    const result = await apinexGateGenChat('model-a', [{ role: 'user', content: 'hi' }], { maxTokens: 200, temperature: 0.3 });

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('http://gateway.test/v1/chat/completions');
    expect(options.method).toBe('POST');
    expect(options.headers.Authorization).toBe('Bearer sk-customer-key');
    expect(JSON.parse(options.body)).toEqual({
      model: 'model-a',
      messages: [{ role: 'user', content: 'hi' }],
      temperature: 0.3,
      max_tokens: 200,
      stream: false,
    });

    expect(result.content).toBe('hello there');
    expect(result.model).toBe('model-a');
    expect(result.tokens).toBe(18);
    expect(result.inputTokens).toBe(11);
    expect(result.outputTokens).toBe(7);
  });

  it('maps gateway status codes to error codes', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: 'no capacity' }, { status: 503 }));

    await expect(apinexGateGenChat('model-a', [{ role: 'user', content: 'hi' }])).rejects.toMatchObject({
      code: 'apinexgate_unavailable',
      status: 503,
    });
  });

  it('maps an authentication failure', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: 'invalid key' }, { status: 401 }));

    await expect(apinexGateGenChat('model-a', [{ role: 'user', content: 'hi' }])).rejects.toMatchObject({
      code: 'apinexgate_auth',
    });
  });

  it('lists the gateway catalogue', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: [{ id: 'model-a' }, { id: 'model-b' }] }));

    const models = await apinexGateListModels();

    expect(fetchMock.mock.calls[0][0]).toBe('http://gateway.test/v1/models');
    expect(models.map((model) => model.id)).toEqual(['model-a', 'model-b']);
  });

  it('reads the customer balance', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ object: 'balance', balance_usd: 1.5 }));

    const balance = await apinexGateBalance();

    expect(fetchMock.mock.calls[0][0]).toBe('http://gateway.test/v1/balance');
    expect(balance.balance_usd).toBe(1.5);
  });
});
