// zes-agent-hub — provider aware seat call
// A seat names a provider and a model. The call goes through the provider
// registry, so every seat reaches its provider the same way the scheduler
// does and the default provider stays the single source of truth.

import { getProvider } from './registry.js';

/**
 * Call the model of a seat through the provider the seat names.
 * @param {{id: string, provider?: string, model: string, nicknameModel?: string}} seat
 * @param {string} prompt
 * @param {{model?: string, maxTokens?: number, temperature?: number, timeoutMs?: number}} options
 */
export async function seatGenText(seat, prompt, options = {}) {
  const provider = getProvider(seat.provider);
  const model = options.model || seat.model;

  if (!model) {
    const error = new Error(`Seat ${seat.id} has no model`);
    error.code = 'seat_model_required';
    throw error;
  }

  const response = await provider.genChat(model, [{ role: 'user', content: prompt }], {
    maxTokens: options.maxTokens || 2048,
    temperature: options.temperature ?? 0.7,
    timeoutMs: options.timeoutMs,
  });

  return {
    ...response,
    seat: seat.id,
    nicknameModel: seat.nicknameModel,
  };
}
