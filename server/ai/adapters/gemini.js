import { GENERATION_MODELS, AI_LIMITS } from '../generationConfig.js';
import { requestProviderJson } from '../providerTransport.js';
export function generateGemini({ apiKey, systemPrompt, userContent, jsonSchema, validate }, transport) {
  return requestProviderJson({ endpoint: 'https://generativelanguage.googleapis.com/v1beta/interactions', apiKey, validate,
    headers: { 'x-goog-api-key': apiKey },
    body: { model: GENERATION_MODELS.google_gemini, input: userContent,
      system_instruction: systemPrompt, store: false, stream: false,
      generation_config: { max_output_tokens: AI_LIMITS.outputTokens, thinking_summaries: 'none' },
      response_format: { type: 'text', mime_type: 'application/json', schema: jsonSchema } },
    extract: response => {
      // Current REST Interactions envelope: steps, not GenerateContent candidates
      // or SDK-only output_text. No tools, streaming or background jobs requested.
      if (response.object !== 'interaction' || response.status !== 'completed' || response.error
        || !Array.isArray(response.steps)) throw Error();
      const results = [];
      for (const step of response.steps) {
        if (step.type === 'thought') continue;
        if (step.type !== 'model_output' || !Array.isArray(step.content) || !step.content.length) throw Error();
        for (const block of step.content) {
          if (block.type !== 'text') throw Error();
          results.push(block.text);
        }
      }
      if (results.length !== 1) throw Error();
      return results[0];
    },
  }, transport);
}
