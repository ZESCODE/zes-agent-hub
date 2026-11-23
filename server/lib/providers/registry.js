// zes-agent-hub — provider registry
// One entry per model provider the hub can call. The router picks a provider
// id, the model runner asks the registry for the matching client.
//
// The ZESCODE API gateway (new-api) is the default provider: it owns routing
// across its own upstream channels and keeps the billing trail. Pollinations
// and APInexGate stay parallel providers that a seat can name explicitly.
// APInexGate is never used as an implicit fallback.

import { newApiGenChat, newApiHealth, newApiListModels, isNewApiConfigured } from '../../newapi-client.js';
import { pollinationsGenChat, pollinationsListModels } from '../../pollinations-client.js';
import {
  apinexGateBalance,
  apinexGateGenChat,
  apinexGateListModels,
  isApinexGateConfigured,
} from '../../apinexgate-client.js';

const PROVIDERS = {
  newapi: {
    id: 'newapi',
    label: 'ZESCODE API',
    envKeys: ['NEW_API_API_KEY', 'NEW_API_BASE_URL'],
    costEnvKey: 'NEW_API_COST_PER_MILLION_TOKENS',
    defaultModelEnvKey: 'NEW_API_DEFAULT_MODEL',
    costPerMillionTokens: null,
    isConfigured: isNewApiConfigured,
    genChat: newApiGenChat,
    listModels: newApiListModels,
    health: newApiHealth,
  },
  pollinations: {
    id: 'pollinations',
    label: 'Pollinations',
    envKeys: ['POLLINATIONS_API_KEY'],
    costEnvKey: 'POLLINATIONS_COST_PER_MILLION_TOKENS',
    defaultModelEnvKey: 'POLLINATIONS_DEFAULT_MODEL',
    costPerMillionTokens: 0.5,
    isConfigured: () => Boolean(process.env.POLLINATIONS_API_KEY),
    genChat: pollinationsGenChat,
    listModels: pollinationsListModels,
  },
  apinexgate: {
    id: 'apinexgate',
    label: 'APInexGate',
    envKeys: ['APINEXGATE_API_KEY', 'APINEXGATE_BASE_URL'],
    costEnvKey: 'APINEXGATE_COST_PER_MILLION_TOKENS',
    defaultModelEnvKey: 'APINEXGATE_DEFAULT_MODEL',
    costPerMillionTokens: null,
    isConfigured: isApinexGateConfigured,
    genChat: apinexGateGenChat,
    listModels: apinexGateListModels,
    balance: apinexGateBalance,
  },
};

export const DEFAULT_PROVIDER = 'newapi';

export function listProviders() {
  return Object.values(PROVIDERS);
}

export function providerIds() {
  return Object.keys(PROVIDERS);
}

export function isKnownProvider(providerId) {
  return typeof providerId === 'string' && Object.hasOwn(PROVIDERS, providerId);
}

export function getProvider(providerId) {
  const provider = PROVIDERS[providerId] || PROVIDERS[DEFAULT_PROVIDER];
  return provider;
}

/**
 * Flat view of the catalog for the API surface.
 */
export function providerCatalog() {
  return listProviders().map((provider) => ({
    id: provider.id,
    label: provider.label,
    configured: provider.isConfigured(),
    envKeys: provider.envKeys,
    defaultModel: defaultModelFor(provider.id),
    costPerMillionTokens: costPerMillionTokens(provider.id),
  }));
}

/**
 * Cost estimate per provider. Providers without a configured rate fall back to
 * the flat estimate the hub used before the provider was added.
 */
export function costPerMillionTokens(providerId) {
  const provider = getProvider(providerId);

  if (provider.costEnvKey) {
    const configured = Number(process.env[provider.costEnvKey]);

    if (Number.isFinite(configured) && configured >= 0) {
      return configured;
    }
  }

  return provider.costPerMillionTokens ?? 0.5;
}

/**
 * Model the provider uses when a seat does not name one.
 */
export function defaultModelFor(providerId) {
  const provider = getProvider(providerId);

  if (!provider.defaultModelEnvKey) {
    return '';
  }

  return (process.env[provider.defaultModelEnvKey] || '').trim();
}
