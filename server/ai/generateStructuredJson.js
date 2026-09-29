import { checkCancellation } from './cancellation.js';
import { retrieveAiCredential } from './credential.js';
import { getProvider } from './providers.js';
import { prepareGeneration } from './generationInput.js';
import { aiError, safeAiError } from './generationErrors.js';
import { MAX_AI_KEY_LENGTH } from '../../shared/aiProviders.js';

// Dependencies are injected by trusted tests/server composition only. No route
// accepts these options. The default entry point retains the Stage 2A boundary.
export function createStructuredJsonGenerator({ retrieveCredential = retrieveAiCredential, fetchImpl = globalThis.fetch,
  timeoutMs,
} = {}) {
  return async function generateStructuredJsonForUser(input, { signal } = {}) {
    const prepared = prepareGeneration(input); // reject invalid/oversized input before secrets or IO
    checkCancellation(signal);
    let connection;
    try { connection = await retrieveCredential(prepared.userId, { signal }); }
    catch (error) {
      checkCancellation(signal);
      if (error?.code === 'AI_TIMEOUT') throw aiError('AI_TIMEOUT');
      throw aiError('AI_CREDENTIAL_UNAVAILABLE');
    }
    try {
      checkCancellation(signal);
      const provider = typeof connection?.provider === 'string' && getProvider(connection.provider);
      if (!provider?.generateStructuredJson) throw aiError('AI_CONFIGURATION_ERROR');
      if (typeof connection.apiKey !== 'string' || connection.apiKey.trim().length < 5
        || connection.apiKey.length > MAX_AI_KEY_LENGTH || /[\r\n]/.test(connection.apiKey)) throw aiError('AI_CREDENTIAL_UNAVAILABLE');
      return await provider.generateStructuredJson({ ...prepared, apiKey: connection.apiKey }, { fetchImpl, timeoutMs, signal });
    } catch (error) { throw safeAiError(error); }
    finally { connection = null; }
  };
}
export const generateStructuredJsonForUser = createStructuredJsonGenerator();
