import test from 'node:test';
import assert from 'node:assert';
import { ORIGINALS } from './index';
import { TRON_PALETTE, paletteFromAccents, hexToRgb01, vec3 } from './palette';

test('hexToRgb01 parses #rrggbb and #rgb; falls back on garbage', () => {
  assert.deepEqual(hexToRgb01('#00d9ff', TRON_PALETTE.b), { r: 0, g: 217 / 255, b: 1 });
  assert.deepEqual(hexToRgb01('#f80', TRON_PALETTE.a), { r: 1, g: 136 / 255, b: 0 });
  assert.strictEqual(hexToRgb01('teal', TRON_PALETTE.a), TRON_PALETTE.a);
  assert.strictEqual(hexToRgb01('', TRON_PALETTE.b), TRON_PALETTE.b);
});

test('paletteFromAccents keeps Tron colors for unparseable accents', () => {
  const p = paletteFromAccents('#c084fc', 'not-a-color');
  assert.notDeepEqual(p.a, TRON_PALETTE.a);
  assert.strictEqual(p.b, TRON_PALETTE.b);
});

test('vec3 formats a GLSL literal', () => {
  assert.equal(vec3({ r: 0, g: 0.5, b: 1 }), 'vec3(0.0000,0.5000,1.0000)');
});

test('registry ids are unique and kebab-case', () => {
  const ids = ORIGINALS.map((o) => o.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) assert.match(id, /^[a-z0-9]+(-[a-z0-9]+)*$/);
});

// Structural sanity for every original under both palettes: full preset shape,
// finite numbers everywhere, equation strings that at least compile, and
// shader strings that carry a shader_body block.
for (const def of ORIGINALS) {
  for (const [palName, pal] of [['tron', TRON_PALETTE], ['tint', paletteFromAccents('#c084fc', '#4ade80')]] as const) {
    test(`${def.id} builds a structurally valid preset (${palName})`, () => {
      const p = def.build(pal) as unknown as Record<string, unknown>;
      for (const k of ['baseVals', 'waves', 'shapes', 'init_eqs_str', 'frame_eqs_str', 'pixel_eqs_str', 'warp', 'comp']) {
        assert.ok(k in p, `missing ${k}`);
      }
      for (const [k, v] of Object.entries(p.baseVals as Record<string, number>)) {
        assert.ok(Number.isFinite(v), `baseVals.${k} not finite`);
      }
      assert.equal((p.waves as unknown[]).length, 4);
      assert.equal((p.shapes as unknown[]).length, 4);
      assert.match(p.warp as string, /shader_body\s*\{/);
      assert.match(p.comp as string, /shader_body\s*\{/);

      // every equation string must compile and leave finite state behind
      const seed = {
        time: 12.3, frame: 740, fps: 60,
        bass: 1, bass_att: 1.1, mid: 0.8, mid_att: 0.9, treb: 0.7, treb_att: 0.8,
        rad: 0.4, ang: 1, sample: 0.5, x: 0.5, y: 0.5, zoom: 1, rot: 0,
        hx: 0.5, hy: 0.5, tx: 0.4, ty: 0.4,
      };
      const runEqs = (label: string, src: unknown) => {
        if (typeof src !== 'string' || !src) return;
        const out = new Function('a', `${src};return a;`)({ ...seed }) as Record<string, unknown>;
        for (const [k, v] of Object.entries(out)) {
          if (typeof v === 'number') assert.ok(Number.isFinite(v), `${label}: ${k} not finite`);
        }
      };
      runEqs('init', p.init_eqs_str);
      runEqs('frame', p.frame_eqs_str);
      runEqs('pixel', p.pixel_eqs_str);
      (p.waves as Record<string, unknown>[]).forEach((w, i) => {
        runEqs(`wave${i}.frame`, w.frame_eqs_str);
        runEqs(`wave${i}.point`, w.point_eqs_str);
      });
      (p.shapes as Record<string, unknown>[]).forEach((s, i) => runEqs(`shape${i}.frame`, s.frame_eqs_str));
    });
  }
}

test('palette actually lands in the built preset (tint differs from tron)', () => {
  for (const def of ORIGINALS) {
    const a = JSON.stringify(def.build(TRON_PALETTE));
    const b = JSON.stringify(def.build(paletteFromAccents('#c084fc', '#4ade80')));
    assert.notEqual(a, b, `${def.id} ignores its palette`);
  }
});
