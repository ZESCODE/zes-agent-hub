// zes-agent-hub — Pollinations API Client
// Wrapper around Pollinations API Gateway for custom nickname@model assignments

import fetch from 'node-fetch';

const POLLINATIONS_API_KEY = process.env.POLLINATIONS_API_KEY;
const POLLINATIONS_GATEWAY_URL = process.env.POLLINATIONS_GATEWAY_URL || 'https://gen.pollinations.ai/v1';

if (!POLLINATIONS_API_KEY) {
  console.warn('[pollinations-client] POLLINATIONS_API_KEY not set — model calls will fail');
}

/**
 * Generate text using a Pollinations model
 * @param {string} model - Model name (e.g. "deepseek-v4.1-flash", "gpt-6-astra")
 * @param {string} prompt - User prompt
 * @param {Object} options - Additional options (temperature, max_tokens, etc.)
 * @returns {Promise<{content: string, model: string, tokens: number}>}
 */
export async function pollinationsGenText(model, prompt, options = {}) {
  const response = await fetch(`${POLLINATIONS_GATEWAY_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${POLLINATIONS_API_KEY}`,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: options.temperature || 0.7,
      max_tokens: options.maxTokens || 2048,
      stream: false,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Pollinations API error: ${response.status} ${errorText}`);
  }

  const data = await response.json();
  return {
    content: data.choices?.[0]?.message?.content || '',
    model: data.model || model,
    tokens: data.usage?.total_tokens || 0,
  };
}

/**
 * List available Pollinations models
 * @returns {Promise<Array>}
 */
/**
 * Generate text from a full message array (supports vision content).
 * @param {string} model - Pollinations model id
 * @param {Array<Object>} messages - OpenAI-style messages
 * @param {Object} options - Additional options
 * @returns {Promise<{content: string, model: string, tokens: number}>}
 */
export async function pollinationsGenChat(model, messages, options = {}) {
  const response = await fetchWithTimeout(
    `${POLLINATIONS_GATEWAY_URL}/chat/completions`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${POLLINATIONS_API_KEY}`,
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: options.temperature ?? 0.2,
        max_tokens: options.maxTokens || 1024,
        stream: false,
      }),
    },
    options.timeoutMs || 120_000,
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Pollinations API error: ${response.status} ${errorText}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || '';

  if (isCreditError(content)) {
    const fallback = await classicFallback(messages, options);

    if (fallback) {
      return fallback;
    }

    const error = new Error('Pollinations credits exhausted');
    error.code = 'model_credits_exhausted';
    throw error;
  }

  return {
    content,
    model: data.model || model,
    tokens: data.usage?.total_tokens || 0,
  };
}

/**
 * Every request carries a deadline so a slow provider cannot hold a worker.
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
 * Pollinations answers a request without credits with a normal completion
 * that carries a top up message instead of an error status.
 */
function isCreditError(content) {
  return /doesn['’]?t have enough credits|not enough credits|complete a quest/i.test(String(content || ''));
}

/**
 * The classic API keeps one free model available, so a run does not stop when
 * the account balance is empty.
 */
async function classicFallback(messages, options = {}) {
  const classicUrl = process.env.POLLINATIONS_CLASSIC_URL || 'https://text.pollinations.ai/openai';

  try {
    const response = await fetchWithTimeout(
      classicUrl,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(POLLINATIONS_API_KEY ? { Authorization: `Bearer ${POLLINATIONS_API_KEY}` } : {}),
        },
        body: JSON.stringify({
          model: process.env.POLLINATIONS_FALLBACK_MODEL || 'openai-fast',
          messages,
          temperature: options.temperature ?? 0.2,
          max_tokens: options.maxTokens || 1024,
          stream: false,
        }),
      },
      options.timeoutMs || 60_000,
    );

    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';

    if (!content || isCreditError(content)) {
      return null;
    }

    return {
      content,
      model: data.model || process.env.POLLINATIONS_FALLBACK_MODEL || 'openai-fast',
      tokens: data.usage?.total_tokens || 0,
      fallback: true,
    };
  } catch {
    return null;
  }
}

export async function pollinationsListModels() {
  const response = await fetch(`${POLLINATIONS_GATEWAY_URL}/models`, {
    headers: {
      'Authorization': `Bearer ${POLLINATIONS_API_KEY}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Pollinations models error: ${response.status}`);
  }

  return response.json();
}

/**
 * Generate text using a seat's nickname@model assignment
 * @param {Object} seat - Seat configuration with nicknameModel and model fields
 * @param {string} prompt - User prompt
 * @param {Object} options - Additional options
 * @returns {Promise<{content: string, model: string, tokens: number, seat: string}>}
 */
export async function seatGenText(seat, prompt, options = {}) {
  const model = options.model || seat.model || process.env.POLLINATIONS_MODEL_ORCHESTRATOR;
  const result = await pollinationsGenText(model, prompt, options);
  return {
    ...result,
    seat: seat.id,
    nicknameModel: seat.nicknameModel,
  };
}

export { POLLINATIONS_API_KEY, POLLINATIONS_GATEWAY_URL };
