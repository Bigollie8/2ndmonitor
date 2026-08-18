// Sonar - a submarine display: the sweep arm rotates at a steady rate,
// and contacts appear where it crosses energy. Bearing maps to frequency
// (low aft, high forward), range maps to how loud that band is - so a
// bass-heavy track paints close contacts astern. Honest instrument
// styling: range rings, bearing ticks, contact decay like a real PPI.

var sweep = 0;
var contacts = [];

viz.on('frame', function (f) {
  var ctx = f.ctx;
  if (!ctx) return;
  var w = f.size.width, h = f.size.height;
  if (w <= 0 || h <= 0) return;
  var dt = f.dt;

  ctx.fillStyle = 'rgba(3,8,6,0.12)'; // slow phosphor fade
  ctx.fillRect(0, 0, w, h);

  var cx = w / 2, cy = h / 2;
  var R = Math.min(w, h) * 0.44;

  // Static graticule: range rings + bearing ticks.
  ctx.strokeStyle = 'rgba(90,200,140,0.16)';
  ctx.lineWidth = 1;
  for (var r = 1; r <= 4; r++) {
    ctx.beginPath();
    ctx.arc(cx, cy, R * r / 4, 0, Math.PI * 2);
    ctx.stroke();
  }
  for (var b = 0; b < 12; b++) {
    var ba = b / 12 * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(ba) * R * 0.96, cy + Math.sin(ba) * R * 0.96);
    ctx.lineTo(cx + Math.cos(ba) * R, cy + Math.sin(ba) * R);
    ctx.stroke();
  }

  // The sweep: constant angular rate (a real sonar doesn't speed up with
  // the music) - what changes is what it FINDS.
  var prev = sweep;
  sweep += dt * 1.5;
  var bins = viz.bins(48);
  // Sample the bands the arm crossed this frame.
  var steps = Math.max(1, Math.ceil((sweep - prev) / 0.05));
  for (var s = 0; s < steps; s++) {
    var a = prev + (sweep - prev) * (s / steps);
    var bandIdx = Math.floor(((a % (Math.PI * 2)) / (Math.PI * 2)) * 48) % 48;
    var e = bins[bandIdx];
    if (e > 0.3) {
      contacts.push({
        a: a,
        r: R * (0.25 + (1 - e) * 0.7),  // louder = closer
        life: 1,
        strong: e > 0.65,
      });
    }
  }

  // Contacts decay like phosphor blips.
  for (var c = contacts.length - 1; c >= 0; c--) {
    var ct = contacts[c];
    ct.life -= dt * 0.5;
    if (ct.life <= 0) { contacts.splice(c, 1); continue; }
    var px = cx + Math.cos(ct.a) * ct.r, py = cy + Math.sin(ct.a) * ct.r;
    ctx.fillStyle = ct.strong ? f.theme.accent : 'rgba(120,230,160,1)';
    ctx.globalAlpha = ct.life * (ct.strong ? 0.95 : 0.6);
    ctx.beginPath();
    ctx.arc(px, py, ct.strong ? 3.2 : 2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  if (contacts.length > 400) contacts.splice(0, contacts.length - 400);

  // The arm with its wake.
  for (var wk = 0; wk < 14; wk++) {
    var wa = sweep - wk * 0.035;
    ctx.strokeStyle = 'rgba(120,230,160,' + ((1 - wk / 14) * 0.25).toFixed(3) + ')';
    ctx.lineWidth = wk === 0 ? 1.6 : 1;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(wa) * R, cy + Math.sin(wa) * R);
    ctx.stroke();
  }

  // Bearing readout, honest to the arm.
  ctx.font = '10px "JetBrains Mono", ui-monospace, monospace';
  ctx.fillStyle = 'rgba(120,230,160,0.75)';
  ctx.textAlign = 'left';
  ctx.fillText('BRG ' + String(Math.round(((sweep % (Math.PI * 2)) / (Math.PI * 2)) * 360)).padStart(3, '0'), 10, h - 12);
  ctx.fillText('CONTACTS ' + contacts.length, 10, h - 26);
});
