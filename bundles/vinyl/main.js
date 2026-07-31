// Vinyl — spinning record with album-art label, glow ring, and a
// multi-piece tonearm that swings when playback stops. Migrated from
// viz-extra.tsx's VizVinyl.
//
// f.track and f.playback are both nullable — null whenever nothing is
// loaded or playing (the exact shape the smoke suite sends). Unlike every
// other Task 4 style, this one actually reads them:
//   - `isPlaying`: the original's `playback?.playing !== false` — when
//     playback is unknown (null), it defaults to TRUE so the viz looks
//     alive on first paint; only a confirmed `playing: false` stops it.
//     Ported verbatim as `f.playback ? f.playback.playing !== false : true`.
//   - `labelBg`: the original falls back to a gradient when
//     `track?.cover` is absent. The frame contract's `VizTrackInfo` (see
//     manifest.ts) carries only `{ title, artist }` — no `cover` field at
//     all, and there's no way to add one without image data crossing the
//     sandbox boundary, which the CSP (`default-src 'none'`, no
//     `img-src`/`connect-src`) forbids outright. So this port's label
//     ALWAYS renders the theme-gradient fallback; real album art, which
//     the built-in component shows when GSMTC reports cover art, is not
//     reproducible here. `f.track` itself is therefore never read — there
//     is nothing on it this bundle can use.
//
// Bin count: the original's reader is `makeSpectrumReader(64, ...)`
// (viz-extra.tsx:305) — but VizVinyl never calls `reader.out[i]` anywhere;
// it only reads `reader.bands.bass` and `reader.onset.kick`. The host's own
// frame-pump reader is ALSO built at N=64 (viz-sandbox-surface.tsx) and
// feeds `f.bands`/`f.onset` directly — an exact match, not an
// approximation like hud/orbital/aurora's N=32-vs-64 cases. No
// `viz.bins()` call is needed or made in this bundle at all.
//
// Sensitivity: `bass` and `kick` are both derived entirely inside
// makeSpectrumReader (sensitivity applied per-bin before the band mean;
// onset envelopes tracked off that same scaled/smoothed bass). Since the
// host's reader and the original's own reader are literally the same
// N=64 construction, there's no separate `* sensitivity` term left
// unreached anywhere in VizVinyl's body — full parity.
//
// Frame timing (the trap this style was flagged for): two per-tick
// constants, both framerate-dependent as written:
//   - `rotVel += (target - rotVel) * 0.06` is an EMA toward the target
//     angular rate with per-tick weight 0.06 (decay 0.94). Generalized
//     with k = f.dt*60 (reference ticks this frame) the same way Task 3's
//     circular ported its bass EMA: decay = Math.pow(0.94, k); rotVel =
//     rotVel*decay + target*(1-decay). Reduces to the exact 0.94/0.06
//     split at k=1 (dt=1/60s).
//   - `rot += rotVel` accumulates the (now-updated) angular rate once per
//     tick. Ported as `rot += rotVel * k`, the same accumulator pattern
//     Task 3's tunnel used for its phase clock — at k=1 this is exactly
//     the original's per-tick add.
//
// Divergence from the original's own behavior (not a rendering gap, a
// documented parity note): in viz-extra.tsx, `rot`/`rotVel` are `let`
// locals declared INSIDE the `useEffect`, whose dependency array includes
// both `accent` and `isPlaying`. Every accent change or play/pause toggle
// therefore unmounts and remounts the effect, silently resetting rot and
// rotVel to 0 — a visible snap in the disc's rotation on those React
// re-renders. A scripted bundle has no equivalent "effect remount"
// concept: `rot`/`rotVel` here are plain module-level state that persists
// for the sandbox's whole lifetime, so theme changes and play/pause
// toggles ease smoothly through the same `rotVel` EMA instead of snapping
// to 0. This is a deliberate choice, not an oversight — reproducing the
// snap would mean adding React-hook-remount semantics that don't exist in
// this runtime, purely to replicate what reads as an unintended artifact
// of the original's dependency array rather than an intentional design
// (the surrounding source comment describes bass/kick/pause behavior in
// detail and says nothing about resetting rotation on those events).
//
// No SVG stroke uses vector-effect="non-scaling-stroke" in the original —
// checked, not present — and the tonearm SVG's own strokes/rects are all
// plain user-space numbers that scale with its `width:'70%', height:'14%'`
// container exactly as the original does. The outer `filter:
// drop-shadow(0 0.4px 1.2px rgba(0,0,0,0.7))` on the <svg> element itself
// is a fixed-px CSS filter applied post-layout (not an SVG attribute), so
// it behaves identically in both the original and this port regardless of
// viewBox scale — not a re-introduced bug, just unchanged CSS.
var SVG_NS = 'http://www.w3.org/2000/svg';

function svgEl(tag) { return document.createElementNS(SVG_NS, tag); }

var container = document.createElement('div');
container.style.position = 'absolute';
container.style.inset = '0';
container.style.background = 'radial-gradient(circle at 30% 40%, #1a1a22 0%, #06070a 70%)';
container.style.display = 'flex';
container.style.alignItems = 'center';
container.style.justifyContent = 'center';
viz.root.appendChild(container);

var wrap = document.createElement('div');
wrap.style.position = 'relative';
wrap.style.width = 'min(90%, 90vh)';
wrap.style.aspectRatio = '1/1';
container.appendChild(wrap);

// Glow ring — sits behind the disc, doesn't rotate, pulses on kicks.
var glow = document.createElement('div');
glow.style.position = 'absolute';
glow.style.inset = '0';
glow.style.borderRadius = '50%';
glow.style.transition = 'box-shadow 60ms linear';
glow.style.pointerEvents = 'none';
wrap.appendChild(glow);

// Disc — rotates as one unit (vinyl + grooves + label).
var disc = document.createElement('div');
disc.style.position = 'absolute';
disc.style.inset = '0';
disc.style.borderRadius = '50%';
disc.style.backgroundImage =
  'repeating-radial-gradient(circle, rgba(255,255,255,0.04) 0 1px, transparent 1px 3px), ' +
  'radial-gradient(circle, #0a0a0c 0%, #0a0a0c 96%, #050507 96%, #050507 100%)';
disc.style.backgroundColor = '#0a0a0c';
wrap.appendChild(disc);

// Highlight sheen — sits on top of the rotating disc.
var sheen = document.createElement('div');
sheen.style.position = 'absolute';
sheen.style.inset = '0';
sheen.style.borderRadius = '50%';
sheen.style.background = 'radial-gradient(ellipse 60% 40% at 30% 30%, rgba(255,255,255,0.08), transparent 70%)';
sheen.style.pointerEvents = 'none';
disc.appendChild(sheen);

// Album-art label — always the theme-gradient fallback (see file header).
var label = document.createElement('div');
label.style.position = 'absolute';
label.style.top = '50%';
label.style.left = '50%';
label.style.width = '38%';
label.style.height = '38%';
label.style.transform = 'translate(-50%, -50%)';
label.style.borderRadius = '50%';
label.style.backgroundSize = 'cover';
label.style.backgroundPosition = 'center';
label.style.backgroundRepeat = 'no-repeat';
label.style.overflow = 'hidden';
disc.appendChild(label);

// Spindle hole.
var spindle = document.createElement('div');
spindle.style.position = 'absolute';
spindle.style.top = '50%';
spindle.style.left = '50%';
spindle.style.width = '8%';
spindle.style.height = '8%';
spindle.style.transform = 'translate(-50%, -50%)';
spindle.style.borderRadius = '50%';
spindle.style.background = '#06070a';
spindle.style.boxShadow = 'inset 0 0 4px rgba(0,0,0,0.9)';
label.appendChild(spindle);

// Tonearm assembly — inline SVG so all parts (counterweight, pivot, tube,
// headshell, cartridge) scale together. Pivot sits at viewBox x=92;
// transformOrigin '83.6% 50%' (92/110) rotates the whole assembly around it.
var arm = svgEl('svg');
arm.setAttribute('viewBox', '0 0 110 14');
arm.setAttribute('preserveAspectRatio', 'xMidYMid meet');
arm.style.position = 'absolute';
arm.style.top = '4%';
arm.style.right = '-6%';
arm.style.width = '70%';
arm.style.height = '14%';
arm.style.transformOrigin = '83.6% 50%';
arm.style.transition = 'transform 900ms cubic-bezier(0.55, 0.05, 0.4, 1)';
arm.style.overflow = 'visible';
arm.style.pointerEvents = 'none';
arm.style.filter = 'drop-shadow(0 0.4px 1.2px rgba(0,0,0,0.7))';
wrap.appendChild(arm);

var armDefs = svgEl('defs');
arm.appendChild(armDefs);

var tubeGrad = svgEl('linearGradient');
tubeGrad.setAttribute('id', 'vinyl-arm-tube');
tubeGrad.setAttribute('x1', '0'); tubeGrad.setAttribute('y1', '0');
tubeGrad.setAttribute('x2', '0'); tubeGrad.setAttribute('y2', '1');
armDefs.appendChild(tubeGrad);
[['0', '#5a5a64'], ['0.45', '#2a2a34'], ['1', '#1a1a22']].forEach(function (s) {
  var stop = svgEl('stop');
  stop.setAttribute('offset', s[0]);
  stop.setAttribute('stop-color', s[1]);
  tubeGrad.appendChild(stop);
});

var cwGrad = svgEl('linearGradient');
cwGrad.setAttribute('id', 'vinyl-arm-cw');
cwGrad.setAttribute('x1', '0'); cwGrad.setAttribute('y1', '0');
cwGrad.setAttribute('x2', '0'); cwGrad.setAttribute('y2', '1');
armDefs.appendChild(cwGrad);
[['0', '#3a3a44'], ['1', '#0e0e16']].forEach(function (s) {
  var stop = svgEl('stop');
  stop.setAttribute('offset', s[0]);
  stop.setAttribute('stop-color', s[1]);
  cwGrad.appendChild(stop);
});

var pivotGrad = svgEl('radialGradient');
pivotGrad.setAttribute('id', 'vinyl-arm-pivot');
pivotGrad.setAttribute('cx', '35%'); pivotGrad.setAttribute('cy', '35%'); pivotGrad.setAttribute('r', '65%');
armDefs.appendChild(pivotGrad);
[['0', '#7a7a86'], ['0.55', '#2a2a34'], ['1', '#08080c']].forEach(function (s) {
  var stop = svgEl('stop');
  stop.setAttribute('offset', s[0]);
  stop.setAttribute('stop-color', s[1]);
  pivotGrad.appendChild(stop);
});

// Counterweight.
var cwRect = svgEl('rect');
cwRect.setAttribute('x', '98'); cwRect.setAttribute('y', '4');
cwRect.setAttribute('width', '10'); cwRect.setAttribute('height', '6');
cwRect.setAttribute('rx', '1.4');
cwRect.setAttribute('fill', 'url(#vinyl-arm-cw)');
arm.appendChild(cwRect);

var cwLine = svgEl('line');
cwLine.setAttribute('x1', '100.5'); cwLine.setAttribute('y1', '4.4');
cwLine.setAttribute('x2', '100.5'); cwLine.setAttribute('y2', '9.6');
cwLine.setAttribute('stroke', 'rgba(255,255,255,0.08)');
cwLine.setAttribute('stroke-width', '0.3');
arm.appendChild(cwLine);

// Arm tube.
var tubeRect = svgEl('rect');
tubeRect.setAttribute('x', '9'); tubeRect.setAttribute('y', '6');
tubeRect.setAttribute('width', '83'); tubeRect.setAttribute('height', '2');
tubeRect.setAttribute('rx', '1');
tubeRect.setAttribute('fill', 'url(#vinyl-arm-tube)');
arm.appendChild(tubeRect);

var tubeHighlight = svgEl('rect');
tubeHighlight.setAttribute('x', '9'); tubeHighlight.setAttribute('y', '6.1');
tubeHighlight.setAttribute('width', '83'); tubeHighlight.setAttribute('height', '0.35');
tubeHighlight.setAttribute('fill', 'rgba(255,255,255,0.18)');
arm.appendChild(tubeHighlight);

// Pivot bearing.
var pivot = svgEl('circle');
pivot.setAttribute('cx', '92'); pivot.setAttribute('cy', '7'); pivot.setAttribute('r', '3.6');
pivot.setAttribute('fill', 'url(#vinyl-arm-pivot)');
arm.appendChild(pivot);

var pivotRing = svgEl('circle');
pivotRing.setAttribute('cx', '92'); pivotRing.setAttribute('cy', '7'); pivotRing.setAttribute('r', '3.6');
pivotRing.setAttribute('fill', 'none');
pivotRing.setAttribute('stroke', 'rgba(0,0,0,0.5)');
pivotRing.setAttribute('stroke-width', '0.3');
arm.appendChild(pivotRing);

var pivotCenter = svgEl('circle');
pivotCenter.setAttribute('cx', '92'); pivotCenter.setAttribute('cy', '7'); pivotCenter.setAttribute('r', '1');
pivotCenter.setAttribute('fill', '#08080c');
arm.appendChild(pivotCenter);

// Headshell.
var headshell = svgEl('path');
headshell.setAttribute('d', 'M 2 4 L 12 5 L 12 9 L 2 10 Z');
headshell.setAttribute('fill', '#1a1a22');
headshell.setAttribute('stroke', 'rgba(0,0,0,0.6)');
headshell.setAttribute('stroke-width', '0.3');
arm.appendChild(headshell);

var cartridge = svgEl('rect');
cartridge.setAttribute('x', '4'); cartridge.setAttribute('y', '9.5');
cartridge.setAttribute('width', '6'); cartridge.setAttribute('height', '2.6');
cartridge.setAttribute('rx', '0.4');
cartridge.setAttribute('fill', '#06070a');
cartridge.setAttribute('stroke', 'rgba(255,255,255,0.06)');
cartridge.setAttribute('stroke-width', '0.2');
arm.appendChild(cartridge);

// Stylus tip — accent dot under the cartridge, dim when parked.
var stylus = svgEl('circle');
stylus.setAttribute('cx', '7'); stylus.setAttribute('cy', '12.6'); stylus.setAttribute('r', '0.35');
arm.appendChild(stylus);

var lastAccent = null;
var lastAccent2 = null;
var rot = 0;
var rotVel = 0; // angular velocity (deg/reference-tick), eased toward target

viz.on('frame', function (f) {
  var accent = f.theme.accent;
  var accent2 = f.theme.accent2;
  var isPlaying = f.playback ? f.playback.playing !== false : true;

  if (accent !== lastAccent || accent2 !== lastAccent2) {
    label.style.background = 'linear-gradient(135deg, ' + accent + ', ' + accent2 + ')';
    label.style.boxShadow = 'inset 0 0 0 2px rgba(0,0,0,0.4), 0 0 24px ' + accent + '55';
    lastAccent = accent;
    lastAccent2 = accent2;
  }

  var bass = f.bands.bass;
  var kick = f.onset.kick;

  var k = f.dt * 60;
  var target = isPlaying ? (1.6 + bass * 1.0) : 0;
  var decay = Math.pow(0.94, k);
  rotVel = rotVel * decay + target * (1 - decay);
  rot += rotVel * k;
  disc.style.transform = 'rotate(' + rot + 'deg)';

  var kickEff = isPlaying ? kick : 0;
  var blur = 60 + kickEff * 90;
  var alpha = Math.round((0.18 + kickEff * 0.45) * 255).toString(16).padStart(2, '0');
  glow.style.boxShadow = '0 0 ' + blur + 'px ' + accent + alpha + ', inset 0 0 60px rgba(0,0,0,0.8)';
  glow.style.transform = 'scale(' + (1 + kickEff * 0.04) + ')';

  var armAngle = isPlaying ? -22 : -52;
  arm.style.transform = 'rotate(' + armAngle + 'deg)';

  stylus.setAttribute('fill', accent);
  stylus.setAttribute('opacity', isPlaying ? '0.95' : '0.3');
});
