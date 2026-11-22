// zes-agent-hub — APInexGate client
// Talks to an APInexGate instance through its OpenAI-compatible surface.
// The gateway keeps its own billing, rate limits and audit trail; the hub only
// holds one customer API key and never sees the gateway's upstream key.

import fetch from 'node-fetch';

const DEFAULT_BASE_URL = 'http://127.0.0.1:8787/v1';
const DEFAULT_TIMEOUT_MS = 120_000;

export function apinexGateBaseUrl() {
  const configured = (process.env.APINEXGATE_BASE_URL || DEFAULT_BASE_URL).trim();
  return configured.replace(/\/+$/, '');
}

export function apinexGateApiKey() {
  return (process.env.APINEXGATE_API_KEY || '').trim();
}

export function isApinexGateConfigured() {
  return Boolean(apinexGateApiKey());
}

/**
 * Generate text through an APInexGate model.
 * @param {string} model - Gateway model id, as listed by GET /v1/models
 * @param {Array<Object>} messages - OpenAI-style messages
 * @param {Object} options - maxTokens, temperature, timeoutMs
 * @returns {Promise<{content: string, model: string, tokens: number, inputTokens: number|null, outputTokens: number|null}>}
 */
export async function apinexGateGenChat(model, messages, options = {}) {
  const apiKey = (options.apiKey || apinexGateApiKey()).trim();

  if (!apiKey) {
    const error = new Error('APInexGate is not configured: set APINEXGATE_API_KEY');
    error.code = 'apinexgate_not_configured';
    throw error;
  }

  if (!model) {
    const error = new Error('APInexGate requires a model id');
    error.code = 'apinexgate_model_required';
    throw error;
  }

  const response = await fetchWithTimeout(
    `${apinexGateBaseUrl()}/chat/completions`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: options.temperature ?? 0.2,
        max_tokens: options.maxTokens || 1024,
        stream: false,
      }),
    },
    options.timeoutMs || DEFAULT_TIMEOUT_MS,
  );

  if (!response.ok) {
    throw await gatewayError(response);
  }

  const data = await response.json();
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
  };
}

/**
 * List the models the gateway exposes to this customer key.
 * @returns {Promise<Array<{id: string}>>}
 */
export async function apinexGateListModels() {
  const apiKey = apinexGateApiKey();

  if (!apiKey) {
    const error = new Error('APInexGate is not configured: set APINEXGATE_API_KEY');
    error.code = 'apinexgate_not_configured';
    throw error;
  }

  const response = await fetchWithTimeout(
    `${apinexGateBaseUrl()}/models`,
    { headers: { Authorization: `Bearer ${apiKey}` } },
    DEFAULT_TIMEOUT_MS,
  );

  if (!response.ok) {
    throw await gatewayError(response);
  }

  const data = await response.json();
  const models = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
  return models.map((entry) => (typeof entry === 'string' ? { id: entry } : entry));
}

/**
 * Read the customer balance the gateway reports for this key.
 * @returns {Promise<Object>}
 */
export async function apinexGateBalance() {
  const apiKey = apinexGateApiKey();

  if (!apiKey) {
    const error = new Error('APInexGate is not configured: set APINEXGATE_API_KEY');
    error.code = 'apinexgate_not_configured';
    throw error;
  }

  const response = await fetchWithTimeout(
    `${apinexGateBaseUrl()}/balance`,
    { headers: { Authorization: `Bearer ${apiKey}` } },
    DEFAULT_TIMEOUT_MS,
  );

  if (!response.ok) {
    throw await gatewayError(response);
  }

  return response.json();
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
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Map a gateway response to an error the hub can reason about.
 * The body is truncated and never contains the customer key.
 */
async function gatewayError(response) {
  let detail = '';
  try {
    detail = (await response.text()).slice(0, 300);
  } catch {
    detail = '';
  }

  const codes = {
    401: 'apinexgate_auth',
    403: 'apinexgate_forbidden',
    429: 'apinexgate_rate_limited',
    503: 'apinexgate_unavailable',
  };

  const error = new Error(`APInexGate error: ${response.status}${detail ? ` ${detail}` : ''}`);
  error.code = codes[response.status] || 'apinexgate_error';
  error.status = response.status;
  return error;
}
