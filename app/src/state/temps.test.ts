import test from 'node:test';
import assert from 'node:assert/strict';
import {
  tempColor, tempsToChips, tempsTooltip,
  tempDisplayFor, stripReadings, formatWatts,
  TEMP_OK_COLOR, TEMP_WARN_COLOR, TEMP_HOT_COLOR,
} from './temps';

test('tempsToChips converts to °F when asked (payload stays °C)', () => {
  const chips = tempsToChips([{ label: 'CPU', celsius: 100 }], 'f');
  assert.equal(chips[0]!.text, 'CPU 212°F');
  // color thresholds keep judging the raw °C value
  assert.equal(chips[0]!.color, TEMP_HOT_COLOR);
});

test('tempColor thresholds: ok up to 85, amber above 85, red above 95', () => {
  assert.equal(tempColor(58), TEMP_OK_COLOR);
  assert.equal(tempColor(85), TEMP_OK_COLOR);
  assert.equal(tempColor(85.1), TEMP_WARN_COLOR);
  assert.equal(tempColor(95), TEMP_WARN_COLOR);
  assert.equal(tempColor(95.1), TEMP_HOT_COLOR);
});

test('tempsToChips renders rounded chips in payload order', () => {
  const chips = tempsToChips([
    { label: 'CPU', celsius: 57.6 },
    { label: 'GPU', celsius: 64.2 },
    { label: 'Board', celsius: 41.0 },
    { label: 'NVMe', celsius: 47.4 },
  ]);
  assert.deepEqual(
    chips.map((c) => c.text),
    ['CPU 58°C', 'GPU 64°C', 'Board 41°C', 'NVMe 47°C'],
  );
  assert.equal(chips[1]!.color, TEMP_OK_COLOR);
});

test('tempsToChips colors hot parts', () => {
  const chips = tempsToChips([
    { label: 'CPU', celsius: 91 },
    { label: 'GPU', celsius: 97 },
  ]);
  assert.equal(chips[0]!.color, TEMP_WARN_COLOR);
  assert.equal(chips[1]!.color, TEMP_HOT_COLOR);
});

test('tempsToChips of a null/undefined payload is empty', () => {
  assert.deepEqual(tempsToChips(null), []);
  assert.deepEqual(tempsToChips(undefined), []);
});

test('tooltip appears only when GPU is the sole part', () => {
  assert.equal(
    tempsTooltip(tempsToChips([{ label: 'GPU', celsius: 64 }])),
    'Run LibreHardwareMonitor to see CPU, board and drive temps',
  );
  assert.equal(
    tempsTooltip(tempsToChips([
      { label: 'CPU', celsius: 50 },
      { label: 'GPU', celsius: 64 },
    ])),
    undefined,
  );
  assert.equal(tempsTooltip([]), undefined);
});

// ── 0.9.2: promoted in-cell temps + watts ────────────────────────────────────

test('tempDisplayFor finds the part, formats per unit, and brightens OK temps', () => {
  const temps = [{ label: 'CPU', celsius: 58 }, { label: 'GPU', celsius: 90 }];
  const cpu = tempDisplayFor(temps, 'CPU');
  assert.equal(cpu?.text, '58°C');
  assert.notEqual(cpu?.color, TEMP_OK_COLOR); // brighter than the dim strip grey
  const cpuF = tempDisplayFor(temps, 'CPU', 'f');
  assert.match(cpuF?.text ?? '', /°F$/);
  const gpu = tempDisplayFor(temps, 'GPU');
  assert.equal(gpu?.color, TEMP_WARN_COLOR); // >85 keeps the warn color
});

test('tempDisplayFor is null for missing part, null payload, and non-finite values', () => {
  assert.equal(tempDisplayFor([{ label: 'GPU', celsius: 64 }], 'CPU'), null);
  assert.equal(tempDisplayFor(null, 'CPU'), null);
  assert.equal(tempDisplayFor([{ label: 'CPU', celsius: NaN }], 'CPU'), null);
});

test('stripReadings drops CPU/GPU but keeps everything else in order', () => {
  const temps = [
    { label: 'CPU', celsius: 58 },
    { label: 'GPU', celsius: 64 },
    { label: 'Board', celsius: 41 },
    { label: 'NVMe', celsius: 47 },
  ];
  assert.deepEqual(stripReadings(temps).map((t) => t.label), ['Board', 'NVMe']);
  assert.deepEqual(stripReadings(null), []);
});

test('formatWatts rounds, and refuses zero/absent/broken values', () => {
  assert.equal(formatWatts(183.6), '184 W');
  assert.equal(formatWatts(null), null);
  assert.equal(formatWatts(undefined), null);
  assert.equal(formatWatts(0), null);
  assert.equal(formatWatts(NaN), null);
});
