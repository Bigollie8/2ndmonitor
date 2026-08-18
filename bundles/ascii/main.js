// ASCII terminal - the spectrum rendered the way a terminal would: a
// character raster where density maps energy ( .:-=+*#%@ ), a blinking
// cursor, and a status line with honest numbers. Kicks invert the bottom
// row like a hit on an old TTY.

var RAMP = ' .:-=+*#%@';
var invert = 0;
var cursorT = 0;

viz.on('frame', function (f) {
  var ctx = f.ctx;
  if (!ctx) return;
  var w = f.size.width, h = f.size.height;
  if (w <= 0 || h <= 0) return;
  cursorT += f.dt;
  if (f.onset.kick > 0.55) invert = 0.18;
  invert = Math.max(0, invert - f.dt);

  ctx.fillStyle = 'rgba(4,6,5,0.55)';
  ctx.fillRect(0, 0, w, h);

  var cw = 9, ch = 14;
  var cols = Math.max(8, Math.floor((w - 20) / cw));
  var rows = Math.max(6, Math.floor((h - 44) / ch));
  var bins = viz.bins(cols);

  ctx.font = '12px "JetBrains Mono", ui-monospace, monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';

  for (var c = 0; c < cols; c++) {
    var e = bins[c];
    var lit = Math.round(e * rows);
    for (var r = 0; r < rows; r++) {
      var fromBottom = rows - 1 - r;
      if (fromBottom >= lit) continue;
      // Density climbs toward the column's top-most lit cell.
      var frac = lit > 0 ? fromBottom / lit : 0;
      var chIdx = Math.min(RAMP.length - 1, 1 + Math.round((1 - frac) * (RAMP.length - 2)));
      var isPeakRow = fromBottom === lit - 1;
      var inv = invert > 0 && r === rows - 1;
      ctx.fillStyle = inv ? '#0a0f0a'
        : isPeakRow ? '#fff'
        : (frac < 0.3 ? f.theme.accent : f.theme.accent2);
      if (inv) {
        ctx.fillStyle = f.theme.accent;
        ctx.fillRect(10 + c * cw, 10 + r * ch, cw, ch);
        ctx.fillStyle = '#0a0f0a';
      }
      ctx.globalAlpha = inv ? 1 : 0.45 + (1 - frac) * 0.55;
      ctx.fillText(RAMP[chIdx], 10 + c * cw, 10 + r * ch);
    }
  }
  ctx.globalAlpha = 1;

  // Status line: honest numbers, then the blinking cursor.
  var statusY = 10 + rows * ch + 8;
  ctx.fillStyle = 'rgba(120,220,150,0.8)';
  var line = '$ viz --bands ' + cols +
    '  lvl=' + f.level.toFixed(2) +
    '  bass=' + f.bands.bass.toFixed(2) +
    '  mid=' + f.bands.mid.toFixed(2) +
    '  treb=' + f.bands.treble.toFixed(2);
  ctx.fillText(line, 10, statusY);
  if (Math.floor(cursorT * 2.2) % 2 === 0) {
    var tw = ctx.measureText(line).width;
    ctx.fillRect(14 + tw, statusY, cw, ch - 2);
  }
});
