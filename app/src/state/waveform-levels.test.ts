import test from 'node:test';
import assert from 'node:assert';
import { makeButterchurnLevels } from './waveform-levels';

test('duplicates mono into all three channel arrays', () => {
  const b = makeButterchurnLevels();
  const mono = new Uint8Array(1024).fill(128);
  mono[0] = 5; mono[1023] = 250;
  b.update(mono);
  assert.equal(b.levels.timeByteArray[0], 5);
  assert.equal(b.levels.timeByteArrayL[1023], 250);
  assert.equal(b.levels.timeByteArrayR[0], 5);
  assert.equal(b.levels.timeByteArrayR[512], 128);
});

test('keeps stable array references across updates', () => {
  const b = makeButterchurnLevels();
  const ref = b.levels.timeByteArrayL;
  b.update(new Uint8Array(1024).fill(200));
  assert.strictEqual(b.levels.timeByteArrayL, ref);
  assert.equal(ref[7], 200);
});

test('tolerates short input without throwing', () => {
  const b = makeButterchurnLevels();
  b.update(new Uint8Array(100).fill(9));
  assert.equal(b.levels.timeByteArray[50], 9);
});
