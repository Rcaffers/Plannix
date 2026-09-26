import { GENERATION_MODELS, AI_LIMITS } from '../generationConfig.js';
import { requestProviderJson } from '../providerTransport.js';
export function generateOpenAi({ apiKey, systemPrompt, userContent, jsonSchema, schemaName, validate }, transport) {
  return requestProviderJson({ endpoint: 'https://api.openai.com/v1/responses', apiKey, validate,
    headers: { Authorization: `Bearer ${apiKey}` },
    body: { model: GENERATION_MODELS.openai, store: false, max_output_tokens: AI_LIMITS.outputTokens,
      input: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userContent }],
      text: { format: { type: 'json_schema', name: schemaName, schema: jsonSchema, strict: true } } },
    extract: response => {
      if (response.object !== 'response' || response.status !== 'completed' || response.error || response.incomplete_details
        || !Array.isArray(response.output)) throw Error();
      const results = [];
      for (const item of response.output) {
        if (item.type === 'reasoning') {
          if (item.status !== undefined && item.status !== 'completed') throw Error();
          continue;
        }
        if (item.type !== 'message' || item.role !== 'assistant' || item.status !== 'completed'
          || !Array.isArray(item.content) || !item.content.length) throw Error();
        for (const block of item.content) {
          if (block.type !== 'output_text') throw Error(); // includes refusals
          results.push(block.text);
        }
      }
      if (results.length !== 1) throw Error();
      return results[0];
    },
  }, transport);
}
