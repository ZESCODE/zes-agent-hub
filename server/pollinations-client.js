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
  const response = await fetch(`${POLLINATIONS_GATEWAY_URL}/chat/completions`, {
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
