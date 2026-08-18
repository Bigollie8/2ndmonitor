// Beatgrid — musically-synced visuals from Spotify's audio analysis (0.9.10).
//
// When f.sync carries the current track's beat/bar/section grid (manifest
// declares "sync": true), everything on screen fires ON the music's actual
// grid: cells flip per BEAT, the frame flashes per BAR, the palette rotates
// per SECTION, and base brightness follows the section's mastered loudness —
// none of which an amplitude-reactive visual can know.
//
// HONEST FALLBACK: without a grid (Spotify not connected, nothing playing,
// or the analysis endpoint unavailable — it is deprecated for newer API
// apps), the same visuals run from the live onset envelopes and the corner
// tag reads "live" instead of "synced".

var COLS = 12, ROWS = 6;
var cells = new Float32Array(COLS * ROWS); // per-cell energy, decays
var cellHue = new Float32Array(COLS * ROWS);
var barFlash = 0;
var beatCount = 0;
var lastBeatIdx = -1, lastBarIdx = -1, lastSectionIdx = -1, lastTrack = null;
var hueBase = 0;
var rng = 1;
function rand() { rng = (rng * 1103515245 + 12345) & 0x7fffffff; return rng / 0x7fffffff; }

function accRGB(hex) {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}
function mix(a, b, t) {
  return 'rgb(' + Math.round(a[0] + (b[0] - a[0]) * t) + ',' + Math.round(a[1] + (b[1] - a[1]) * t) + ',' + Math.round(a[2] + (b[2] - a[2]) * t) + ')';
}

/** Index of the last event with start <= t (binary search), or -1. */
function eventAt(events, t) {
  var lo = 0, hi = events.length - 1, ans = -1;
  while (lo <= hi) {
    var mid = (lo + hi) >> 1;
    if (events[mid].start <= t) { ans = mid; lo = mid + 1; } else { hi = mid - 1; }
  }
  return ans;
}

function fireBeat(strength) {
  beatCount++;
  // Light a random handful of cells — more when the beat is confident/loud.
  var n = 2 + Math.floor(strength * 5);
  for (var i = 0; i < n; i++) {
    var idx = Math.floor(rand() * COLS * ROWS);
    cells[idx] = Math.min(1, 0.6 + strength * 0.5);
    cellHue[idx] = rand();
  }
}

viz.on('frame', function (f) {
  var ctx = f.ctx;
  if (!ctx) return;
  var w = f.size.width, h = f.size.height;
  if (w <= 0 || h <= 0) return;
  var dt = Math.max(0.001, Math.min(0.1, f.dt || 0.016));
  var A = accRGB(f.theme.accent), B = accRGB(f.theme.accent2);

  var sync = f.sync;
  var pos = f.playback ? f.playback.position : null;
  var synced = !!(sync && sync.beats && sync.beats.length && pos != null && f.playback.playing);
  var sectionLoud = 0.6, tempo = 0;

  if (synced) {
    if (sync.track_id !== lastTrack) { lastTrack = sync.track_id; lastBeatIdx = -1; lastBarIdx = -1; lastSectionIdx = -1; }
    var bi = eventAt(sync.beats, pos);
    if (bi !== lastBeatIdx && bi >= 0) {
      lastBeatIdx = bi;
      fireBeat(Math.max(0.35, sync.beats[bi].confidence));
    }
    var bri = eventAt(sync.bars, pos);
    if (bri !== lastBarIdx && bri >= 0) { lastBarIdx = bri; barFlash = 1; }
    if (sync.sections && sync.sections.length) {
      var si = eventAt(sync.sections, pos);
      if (si !== lastSectionIdx && si >= 0) { lastSectionIdx = si; hueBase = (hueBase + 0.23) % 1; }
      if (si >= 0) {
        var sec = sync.sections[si];
        // Section loudness is mastered dBFS, roughly -30..0 → 0..1.
        sectionLoud = Math.max(0.15, Math.min(1, 1 + sec.loudness / 30));
        tempo = sec.tempo;
      }
    }
  } else {
    // Live fallback: onsets stand in for the grid.
    if (f.onset.kick > 0.5) fireBeat(f.onset.kick * 0.8);
    if (f.onset.snare > 0.6) barFlash = Math.max(barFlash, 0.7);
    sectionLoud = 0.3 + f.level * 0.7;
  }

  // ── paint ──────────────────────────────────────────────────────────────
  ctx.fillStyle = 'rgba(4,5,8,0.32)';
  ctx.fillRect(0, 0, w, h);

  var pad = Math.min(w, h) * 0.06;
  var gw = (w - pad * 2) / COLS, gh = (h - pad * 2) / ROWS;
  for (var r = 0; r < ROWS; r++) {
    for (var c = 0; c < COLS; c++) {
      var i = r * COLS + c;
      var e = cells[i];
      cells[i] = Math.max(0, e - dt * 1.8);
      var x = pad + c * gw, y = pad + r * gh;
      var inset = gw * 0.1;
      if (e > 0.02) {
        var t = (cellHue[i] + hueBase) % 1;
        ctx.fillStyle = mix(A, B, t);
        ctx.globalAlpha = e * sectionLoud;
        ctx.fillRect(x + inset, y + inset, gw - inset * 2, gh - inset * 2);
      } else {
        ctx.fillStyle = 'rgba(255,255,255,0.04)';
        ctx.globalAlpha = 1;
        ctx.fillRect(x + inset, y + inset, gw - inset * 2, gh - inset * 2);
      }
    }
  }
  ctx.globalAlpha = 1;

  // Bar flash: a frame around the grid that fires on every bar line.
  if (barFlash > 0.01) {
    ctx.strokeStyle = mix(A, B, hueBase);
    ctx.lineWidth = 2 + barFlash * 5;
    ctx.globalAlpha = barFlash * 0.9;
    ctx.strokeRect(pad * 0.55, pad * 0.55, w - pad * 1.1, h - pad * 1.1);
    ctx.globalAlpha = 1;
    barFlash = Math.max(0, barFlash - dt * 2.5);
  }

  // Corner tag: the honest status.
  ctx.font = '10px "JetBrains Mono", ui-monospace, monospace';
  ctx.textAlign = 'left';
  ctx.fillStyle = synced ? f.theme.accent : 'rgba(255,255,255,0.4)';
  var tag = synced
    ? ('● synced' + (tempo > 0 ? ' · ' + Math.round(tempo) + ' bpm' : ''))
    : '○ live';
  ctx.fillText(tag, pad * 0.55, h - pad * 0.35);
});
