// zes-agent-hub — ZESCODE API gateway client (new-api)
// The hub talks to the ZESCODE gateway through its OpenAI-compatible surface.
// The gateway owns routing across its upstream channels (Pollinations, APInex,
// Kilo, NVIDIA), keeps the billing trail and the audit log. The hub holds one
// gateway token and never sees an upstream key.
//
// The gateway is the hub's default provider. APInexGate stays a separate,
// optional reseller gateway and is never reached through this client.

import fetch from 'node-fetch';

const decoder = new TextDecoder();
const DEFAULT_BASE_URL = 'https://api.zes.codes/v1';
const DEFAULT_TIMEOUT_MS = 180_000;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_RETRY_DELAY_MS = 500;
const MAX_RETRY_DELAY_MS = 5_000;
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

export function newApiBaseUrl() {
  const configured = (process.env.NEW_API_BASE_URL || DEFAULT_BASE_URL).trim();
  return configured.replace(/\/+$/, '');
}

export function newApiApiKey() {
  return (process.env.NEW_API_API_KEY || '').trim();
}

export function newApiDefaultModel() {
  return (process.env.NEW_API_DEFAULT_MODEL || '').trim();
}

export function isNewApiConfigured() {
  return Boolean(newApiApiKey());
}

/**
 * Generate text through a gateway model.
 * @param {string} model - Gateway model id, as listed by GET /v1/models
 * @param {Array<Object>} messages - OpenAI-style messages
 * @param {Object} options - maxTokens, temperature, timeoutMs, maxRetries, tools, toolChoice
 * @returns {Promise<{content: string, model: string, tokens: number, inputTokens: number|null,
 *                    outputTokens: number|null, toolCalls: Array<Object>}>}
 */
export async function newApiGenChat(model, messages, options = {}) {
  const apiKey = (options.apiKey || newApiApiKey()).trim();

  if (!apiKey) {
    const error = new Error('ZESCODE API is not configured: set NEW_API_API_KEY');
    error.code = 'newapi_not_configured';
    throw error;
  }

  if (!model) {
    const error = new Error('ZESCODE API requires a model id');
    error.code = 'newapi_model_required';
    throw error;
  }

  const payload = {
    model,
    messages,
    temperature: options.temperature ?? 0.2,
    max_tokens: options.maxTokens || 1024,
    stream: false,
  };

  if (Array.isArray(options.tools) && options.tools.length > 0) {
    payload.tools = options.tools;
    payload.tool_choice = options.toolChoice || 'auto';
  }

  const data = await requestWithRetries(
    `${newApiBaseUrl()}/chat/completions`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
    },
    {
      timeoutMs: options.timeoutMs || DEFAULT_TIMEOUT_MS,
      maxRetries: options.maxRetries ?? DEFAULT_MAX_RETRIES,
      retryDelayMs: options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS,
    },
  );

  const content = data.choices?.[0]?.message?.content || '';
  const inputTokens = data.usage?.prompt_tokens ?? null;
  const outputTokens = data.usage?.completion_tokens ?? null;
  const tokens = data.usage?.total_tokens ?? (inputTokens || outputTokens ? inputTokens + outputTokens : 0);

  return {
    content,
    model: data.model || model,
    tokens,
    inputTokens,
    outputTokens,
    toolCalls: Array.isArray(data.choices?.[0]?.message?.tool_calls) ? data.choices[0].message.tool_calls : [],
  };
}

/**
 * Stream a completion through the gateway. Chunks are handed to onChunk as
 * they arrive; the aggregated text is returned at the end.
 * @returns {Promise<{content: string, model: string, tokens: number, inputTokens: number|null,
 *                    outputTokens: number|null}>}
 */
export async function newApiGenChatStream(model, messages, options = {}) {
  const apiKey = (options.apiKey || newApiApiKey()).trim();

  if (!apiKey) {
    const error = new Error('ZESCODE API is not configured: set NEW_API_API_KEY');
    error.code = 'newapi_not_configured';
    throw error;
  }

  if (!model) {
    const error = new Error('ZESCODE API requires a model id');
    error.code = 'newapi_model_required';
    throw error;
  }

  const response = await fetchWithTimeout(
    `${newApiBaseUrl()}/chat/completions`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        Accept: 'text/event-stream',
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: options.temperature ?? 0.2,
        max_tokens: options.maxTokens || 1024,
        stream: true,
      }),
    },
    options.timeoutMs || DEFAULT_TIMEOUT_MS,
  );

  if (!response.ok) {
    throw await gatewayError(response);
  }

  let content = '';
  let streamModel = model;
  let usage = null;
  let buffer = '';

  for await (const chunk of response.body) {
    buffer += decoder.decode(chunk, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();

      if (!trimmed.startsWith('data:')) {
        continue;
      }

      const data = trimmed.slice(5).trim();

      if (!data || data === '[DONE]') {
        continue;
      }

      let parsed;

      try {
        parsed = JSON.parse(data);
      } catch {
        continue;
      }

      if (parsed.model) {
        streamModel = parsed.model;
      }

      if (parsed.usage) {
        usage = parsed.usage;
      }

      const delta = parsed.choices?.[0]?.delta?.content || '';
      content += delta;

      if (delta && typeof options.onChunk === 'function') {
        options.onChunk(delta);
      }
    }
  }

  const inputTokens = usage?.prompt_tokens ?? null;
  const outputTokens = usage?.completion_tokens ?? null;
  const tokens = usage?.total_tokens ?? (inputTokens || outputTokens ? inputTokens + outputTokens : 0);

  return {
    content,
    model: streamModel,
    tokens,
    inputTokens,
    outputTokens,
    toolCalls: [],
  };
}

/**
 * List the models the gateway exposes to this token.
 * @returns {Promise<Array<{id: string}>>}
 */
export async function newApiListModels(options = {}) {
  const apiKey = (options.apiKey || newApiApiKey()).trim();

  if (!apiKey) {
    const error = new Error('ZESCODE API is not configured: set NEW_API_API_KEY');
    error.code = 'newapi_not_configured';
    throw error;
  }

  const response = await fetchWithTimeout(
    `${newApiBaseUrl()}/models`,
    { headers: { Authorization: `Bearer ${apiKey}` } },
    options.timeoutMs || DEFAULT_TIMEOUT_MS,
  );

  if (!response.ok) {
    throw await gatewayError(response);
  }

  const data = await response.json();
  const models = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
  return models.map((entry) => (typeof entry === 'string' ? { id: entry } : entry));
}

/**
 * Probe the gateway. Used by the provider health endpoint.
 * @returns {Promise<{ok: boolean, status: number|null, latencyMs: number, modelCount: number|null, error: string|null}>}
 */
export async function newApiHealth(options = {}) {
  const startedAt = Date.now();

  try {
    const models = await newApiListModels(options);
    return {
      ok: true,
      status: 200,
      latencyMs: Date.now() - startedAt,
      modelCount: models.length,
      error: null,
    };
  } catch (error) {
    return {
      ok: false,
      status: error.status ?? null,
      latencyMs: Date.now() - startedAt,
      modelCount: null,
      error: error.code || 'newapi_error',
    };
  }
}

/**
 * Every request carries a deadline so a slow gateway cannot hold a worker.
 */
async function fetchWithTimeout(url, options, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  timer.unref?.();

  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) {
      const timeout = new Error(`ZESCODE API request timed out after ${ms}ms`);
      timeout.code = 'newapi_timeout';
      throw timeout;
    }

    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Bounded retries for rate limits and upstream failures. Authentication and
 * request errors are never retried.
 */
async function requestWithRetries(url, options, { timeoutMs, maxRetries, retryDelayMs }) {
  let lastError = null;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      const response = await fetchWithTimeout(url, options, timeoutMs);

      if (response.ok) {
        return response.json();
      }

      lastError = await gatewayError(response);

      if (!RETRYABLE_STATUS.has(response.status) || attempt === maxRetries) {
        throw lastError;
      }

      const retryAfter = retryAfterMs(response);
      await sleep(Math.min(retryAfter ?? retryDelayMs * 2 ** attempt, MAX_RETRY_DELAY_MS));
    } catch (error) {
      if (error.code === 'newapi_timeout' && attempt < maxRetries) {
        lastError = error;
        await sleep(Math.min(retryDelayMs * 2 ** attempt, MAX_RETRY_DELAY_MS));
        continue;
      }

      throw error;
    }
  }

  throw lastError || new Error('ZESCODE API request failed');
}

function retryAfterMs(response) {
  const header = response.headers?.get?.('retry-after');

  if (!header) {
    return null;
  }

  const seconds = Number(header);

  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1000;
  }

  const date = Date.parse(header);

  if (Number.isFinite(date)) {
    return Math.max(0, date - Date.now());
  }

  return null;
}

function sleep(ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}

/**
 * Map a gateway response to an error the hub can reason about.
 * The body is truncated and never contains the token.
 */
async function gatewayError(response) {
  let detail = '';

  try {
    detail = (await response.text()).slice(0, 300);
  } catch {
    detail = '';
  }

  const lower = detail.toLowerCase();
  const noChannel = lower.includes('no available channel') || lower.includes('model not found');

  let code = 'newapi_error';

  if (response.status === 401) {
    code = 'newapi_auth';
  } else if (response.status === 403) {
    code = 'newapi_forbidden';
  } else if (response.status === 429) {
    code = 'newapi_rate_limited';
  } else if (noChannel) {
    code = 'newapi_model_unavailable';
  } else if (response.status >= 500) {
    code = 'newapi_unavailable';
  }

  const error = new Error(`ZESCODE API error: ${response.status}${detail ? ` ${detail}` : ''}`);
  error.code = code;
  error.status = response.status;
  return error;
}
