import test from 'node:test';
import assert from 'node:assert/strict';
import { resolvePath, substitute } from './template';

test('resolvePath: walks a dot path', () => {
  assert.equal(resolvePath({ a: { b: { c: 7 } } }, 'a.b.c'), 7);
});

test('resolvePath: missing path yields undefined, never throws', () => {
  assert.equal(resolvePath({ a: 1 }, 'a.b.c'), undefined);
  assert.equal(resolvePath(null, 'a'), undefined);
});

test('resolvePath: does not walk into prototype chain', () => {
  assert.equal(resolvePath({}, 'constructor'), undefined);
  assert.equal(resolvePath({}, '__proto__'), undefined);
  assert.equal(resolvePath({ a: {} }, 'a.toString'), undefined);
});

test('substitute: replaces a single placeholder', () => {
  assert.equal(substitute('Hi {{item.name}}', { item: { name: 'Ada' } }), 'Hi Ada');
});

test('substitute: tolerates whitespace inside the braces', () => {
  assert.equal(substitute('{{ item.name }}', { item: { name: 'Ada' } }), 'Ada');
});

test('substitute: missing values render as empty string', () => {
  assert.equal(substitute('[{{item.nope}}]', { item: {} }), '[]');
});

test('substitute: numbers and booleans stringify', () => {
  assert.equal(substitute('{{data.n}}/{{data.b}}', { data: { n: 42, b: true } }), '42/true');
});

test('substitute: objects and arrays render empty rather than [object Object]', () => {
  assert.equal(substitute('{{data.o}}{{data.a}}', { data: { o: { x: 1 }, a: [1] } }), '');
});

test('substitute: multiple placeholders in one string', () => {
  assert.equal(
    substitute('{{item.a}}-{{item.b}}', { item: { a: 'x', b: 'y' } }),
    'x-y',
  );
});

test('substitute: an unknown scope root renders empty', () => {
  assert.equal(substitute('{{bogus.x}}', { item: { x: 1 } }), '');
});

test('substitute: leaves non-placeholder braces alone', () => {
  assert.equal(substitute('{ not a placeholder }', {}), '{ not a placeholder }');
});

test('substitute: a substituted value containing braces is not re-expanded', () => {
  // Guards against a bundle smuggling a second pass, e.g. data that renders
  // "{{secret.token}}" and hopes the host expands it.
  assert.equal(
    substitute('{{data.evil}}', { data: { evil: '{{secret.token}}' }, secret: { token: 'sk-123' } }),
    '{{secret.token}}',
  );
});
