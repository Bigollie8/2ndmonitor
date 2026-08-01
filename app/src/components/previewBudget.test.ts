import test from 'node:test';
import assert from 'node:assert/strict';
import { createPreviewBudget, PREVIEW_CONCURRENCY } from './previewBudget';

test('previewBudget: grants up to the cap and refuses beyond it', () => {
  const b = createPreviewBudget();
  for (let i = 0; i < PREVIEW_CONCURRENCY; i++) assert.equal(b.acquire(`k${i}`), true);
  assert.equal(b.acquire('one-too-many'), false);
  assert.equal(b.active(), PREVIEW_CONCURRENCY);
});

test('previewBudget: releasing frees a slot', () => {
  const b = createPreviewBudget();
  for (let i = 0; i < PREVIEW_CONCURRENCY; i++) b.acquire(`k${i}`);
  b.release('k0');
  assert.equal(b.acquire('new'), true);
});

test('previewBudget: acquiring twice for the same key does not consume two slots', () => {
  const b = createPreviewBudget();
  assert.equal(b.acquire('same'), true);
  assert.equal(b.acquire('same'), true);
  assert.equal(b.active(), 1);
});

test('previewBudget: releasing an unknown key is a no-op', () => {
  const b = createPreviewBudget();
  b.acquire('a');
  b.release('never-acquired');
  assert.equal(b.active(), 1);
});

test('previewBudget: the cap is 6', () => {
  assert.equal(PREVIEW_CONCURRENCY, 6);
});
