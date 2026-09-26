import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyHolidayJson } from './strictHolidayJson.js';
const check = text => verifyHolidayJson(null, null, Buffer.from(text));
for (const text of ['{"a":1,"a":2}', '{"a":[{"b":1,"b":2}]}', '{"a":1,"\\u0061":2}', '{"a\\\\b":1,"a\\u005cb":2}', '{"a":', '{"__proto__":1,"__proto__":2}']) {
  test('invalid or duplicate decoded key rejected', () => assert.throws(() => check(text), { statusCode: 400 }));
}
for (const value of [{ text: 'text text "a":1,"a":2', a: [true, null, -3.5, { b: 'b' }] }, { a: { same: 1 }, b: { same: 2 } }, { 'a"b': 'a"b', 'a\\b': 'a\\b' }]) {
  test('valid JSON tokens and repeated values remain accepted', () => assert.doesNotThrow(() => check(JSON.stringify(value))));
}
test('depth bounded and prototype not mutated', () => {
  const before = Object.getOwnPropertyDescriptors(Object.prototype);
  assert.throws(() => check('['.repeat(102) + '0' + ']'.repeat(102)), { statusCode: 400 });
  check('{"__proto__":{"polluted":true}}'); // shape validator subsequently rejects this key
  assert.deepEqual(Object.getOwnPropertyDescriptors(Object.prototype), before);
});
