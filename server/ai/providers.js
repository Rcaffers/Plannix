import { AI_PROVIDERS } from '../../shared/aiProviders.js';

// Phase one stores credentials only. These identities reserve separate future
// server adapters; none is implemented or callable, and no network IO occurs.
export const providerRegistry = Object.freeze(Object.fromEntries(AI_PROVIDERS.map(provider => [provider.id,
  Object.freeze({ ...provider, adapterIdentity: provider.id, executionEnabled: false }),
])));
export function getProvider(id) {
  return Object.hasOwn(providerRegistry, id) ? providerRegistry[id] : null;
}
