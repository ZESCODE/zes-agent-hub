// zes-agent-hub — provider registry
// One entry per model provider the hub can call. The router picks a provider
// id, the model runner asks the registry for the matching client.

import { pollinationsGenChat, pollinationsListModels } from '../../pollinations-client.js';
import {
  apinexGateBalance,
  apinexGateGenChat,
  apinexGateListModels,
  isApinexGateConfigured,
} from '../../apinexgate-client.js';

const PROVIDERS = {
  pollinations: {
    id: 'pollinations',
    label: 'Pollinations',
    envKeys: ['POLLINATIONS_API_KEY'],
    costPerMillionTokens: 0.5,
    isConfigured: () => Boolean(process.env.POLLINATIONS_API_KEY),
    genChat: pollinationsGenChat,
    listModels: pollinationsListModels,
  },
  apinexgate: {
    id: 'apinexgate',
    label: 'APInexGate',
    envKeys: ['APINEXGATE_API_KEY', 'APINEXGATE_BASE_URL'],
    costPerMillionTokens: null,
    isConfigured: isApinexGateConfigured,
    genChat: apinexGateGenChat,
    listModels: apinexGateListModels,
    balance: apinexGateBalance,
  },
};

export const DEFAULT_PROVIDER = 'pollinations';

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
    costPerMillionTokens:
      provider.costPerMillionTokens ?? Number(process.env.APINEXGATE_COST_PER_MILLION_TOKENS ?? 0.5),
  }));
}

/**
 * Cost estimate per provider. Providers without a configured rate fall back to
 * the flat estimate the hub used before the provider was added.
 */
export function costPerMillionTokens(providerId) {
  const provider = getProvider(providerId);

  if (provider.id === 'apinexgate') {
    return Number(process.env.APINEXGATE_COST_PER_MILLION_TOKENS ?? 0.5);
  }

  return provider.costPerMillionTokens ?? 0.5;
}
