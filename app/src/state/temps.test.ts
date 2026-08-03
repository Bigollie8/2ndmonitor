import test from 'node:test';
import assert from 'node:assert/strict';
import {
  tempColor, tempsToChips, tempsTooltip,
  TEMP_OK_COLOR, TEMP_WARN_COLOR, TEMP_HOT_COLOR,
} from './temps';

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
    ['CPU 58°', 'GPU 64°', 'Board 41°', 'NVMe 47°'],
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
