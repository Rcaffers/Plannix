import { GENERATION_MODELS, AI_LIMITS } from '../generationConfig.js';
import { requestProviderJson } from '../providerTransport.js';
export function generateAnthropic({ apiKey, systemPrompt, userContent, jsonSchema, validate }, transport) {
  return requestProviderJson({ endpoint: 'https://api.anthropic.com/v1/messages', apiKey, validate,
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: { model: GENERATION_MODELS.anthropic, max_tokens: AI_LIMITS.outputTokens,
      system: systemPrompt, messages: [{ role: 'user', content: userContent }],
      output_config: { format: { type: 'json_schema', schema: jsonSchema } } },
    extract: response => {
      if (response.type !== 'message' || response.role !== 'assistant' || response.stop_reason !== 'end_turn'
        || response.stop_details?.type === 'refusal' || !Array.isArray(response.content)) throw Error();
      const results = [];
      for (const block of response.content) {
        if (block.type === 'thinking' || block.type === 'redacted_thinking') continue;
        if (block.type !== 'text') throw Error();
        results.push(block.text);
      }
      if (results.length !== 1) throw Error();
      return results[0];
    },
  }, transport);
}
