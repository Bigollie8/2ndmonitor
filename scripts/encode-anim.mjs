// Frames -> animated WebP via ffmpeg.
//
// ffmpeg is a MAINTAINER-machine dependency: it runs only in this capture
// script, never in the app or on the server. When it is missing the right
// behavior is to skip animation and SAY SO -- not to fail the batch (the
// stills are still worth having) and not to stay quiet (shipping stills
// while the operator believes they shipped animation is the worse failure).
import { spawnSync } from 'node:child_process';

export function ffmpegAvailable() {
  return spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0;
}

export function encodeWebp(frameDir, outFile, fps) {
  const res = spawnSync('ffmpeg', [
    '-y', '-framerate', String(fps),
    '-i', `${frameDir}/%03d.png`,
    '-loop', '0', '-quality', '70', '-compression_level', '5',
    outFile,
  ], { stdio: 'inherit' });
  return res.status === 0;
}
