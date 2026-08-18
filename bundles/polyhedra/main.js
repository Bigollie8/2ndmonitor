// Polyhedra - a wireframe icosahedron spinning in 3D. Edges light up per
// frequency band, bass inflates the solid, kicks kick the spin axis, and
// treble frosts the vertices.

var PHI = (1 + Math.sqrt(5)) / 2;
var VERTS = [
  [-1, PHI, 0], [1, PHI, 0], [-1, -PHI, 0], [1, -PHI, 0],
  [0, -1, PHI], [0, 1, PHI], [0, -1, -PHI], [0, 1, -PHI],
  [PHI, 0, -1], [PHI, 0, 1], [-PHI, 0, -1], [-PHI, 0, 1],
];
var EDGES = [];
(function () {
  // Icosahedron edges = vertex pairs at the minimal distance.
  var min = Infinity;
  for (var i = 0; i < 12; i++) for (var j = i + 1; j < 12; j++) {
    var d = Math.hypot(VERTS[i][0] - VERTS[j][0], VERTS[i][1] - VERTS[j][1], VERTS[i][2] - VERTS[j][2]);
    min = Math.min(min, d);
  }
  for (var a = 0; a < 12; a++) for (var b = a + 1; b < 12; b++) {
    var d2 = Math.hypot(VERTS[a][0] - VERTS[b][0], VERTS[a][1] - VERTS[b][1], VERTS[a][2] - VERTS[b][2]);
    if (d2 < min * 1.01) EDGES.push([a, b]);
  }
})();

var rx = 0.4, ry = 0, rz = 0.1;
var vx = 0.3, vy = 0.55, vz = 0.12;

function rot(p, ax, ay, az) {
  var x = p[0], y = p[1], z = p[2];
  var c = Math.cos(ax), s = Math.sin(ax), y1 = y * c - z * s, z1 = y * s + z * c;
  c = Math.cos(ay); s = Math.sin(ay);
  var x2 = x * c + z1 * s, z2 = -x * s + z1 * c;
  c = Math.cos(az); s = Math.sin(az);
  return [x2 * c - y1 * s, x2 * s + y1 * c, z2];
}

viz.on('frame', function (f) {
  var ctx = f.ctx;
  if (!ctx) return;
  var w = f.size.width, h = f.size.height;
  if (w <= 0 || h <= 0) return;
  var dt = f.dt;

  ctx.fillStyle = 'rgba(5,6,10,0.32)';
  ctx.fillRect(0, 0, w, h);

  // Kicks jolt the spin; it decays back to a lazy tumble.
  if (f.onset.kick > 0.5) {
    vx += (Math.random() - 0.5) * f.onset.kick * 4;
    vy += (Math.random() - 0.5) * f.onset.kick * 4;
  }
  vx += (0.3 - vx) * dt * 0.8;
  vy += (0.55 - vy) * dt * 0.8;
  rx += vx * dt; ry += vy * dt; rz += vz * dt;

  var scale = Math.min(w, h) * (0.16 + f.bands.bass * 0.055);
  var cx = w / 2, cy = h / 2;
  var cam = 4.2;
  var bins = viz.bins(EDGES.length);

  var proj = [];
  for (var v = 0; v < 12; v++) {
    var p = rot(VERTS[v], rx, ry, rz);
    var zz = cam - p[2];
    proj.push([cx + (p[0] / zz) * scale * cam, cy + (p[1] / zz) * scale * cam, p[2]]);
  }

  // Edges sorted back-to-front so nearer ones draw brighter on top.
  var order = EDGES.map(function (e, i) { return [i, (proj[e[0]][2] + proj[e[1]][2]) / 2]; })
    .sort(function (a, b) { return a[1] - b[1]; });
  for (var o = 0; o < order.length; o++) {
    var i2 = order[o][0];
    var e2 = EDGES[i2];
    var eNear = (order[o][1] + 2) / 4; // 0 back .. 1 front
    var energy = bins[i2];
    ctx.strokeStyle = i2 % 2 ? f.theme.accent : f.theme.accent2;
    ctx.globalAlpha = 0.15 + eNear * 0.35 + energy * 0.5;
    ctx.lineWidth = 1 + energy * 2.6 + eNear;
    ctx.beginPath();
    ctx.moveTo(proj[e2[0]][0], proj[e2[0]][1]);
    ctx.lineTo(proj[e2[1]][0], proj[e2[1]][1]);
    ctx.stroke();
  }
  // Vertices: treble frost.
  ctx.fillStyle = '#fff';
  for (var v2 = 0; v2 < 12; v2++) {
    ctx.globalAlpha = 0.3 + f.bands.treble * 0.7 * ((proj[v2][2] + 2) / 4);
    ctx.beginPath();
    ctx.arc(proj[v2][0], proj[v2][1], 1.6 + f.bands.treble * 1.6, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
});
