import { AI_PROVIDERS } from '../../shared/aiProviders.js';

import { generateOpenAi } from './adapters/openai.js';
import { generateAnthropic } from './adapters/anthropic.js';
import { generateGemini } from './adapters/gemini.js';
const adapters = { openai: generateOpenAi, anthropic: generateAnthropic, google_gemini: generateGemini };
// Shared IDs remain authoritative. Generation is internal only; public execution
// stays disabled until a separately reviewed endpoint is introduced.
export const providerRegistry = Object.freeze(Object.fromEntries(AI_PROVIDERS.map(provider => [provider.id,
  Object.freeze({ ...provider, adapterIdentity: provider.id, executionEnabled: false, generateStructuredJson: adapters[provider.id] }),
])));
export function getProvider(id) {
  return Object.hasOwn(providerRegistry, id) ? providerRegistry[id] : null;
}
