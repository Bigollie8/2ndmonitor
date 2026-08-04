import type { ProjectFn } from './MapView';

// ─────────────────────────────────────────────────────────────────────────────
// The user's saved-location dot, shared by every MapView host (0.7.3).
// Radar shipped without one through 0.7.2 because it was the only host that
// never passed an `overlay` at all; the other three each hand-rolled an
// identical dot. One helper so a fifth host can't drift again.
//
// Streamer mode needs no handling here: MapView returns before invoking the
// overlay callback when `redacted` is set, so this never runs in that mode.
// ─────────────────────────────────────────────────────────────────────────────

export const HOME_DOT_RADIUS = 3;
export const HOME_DOT_FILL = 'rgba(255,255,255,0.6)';

/** Fill the anchor dot at `lat`/`lon`. Leaves `ctx.fillStyle` set — every
 *  caller sets its own fill before drawing anything else. */
export function drawHomeDot(
  ctx: CanvasRenderingContext2D,
  projectPt: ProjectFn,
  lat: number,
  lon: number,
): void {
  const home = projectPt(lat, lon);
  ctx.fillStyle = HOME_DOT_FILL;
  ctx.beginPath();
  ctx.arc(home.x, home.y, HOME_DOT_RADIUS, 0, Math.PI * 2);
  ctx.fill();
}
