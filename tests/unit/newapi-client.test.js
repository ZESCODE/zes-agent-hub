import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fetchMock = vi.fn();

vi.mock('node-fetch', () => ({
  default: (...args) => fetchMock(...args),
}));

const {
  isNewApiConfigured,
  newApiBaseUrl,
  newApiDefaultModel,
  newApiGenChat,
  newApiHealth,
  newApiListModels,
} = await import('../../server/newapi-client.js');

function jsonResponse(body, { status = 200, headers = {} } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    body: null,
  };
}

describe('newapi client', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubEnv('NEW_API_BASE_URL', 'https://gateway.test/v1/');
    vi.stubEnv('NEW_API_API_KEY', 'sk-gateway-token');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('reads the base url without a trailing slash', () => {
    expect(newApiBaseUrl()).toBe('https://gateway.test/v1');
  });

  it('reports whether the provider is configured', () => {
    expect(isNewApiConfigured()).toBe(true);
    vi.stubEnv('NEW_API_API_KEY', '');
    expect(isNewApiConfigured()).toBe(false);
  });

  it('reads the configured default model', () => {
    vi.stubEnv('NEW_API_DEFAULT_MODEL', ' gateway-model ');
    expect(newApiDefaultModel()).toBe('gateway-model');
  });

  it('refuses to call without a gateway token', async () => {
    vi.stubEnv('NEW_API_API_KEY', '');

    await expect(newApiGenChat('model-a', [{ role: 'user', content: 'hi' }])).rejects.toMatchObject({
      code: 'newapi_not_configured',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses to call without a model id', async () => {
    await expect(newApiGenChat('', [{ role: 'user', content: 'hi' }])).rejects.toMatchObject({
      code: 'newapi_model_required',
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

    const result = await newApiGenChat('model-a', [{ role: 'user', content: 'hi' }], { maxTokens: 200, temperature: 0.3 });

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('https://gateway.test/v1/chat/completions');
    expect(options.method).toBe('POST');
    expect(options.headers.Authorization).toBe('Bearer sk-gateway-token');
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

  it('forwards tool definitions and reads tool calls back', async () => {
    const tools = [
      {
        type: 'function',
        function: { name: 'get_weather', parameters: { type: 'object', properties: { city: { type: 'string' } } } },
      },
    ];

    fetchMock.mockResolvedValue(
      jsonResponse({
        model: 'model-a',
        choices: [
          {
            message: {
              content: '',
              tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'get_weather', arguments: '{"city":"Paris"}' } }],
            },
          },
        ],
        usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
      }),
    );

    const result = await newApiGenChat('model-a', [{ role: 'user', content: 'weather?' }], { tools });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.tools).toEqual(tools);
    expect(body.tool_choice).toBe('auto');
    expect(result.toolCalls[0].function.name).toBe('get_weather');
  });

  it('maps an authentication failure', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: 'invalid token' }, { status: 401 }));

    await expect(newApiGenChat('model-a', [{ role: 'user', content: 'hi' }])).rejects.toMatchObject({
      code: 'newapi_auth',
      status: 401,
    });
  });

  it('maps a rate limit', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: 'rate limited' }, { status: 429 }));

    await expect(newApiGenChat('model-a', [{ role: 'user', content: 'hi' }], { maxRetries: 0 })).rejects.toMatchObject({
      code: 'newapi_rate_limited',
    });
  });

  it('maps an upstream failure', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: 'no capacity' }, { status: 503 }));

    await expect(newApiGenChat('model-a', [{ role: 'user', content: 'hi' }], { maxRetries: 0 })).rejects.toMatchObject({
      code: 'newapi_unavailable',
      status: 503,
    });
  });

  it('maps a missing channel to a model error', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ error: { message: 'No available channel for model model-a under group default' } }, { status: 503 }),
    );

    await expect(newApiGenChat('model-a', [{ role: 'user', content: 'hi' }], { maxRetries: 0 })).rejects.toMatchObject({
      code: 'newapi_model_unavailable',
    });
  });

  it('retries a rate limited request and succeeds', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ error: 'rate limited' }, { status: 429, headers: { 'retry-after': '0' } }))
      .mockResolvedValueOnce(jsonResponse({ model: 'model-a', choices: [{ message: { content: 'ok' } }], usage: { total_tokens: 3 } }));

    const result = await newApiGenChat('model-a', [{ role: 'user', content: 'hi' }], { maxRetries: 1 });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.content).toBe('ok');
  });

  it('never retries an authentication failure', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: 'invalid token' }, { status: 401 }));

    await expect(newApiGenChat('model-a', [{ role: 'user', content: 'hi' }], { maxRetries: 2 })).rejects.toMatchObject({
      code: 'newapi_auth',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('keeps the token out of the error message', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: 'invalid token' }, { status: 401 }));

    await expect(newApiGenChat('model-a', [{ role: 'user', content: 'hi' }])).rejects.toThrow(
      expect.not.stringContaining('sk-gateway-token'),
    );
  });

  it('lists the gateway catalogue', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: [{ id: 'model-a' }, { id: 'model-b' }] }));

    const models = await newApiListModels();

    expect(fetchMock.mock.calls[0][0]).toBe('https://gateway.test/v1/models');
    expect(models.map((model) => model.id)).toEqual(['model-a', 'model-b']);
  });

  it('reports health when the gateway answers', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: [{ id: 'model-a' }] }));

    const health = await newApiHealth();

    expect(health.ok).toBe(true);
    expect(health.status).toBe(200);
    expect(health.modelCount).toBe(1);
  });

  it('reports health as failed when the gateway rejects the token', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: 'invalid token' }, { status: 401 }));

    const health = await newApiHealth();

    expect(health.ok).toBe(false);
    expect(health.status).toBe(401);
    expect(health.error).toBe('newapi_auth');
  });
});
