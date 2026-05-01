/** YouTube video player that fills the viz tile.
 *
 *  Mounted by VizHero when `videoEnabled && videoUrl` — replaces the audio
 *  visualizer surface entirely. We keep this scoped to YouTube for v1; the
 *  component shape can grow into a discriminated-union `source` prop later
 *  (Twitch, direct mp4, local files) without touching call sites.
 *
 *  Audio: the iframe is NOT muted (per user choice). Whatever the video plays
 *  goes out the speakers and feeds back into the WASAPI loopback the same way
 *  any other system audio does — meaning when the user toggles back to the
 *  audio viz, the bars react to whatever the video was playing.
 */

interface VideoPlayerProps {
  /** Raw URL pasted by the user — any common YouTube format. */
  url: string;
}

/** Extracts the 11-char video ID from common YouTube URL shapes.
 *  Returns null when the URL doesn't look like a YouTube link.
 *
 *  Handles:
 *    - https://www.youtube.com/watch?v=ID
 *    - https://youtube.com/watch?v=ID&t=42s
 *    - https://youtu.be/ID
 *    - https://www.youtube.com/embed/ID
 *    - https://www.youtube.com/shorts/ID
 *    - https://m.youtube.com/watch?v=ID
 *  Pure function — easy to unit-test if we ever add tests.
 */
export function parseYouTubeId(raw: string): string | null {
  const url = raw.trim();
  if (!url) return null;

  // Tolerate users pasting a bare 11-char ID.
  if (/^[A-Za-z0-9_-]{11}$/.test(url)) return url;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  const host = parsed.hostname.toLowerCase().replace(/^www\./, '').replace(/^m\./, '');
  if (host === 'youtu.be') {
    const id = parsed.pathname.slice(1).split('/')[0] ?? '';
    return /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
  }
  if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    // /watch?v=ID
    const v = parsed.searchParams.get('v');
    if (v && /^[A-Za-z0-9_-]{11}$/.test(v)) return v;
    // /embed/ID or /shorts/ID or /v/ID
    const m = parsed.pathname.match(/^\/(embed|shorts|v)\/([A-Za-z0-9_-]{11})/);
    if (m && m[2]) return m[2];
  }
  return null;
}

/** Builds the embed URL. Autoplay + relevant-only related videos + minimal
 *  branding. NOT muted — see file-header note. */
function buildEmbedUrl(id: string): string {
  const params = new URLSearchParams({
    autoplay: '1',
    rel: '0',
    modestbranding: '1',
    playsinline: '1',
  });
  return `https://www.youtube.com/embed/${id}?${params.toString()}`;
}

export function VideoPlayer({ url }: VideoPlayerProps) {
  const id = parseYouTubeId(url);

  if (!id) {
    return (
      <div style={{
        position: 'absolute', inset: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: '#06070a', color: 'rgba(255,255,255,0.55)',
        fontFamily: '"JetBrains Mono", ui-monospace, monospace',
        fontSize: 13, padding: 24, textAlign: 'center', lineHeight: 1.5,
      }}>
        <div>
          <div style={{ fontSize: 32, marginBottom: 12 }}>📺</div>
          <div style={{ color: 'rgba(255,255,255,0.85)', fontWeight: 600, marginBottom: 4 }}>
            No video URL set
          </div>
          <div>Paste a YouTube URL in the Tweaks panel → Video.</div>
        </div>
      </div>
    );
  }

  return (
    <iframe
      key={id}
      title="Embedded video"
      src={buildEmbedUrl(id)}
      allow="autoplay; encrypted-media; picture-in-picture; fullscreen; clipboard-write"
      allowFullScreen
      referrerPolicy="strict-origin-when-cross-origin"
      style={{
        position: 'absolute', inset: 0,
        width: '100%', height: '100%',
        border: 'none', background: '#000',
      }}
    />
  );
}
