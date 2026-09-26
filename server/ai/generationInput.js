import Ajv from 'ajv';
import { AI_LIMITS } from './generationConfig.js';
import { aiError } from './generationErrors.js';
const fields = ['userId', 'systemPrompt', 'userContent', 'jsonSchema', 'schemaName'];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

// Bound schema traversal before serialization/compilation. Schemas are trusted
// server configuration, never browser input. Remote references are not loaded.
function checkTree(value, depth = 0, budget = { nodes: 0, enums: 0 }, ancestors = new WeakSet()) {
  if (++budget.nodes > 2048 || depth > 20) throw aiError('AI_CONFIGURATION_ERROR');
  if (value && typeof value === 'object') {
    if (ancestors.has(value)) throw Error();
    ancestors.add(value);
    // Count every occurrence, including shared objects as serialized in JSON.
    // Unsupported definitions/composition are still traversed, then rejected below.
    if (Object.hasOwn(value, 'enum') && Array.isArray(value.enum)) {
      budget.enums += value.enum.length;
      if (budget.enums > 1000) throw Error();
    }
    if (value.properties && typeof value.properties === 'object'
      && Object.keys(value.properties).some(name => ['__proto__', 'prototype', 'constructor'].includes(name))) throw Error();
    for (const child of Object.values(value)) checkTree(child, depth + 1, budget, ancestors);
    ancestors.delete(value);
  } else if (!['string', 'number', 'boolean'].includes(typeof value) && value !== null) {
    throw aiError('AI_CONFIGURATION_ERROR');
  }
}
// Deliberately small intersection of the three REST schema dialects. Do not
// remove or rewrite constraints: unsupported schemas fail before credential IO.
function checkCommonSchema(schema, depth = 0, budget = { properties: 0, nullable: 0 }) {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema) || depth > 5) throw Error();
  let type = schema.type;
  if (Array.isArray(type)) {
    if (type.length !== 2 || type[1] !== 'null' || !['string', 'number', 'integer', 'boolean'].includes(type[0])
      || ++budget.nullable > 8) throw Error();
    type = type[0];
  }
  if (!['object', 'array', 'string', 'number', 'integer', 'boolean', 'null'].includes(type)) throw Error();
  const keys = ['type', 'description'];
  if (type === 'object') keys.push('properties', 'required', 'additionalProperties');
  if (type === 'array') keys.push('items');
  if (type === 'string' && !Array.isArray(schema.type)) keys.push('enum');
  if (Object.keys(schema).some(key => !keys.includes(key))) throw Error();
  if (schema.description !== undefined && typeof schema.description !== 'string') throw Error();
  if (type === 'object') {
    if (!schema.properties || typeof schema.properties !== 'object' || Array.isArray(schema.properties)
      || schema.additionalProperties !== false || !Array.isArray(schema.required)) throw Error();
    const names = Object.keys(schema.properties);
    budget.properties += names.length;
    if (budget.properties > 100 || schema.required.length !== names.length
      || new Set(schema.required).size !== names.length || schema.required.some(name => !names.includes(name))) throw Error();
    for (const child of Object.values(schema.properties)) checkCommonSchema(child, depth + 1, budget);
  }
  if (type === 'array') checkCommonSchema(schema.items, depth + 1, budget);
  if (schema.enum !== undefined && (!Array.isArray(schema.enum) || !schema.enum.length || schema.enum.length > 100
    || schema.enum.some(value => typeof value !== 'string') || new Set(schema.enum).size !== schema.enum.length)) throw Error();
}
export function prepareGeneration(input) {
  try {
    if (!input || typeof input !== 'object' || Array.isArray(input)
      || Object.keys(input).length !== fields.length || Object.keys(input).some(key => !fields.includes(key))
      || typeof input.userId !== 'string' || !uuid.test(input.userId)
      || typeof input.schemaName !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(input.schemaName)) throw Error();
    for (const [field, limit] of [['systemPrompt', AI_LIMITS.systemPromptBytes], ['userContent', AI_LIMITS.userContentBytes]]) {
      if (typeof input[field] !== 'string' || !input[field].trim() || Buffer.byteLength(input[field], 'utf8') > limit) throw Error();
    }
    checkTree(input.jsonSchema);
    const serialized = JSON.stringify(input.jsonSchema);
    if (Buffer.byteLength(serialized, 'utf8') > AI_LIMITS.schemaBytes) throw Error();
    const jsonSchema = JSON.parse(serialized);
    if (!jsonSchema || jsonSchema.type !== 'object') throw Error();
    checkCommonSchema(jsonSchema);
    // Per-call compiler: no persistent cache of schemas, content or credentials.
    const ajv = new Ajv({ strict: true, allErrors: false, logger: false, coerceTypes: false,
      useDefaults: false, removeAdditional: false, ownProperties: true });
    const validate = ajv.compile(jsonSchema);
    if (validate.$async) throw Error();
    return { ...input, jsonSchema, validate };
  } catch {
    throw aiError('AI_CONFIGURATION_ERROR');
  }
}
