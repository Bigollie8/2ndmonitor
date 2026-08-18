// Bounce - one physics ball per frequency band. Each band's energy feeds
// its ball's bounce impulse, so the low end thuds tall slow arcs while the
// hats jitter the small fast ones. Balls squash on floor contact.

var N = 16;
var balls = null;

viz.on('frame', function (f) {
  var ctx = f.ctx;
  if (!ctx) return;
  var w = f.size.width, h = f.size.height;
  if (w <= 0 || h <= 0) return;
  var dt = f.dt;
  var floor = h * 0.9;

  if (!balls) {
    balls = [];
    for (var i = 0; i < N; i++) balls.push({ y: floor, vy: 0, squash: 0 });
  }

  ctx.fillStyle = 'rgba(6,7,11,0.42)';
  ctx.fillRect(0, 0, w, h);

  var bins = viz.bins(N);
  var slot = w / N;
  var G = h * 2.6; // gravity scaled to the canvas so arcs read the same at any size

  for (var b = 0; b < N; b++) {
    var ball = balls[b];
    var r = slot * 0.30 * (1 - b / N * 0.45) + 3;
    var e = bins[b];
    // On the floor, band energy launches the ball; in the air it only adds
    // a little lift, so arcs stay ballistic and readable.
    if (ball.y >= floor - 0.5 && e > 0.12) {
      ball.vy = -Math.sqrt(2 * G * (e * e) * h * 0.55);
    }
    ball.vy += G * dt;
    ball.y += ball.vy * dt;
    if (ball.y > floor) {
      ball.squash = Math.min(1, Math.abs(ball.vy) / (h * 1.6));
      ball.y = floor;
      ball.vy = 0;
    }
    ball.squash = Math.max(0, ball.squash - dt * 6);

    var cx = slot * (b + 0.5);
    var sx = 1 + ball.squash * 0.5, sy = 1 - ball.squash * 0.4;
    // Shadow: tighter and darker the closer the ball is.
    var height01 = Math.min(1, (floor - ball.y) / (h * 0.6));
    ctx.fillStyle = 'rgba(0,0,0,' + (0.5 - height01 * 0.35).toFixed(3) + ')';
    ctx.beginPath();
    ctx.ellipse(cx, floor + r * 0.5, r * (0.9 + height01 * 0.7), r * 0.22, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = b % 2 ? f.theme.accent : f.theme.accent2;
    ctx.beginPath();
    ctx.ellipse(cx, ball.y - r * sy, r * sx, r * sy, 0, 0, Math.PI * 2);
    ctx.fill();
    // Specular dot.
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.beginPath();
    ctx.arc(cx - r * 0.3, ball.y - r * sy - r * 0.35, r * 0.16, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.beginPath();
  ctx.moveTo(0, floor + 1);
  ctx.lineTo(w, floor + 1);
  ctx.stroke();
});
