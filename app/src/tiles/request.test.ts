import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRequest } from './request';

const spec = {
  kind: 'http' as const,
  url: 'https://api.example.com/u/{{config.user}}',
  headers: { Authorization: 'Bearer {{secret.token}}', 'X-Plain': 'v1' },
  intervalMs: 60000,
};

test('buildRequest: substitutes config into the url', () => {
  const r = buildRequest(spec, { config: { user: 'ada' }, secret: { token: 'sk-1' } });
  assert.equal(r.url, 'https://api.example.com/u/ada');
});

test('buildRequest: substitutes secrets into headers', () => {
  const r = buildRequest(spec, { config: { user: 'ada' }, secret: { token: 'sk-1' } });
  assert.equal(r.headers.Authorization, 'Bearer sk-1');
  assert.equal(r.headers['X-Plain'], 'v1');
});

test('buildRequest: a missing secret leaves the header empty, not the literal placeholder', () => {
  const r = buildRequest(spec, { config: { user: 'ada' }, secret: {} });
  assert.equal(r.headers.Authorization, 'Bearer ');
});

test('buildRequest: refuses to emit a non-https url after substitution', () => {
  assert.throws(() => buildRequest(
    { ...spec, url: 'https://{{config.host}}/x' },
    { config: { host: 'evil.com/../..' }, secret: {} },
  ), /url/i);
});
