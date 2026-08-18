// Stained glass - a fixed voronoi window of panes with lead cames between
// them. Each pane belongs to a frequency band and glows with it; kicks
// send a light-through-the-window bloom drifting across the whole pane
// field. The window never changes - only the light does.

var panes = null;

function buildPanes(w, h) {
  var rng = 424242;
  var rand = function () { rng = (rng * 1103515245 + 12345) & 0x7fffffff; return rng / 0x7fffffff; };
  var sites = [];
  for (var i = 0; i < 26; i++) sites.push([rand() * w, rand() * h, i % 8, rand()]);
  // Rasterless voronoi: sample a coarse grid, build polygon-ish cells by
  // just drawing each cell as the set of grid squares nearest its site.
  var cell = Math.max(8, Math.floor(Math.min(w, h) / 46));
  var cols = Math.ceil(w / cell), rows = Math.ceil(h / cell);
  var owner = new Int16Array(cols * rows);
  for (var gy = 0; gy < rows; gy++) {
    for (var gx = 0; gx < cols; gx++) {
      var px = gx * cell + cell / 2, py = gy * cell + cell / 2;
      var best = 0, bd = Infinity;
      for (var s2 = 0; s2 < sites.length; s2++) {
        var dx = px - sites[s2][0], dy = py - sites[s2][1];
        var d = dx * dx + dy * dy;
        if (d < bd) { bd = d; best = s2; }
      }
      owner[gy * cols + gx] = best;
    }
  }
  return { sites: sites, owner: owner, cols: cols, rows: rows, cell: cell };
}

var bloomX = -0.2;

viz.on('frame', function (f) {
  var ctx = f.ctx;
  if (!ctx) return;
  var w = f.size.width, h = f.size.height;
  if (w <= 0 || h <= 0) return;
  var dt = f.dt;

  if (!panes || panes.w !== w || panes.h !== h) { panes = buildPanes(w, h); panes.w = w; panes.h = h; }

  ctx.fillStyle = 'rgba(4,4,7,1)';
  ctx.fillRect(0, 0, w, h);

  if (f.onset.kick > 0.6 && bloomX < -0.1) bloomX = 0;
  if (bloomX >= 0) {
    bloomX += dt * 0.7;
    if (bloomX > 1.3) bloomX = -0.2;
  }

  var bins = viz.bins(8);
  var A = f.theme.accent, B = f.theme.accent2;
  var cell = panes.cell;
  for (var gy = 0; gy < panes.rows; gy++) {
    for (var gx = 0; gx < panes.cols; gx++) {
      var s = panes.owner[gy * panes.cols + gx];
      var site = panes.sites[s];
      var e = bins[site[2]];
      var base = 0.10 + e * 0.6;
      // The travelling bloom brightens panes near its x position.
      if (bloomX >= 0) {
        var d = Math.abs(gx / panes.cols - bloomX);
        base += Math.max(0, 0.5 - d * 3);
      }
      ctx.fillStyle = site[3] < 0.5 ? A : B;
      ctx.globalAlpha = Math.min(1, base) * (0.5 + site[3] * 0.5);
      ctx.fillRect(gx * cell, gy * cell, cell + 1, cell + 1);
    }
  }
  ctx.globalAlpha = 1;

  // Lead cames: dark boundary between differently-owned neighbours.
  ctx.fillStyle = 'rgba(10,10,12,0.95)';
  for (var gy2 = 0; gy2 < panes.rows; gy2++) {
    for (var gx2 = 0; gx2 < panes.cols; gx2++) {
      var o = panes.owner[gy2 * panes.cols + gx2];
      if (gx2 + 1 < panes.cols && panes.owner[gy2 * panes.cols + gx2 + 1] !== o) {
        ctx.fillRect((gx2 + 1) * cell - 1.5, gy2 * cell, 3, cell);
      }
      if (gy2 + 1 < panes.rows && panes.owner[(gy2 + 1) * panes.cols + gx2] !== o) {
        ctx.fillRect(gx2 * cell, (gy2 + 1) * cell - 1.5, cell, 3);
      }
    }
  }
});
