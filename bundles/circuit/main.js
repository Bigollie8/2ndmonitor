// Circuit board - a fixed PCB of traces and pads. Signal pulses enter on
// beats and travel the traces; each region's pads glow with its frequency
// band. The board itself never moves - only the electricity does.

var net = null;
var pulses = [];

function buildNet(w, h) {
  // Manhattan traces: a grid of nodes, each connected right/down with a
  // dogleg. Deterministic from a fixed seed so the board is stable.
  var rng = 12345;
  var rand = function () { rng = (rng * 1103515245 + 12345) & 0x7fffffff; return rng / 0x7fffffff; };
  var cols = 10, rows = 6;
  var nodes = [], edges = [];
  for (var r = 0; r < rows; r++) {
    for (var c = 0; c < cols; c++) {
      nodes.push({
        x: (c + 0.5 + (rand() - 0.5) * 0.4) / cols * w,
        y: (r + 0.5 + (rand() - 0.5) * 0.4) / rows * h,
        band: Math.floor(c / cols * 8),
        pad: rand() < 0.35,
      });
    }
  }
  for (var i = 0; i < nodes.length; i++) {
    var c2 = i % cols, r2 = Math.floor(i / cols);
    if (c2 + 1 < cols && rand() < 0.75) edges.push([i, i + 1]);
    if (r2 + 1 < rows && rand() < 0.55) edges.push([i, i + cols]);
  }
  return { nodes: nodes, edges: edges, cols: cols, rows: rows };
}

viz.on('frame', function (f) {
  var ctx = f.ctx;
  if (!ctx) return;
  var w = f.size.width, h = f.size.height;
  if (w <= 0 || h <= 0) return;
  var dt = f.dt;

  if (!net || net.w !== w || net.h !== h) { net = buildNet(w, h); net.w = w; net.h = h; }

  ctx.fillStyle = 'rgba(4,8,6,0.5)';
  ctx.fillRect(0, 0, w, h);

  var bins = viz.bins(8);

  // Traces: dim copper, doglegged.
  ctx.strokeStyle = 'rgba(120,150,130,0.22)';
  ctx.lineWidth = 1.4;
  for (var e = 0; e < net.edges.length; e++) {
    var a = net.nodes[net.edges[e][0]], b = net.nodes[net.edges[e][1]];
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }

  // Pads glow with their column's band energy.
  for (var n = 0; n < net.nodes.length; n++) {
    var nd = net.nodes[n];
    var eBand = bins[nd.band];
    if (nd.pad) {
      ctx.fillStyle = f.theme.accent2;
      ctx.globalAlpha = 0.15 + eBand * 0.75;
      ctx.beginPath();
      ctx.arc(nd.x, nd.y, 3.4 + eBand * 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = 'rgba(120,150,130,0.5)';
      ctx.lineWidth = 1;
      ctx.stroke();
    } else {
      ctx.fillStyle = 'rgba(120,150,130,0.35)';
      ctx.fillRect(nd.x - 1.2, nd.y - 1.2, 2.4, 2.4);
    }
  }

  // Pulses: kicks inject at the left edge, snares anywhere; they run edge
  // to edge along the doglegs.
  if (f.onset.kick > 0.5) {
    pulses.push({ e: Math.floor(Math.random() * net.edges.length), q: 0, v: 1.6 + f.onset.kick * 2.4, hot: true });
  }
  if (f.onset.hat > 0.5 && Math.random() < 0.6) {
    pulses.push({ e: Math.floor(Math.random() * net.edges.length), q: 0, v: 3.2, hot: false });
  }
  for (var p = pulses.length - 1; p >= 0; p--) {
    var pu = pulses[p];
    pu.q += pu.v * dt;
    if (pu.q >= 1) {
      // Hop to a connected edge or die.
      var end = net.edges[pu.e][1];
      var nexts = [];
      for (var e2 = 0; e2 < net.edges.length; e2++) if (net.edges[e2][0] === end) nexts.push(e2);
      if (nexts.length && Math.random() < 0.8) { pu.e = nexts[Math.floor(Math.random() * nexts.length)]; pu.q = 0; }
      else { pulses.splice(p, 1); continue; }
    }
    var a2 = net.nodes[net.edges[pu.e][0]], b2 = net.nodes[net.edges[pu.e][1]];
    // Position along the dogleg (horizontal leg then vertical leg).
    var lh = Math.abs(b2.x - a2.x), lv = Math.abs(b2.y - a2.y), tot = lh + lv || 1;
    var dHoriz = Math.min(pu.q * tot, lh);
    var dVert = Math.max(0, pu.q * tot - lh);
    var px = a2.x + Math.sign(b2.x - a2.x) * dHoriz;
    var py = a2.y + Math.sign(b2.y - a2.y) * dVert;
    ctx.fillStyle = pu.hot ? f.theme.accent : '#fff';
    ctx.globalAlpha = 0.95;
    ctx.beginPath();
    ctx.arc(px, py, pu.hot ? 3 : 1.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  if (pulses.length > 80) pulses.splice(0, pulses.length - 80);
});
