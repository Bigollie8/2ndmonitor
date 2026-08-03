import test from 'node:test';
import assert from 'node:assert/strict';
import { cToF, fToC, convertTemp, formatTemp, resolveTempUnit } from './units';

test('converters: exact anchor points', () => {
  assert.equal(cToF(0), 32);
  assert.equal(cToF(100), 212);
  assert.equal(fToC(32), 0);
  assert.equal(fToC(212), 100);
});

test('convertTemp: identity when units match', () => {
  assert.equal(convertTemp(72, 'f', 'f'), 72);
  assert.equal(convertTemp(21, 'c', 'c'), 21);
  assert.equal(convertTemp(0, 'c', 'f'), 32);
});

test('formatTemp: rounds and adds the proper suffix', () => {
  assert.equal(formatTemp(72, 'f', 'f'), '72°F');
  assert.equal(formatTemp(72, 'f', 'c'), '22°C');
  assert.equal(formatTemp(36.6, 'c', 'c'), '37°C');
  assert.equal(formatTemp(0, 'c', 'f'), '32°F');
  assert.equal(formatTemp(71.6, 'f', 'c'), '22°C');
});

test('resolveTempUnit: explicit settings win regardless of locale', () => {
  assert.equal(resolveTempUnit('f', 'de-DE'), 'f');
  assert.equal(resolveTempUnit('c', 'en-US'), 'c');
});

test("resolveTempUnit: 'system' resolves via the locale region", () => {
  assert.equal(resolveTempUnit('system', 'en-US'), 'f');
  assert.equal(resolveTempUnit('system', 'es-PR'), 'f');
  assert.equal(resolveTempUnit('system', 'de-DE'), 'c');
  assert.equal(resolveTempUnit('system', 'en-GB'), 'c');
  assert.equal(resolveTempUnit('system', 'ja-JP'), 'c');
});

test("resolveTempUnit: malformed locale falls back to celsius", () => {
  assert.equal(resolveTempUnit('system', 'not a locale'), 'c');
});
