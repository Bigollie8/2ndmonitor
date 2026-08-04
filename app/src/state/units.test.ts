import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cToF, fToC, convertTemp, formatTemp, resolveTempUnit,
  mphToKph, kphToMph, convertWind, formatWind, resolveWindUnit,
} from './units';

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

// ── Wind speed (0.8.1) ───────────────────────────────────────────────────────

test('wind converters: exact anchor points', () => {
  assert.equal(mphToKph(0), 0);
  assert.equal(Math.round(mphToKph(100) * 1000) / 1000, 160.934);
  assert.equal(kphToMph(0), 0);
  assert.equal(Math.round(kphToMph(160.934) * 100) / 100, 100);
});

test('convertWind: identity when units match', () => {
  assert.equal(convertWind(12, 'mph', 'mph'), 12);
  assert.equal(convertWind(12, 'kph', 'kph'), 12);
});

test('convertWind: round-trips', () => {
  assert.equal(Math.round(convertWind(convertWind(37, 'mph', 'kph'), 'kph', 'mph')), 37);
});

test('formatWind: rounds and uses conventional suffixes', () => {
  assert.equal(formatWind(12, 'mph', 'mph'), '12 mph');
  assert.equal(formatWind(12, 'mph', 'kph'), '19 km/h');
  assert.equal(formatWind(0, 'mph', 'kph'), '0 km/h');
  // 4.6 mph rounds to 5 mph, but 7.4 km/h rounds to 7 - conversion happens
  // BEFORE rounding, so the two displays are independently correct.
  assert.equal(formatWind(4.6, 'mph', 'mph'), '5 mph');
  assert.equal(formatWind(4.6, 'mph', 'kph'), '7 km/h');
});

test('resolveWindUnit: explicit settings win regardless of locale', () => {
  assert.equal(resolveWindUnit('mph', 'de-DE'), 'mph');
  assert.equal(resolveWindUnit('kph', 'en-US'), 'kph');
});

test("resolveWindUnit: 'system' resolves via the locale region", () => {
  assert.equal(resolveWindUnit('system', 'en-US'), 'mph');
  assert.equal(resolveWindUnit('system', 'en-GB'), 'mph');
  assert.equal(resolveWindUnit('system', 'de-DE'), 'kph');
  assert.equal(resolveWindUnit('system', 'ja-JP'), 'kph');
  assert.equal(resolveWindUnit('system', 'fr-FR'), 'kph');
});

test('resolveWindUnit: malformed locale falls back to kph', () => {
  assert.equal(resolveWindUnit('system', 'not a locale'), 'kph');
});
