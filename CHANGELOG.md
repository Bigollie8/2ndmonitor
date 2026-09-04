# Changelog

All notable changes to 2ndMonitor are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/); versions follow semver.

## [Unreleased]

## [0.9.17] - 2026-09-04

### Added
- **Layout undo, redo and recovery checkpoints.** Edit mode now has Undo/Redo controls and Ctrl/⌘ Z / Ctrl/⌘ Shift Z shortcuts. Dragging, resizing, adding and removing tiles have separate histories for each profile and orientation. Hub keeps the arrangement before your first edit as a recovery checkpoint; use Save checkpoint to replace it and Restore checkpoint to recover it after a restart. Undo history holds the last 50 edits for this session.
- **Live data status.** Settings → Data status shows active polling tiles, the last successful check, setup requirements, unavailable or stale data, and Retry now. Failed checks keep the last good data visible, and switching a tile's source clears the old source's timestamp.
- **Opt-in automatic profiles.** Open the profile switcher and expand Automatic profiles and display recall to add exact process-name rules. A match must stay stable for four seconds. Manual profile selection pauses automation for 30 minutes, with Resume now available; editing and dialogs pause switching too.
- **Remember profiles per display.** In the same panel, Remember this display saves the active profile and UI scale. Enabled automation recalls them when the window enters that display. Unrecognized displays keep the current profile; saved tile positions survive temporary fitting to a smaller viewport.
- **A more useful first run.** Onboarding now includes an audio activity check and optional Discord / Claude tiles. New Work profiles start with music, mixer, notes, system stats and a clock; existing profiles are preserved.
- **Preview shared setups.** Profile and setup imports show the arrangement, required bundles and connections before applying. Missing bundles remain visible as placeholders for installation or restoration through the library. New shared exports omit personal content, locations and bundle configuration, keeping the arrangement and selected display options.

### Fixed
- Settings cannot save before hydration succeeds. Unreadable settings pause saving and show a retryable error; serialized writes keep slower saves from overwriting newer edits. Save failures are visible too.
- Older onboarding location searches can no longer replace results for a newer query.
- Polling payloads that report an error no longer count as successful data updates.

## [0.9.16] - 2026-09-04

### Fixed
- **Less repeated work while music plays.** The music meters and mixer glow
  now paint only when fresh audio arrives, at up to 30 updates per second
  (or a lower custom visualizer cap). High-refresh displays no longer make
  these small decorations rewrite the same values on every display frame.
- **A quieter app in the tray.** Data tiles now use the app's native
  visibility signal, so hiding to the tray pauses polling and returning
  catches up on overdue requests. System monitoring samples every five
  seconds while hidden and resumes its normal one-second cadence on return.
- **Less allocation and copying in audio capture.** Capture now appends
  whole packets into circular buffers, and analysis reuses FFT scratch,
  mixing, spectrum, and waveform storage. Stereo channel order, sample
  windows, and FFT output are covered by regression tests.
- **Visualizer sizing no longer polls the layout every frame.** Sandbox
  surfaces measure on resize and reuse those dimensions while animating;
  existing visualizer bundles keep the same frame-message format.
- **Fewer background folder scans.** Content scans run every ten seconds
  normally and thirty seconds in the tray. The Scripted authoring surface
  retains two-second hot reload, and app-driven installs, removals, and
  saves request a prompt refresh instead of waiting for the idle interval.

### Changed
- GitHub release descriptions and updater notes now include the actual
  version's changelog. Discord continues to receive the release notes and
  a fixes spotlight through the existing tag-triggered webhook workflow.

## [0.9.15] - 2026-08-30

### Added
- **Your visualizer presets can back up to the cloud.** Signed in to the
  marketplace, the preset picker and Settings → Visualizer gain a
  "Back up / Restore" pair for the presets you dropped into the presets
  folder. Back up uploads new and changed files; Restore downloads what's
  missing on this device and **never overwrites a local file** — a preset
  that differs on both sides stays local and is reported, not clobbered.
  Manual by design: nothing syncs in the background

### Fixed
- **No more yesterday's track on launch.** Windows reports the last app
  that held media focus even when it's long paused, so the Now Playing
  tile showed whatever you had open last time. A session now has to
  actually play once this run before it appears; a track already playing
  when the app starts shows immediately, and pausing behaves exactly as
  before
- **Idle CPU: the visualizer now rests when the music does.** The audio
  side has idled during silence since 0.9.6, and capped Performance
  modes already pause the visualizer outright — but with Performance
  mode Uncapped, the no-music idle animation ran at the display's raw
  frame rate for as long as the window was visible (measured at ~500
  draws/second, forever, on a high-refresh monitor). The idle animation
  now keeps full smoothness for 10 s after audio ends, then steps down
  to 30 fps, and settles at 12 fps after two minutes of quiet — any
  sound restores full rate instantly. Verified in the packaged build
  with the perf HUD: 500/s → 30/s → 12/s. This is the main suspect
  behind the reported CPU "sawtooth" while the app just sits open, and
  it cuts the churn that fed it either way
- **Alt-tab could collapse a profile to a single tile.** A minimized or
  freshly restored window can briefly report an absurd viewport (we
  measured 160×28), and the monitor re-fit introduced in 0.9.13 would
  clamp every tile against it — corrupting the saved layout so only one
  tile survived. Implausible viewport reports are now ignored, the re-fit
  refuses to run against a tiny or hidden window, and layouts that were
  already corrupted heal themselves on next launch

## [0.9.14] - 2026-08-21

### Added
- **News tile: choose your region.** A UK / US switch in the tile header
  picks the publisher set: UK stays BBC + The Guardian (the default, so
  nothing changes for existing tiles), US adds The New York Times + NPR
  across all eight categories. The header and source badges now reflect
  the actual publishers. Every new feed was captured live and is covered
  by parser tests
- **Crashes are reportable now.** A root-level error boundary means a
  fault in any surface shows what broke (with a Reload button) instead
  of a black window; every dashboard tile has its own boundary, so one
  broken tile is one broken tile; and Rust panics are written to a
  persistent crash log with timestamp, thread and location. Find the
  file in Settings → Advanced → Crash log (with a Copy-path button) and
  attach it to a report

### Fixed
- **The visualizer's idle animation is smooth.** The no-music fallback
  used hard on/off beat gates, so idle motion snapped instead of
  breathing; the kick, snare and hat are now continuous envelopes. Live
  audio is untouched

### Audited
- A stability pass across the frontend and Rust side (see
  `docs/STABILITY_AUDIT.md`): every event-listener effect carries proper
  cleanup, the 130+ `unwrap()`s are almost entirely test code, the
  remaining production `expect` is a static-response invariant, and
  WebGL contexts live inside sandbox iframes that release on unmount

## [0.9.13] - 2026-08-19

### Changed
- **The app wears the Glasswing design language by default.** Graded
  glass tile panes over the Ink palette, Vapor hairlines, Schibsted
  Grotesk type (bundled), 4px controls, and a Glasswing accent palette
  (Glass Cyan + Iris Violet) — implemented from the studio's design
  system as surface-theme tokens, so Editorial and Frameless keep their
  own systems and the classic look survives untouched as **Hub** in
  Settings → Appearance → Surface
- **Todos read top-down in the order you wrote them.** First-entered
  stays on top, done still sinks — and you can now drag the ⠿ handle to
  reorder tasks; the arrangement persists

### Fixed
- **Major CPU reduction with tiles over the visualizer.** Measured on a
  live report of ~300% CPU: eight glass tiles blurring an animating
  backdrop cost ~110% of a core in GPU compositing versus ~37% without —
  re-blurring every frame was the dominant term. Tiles overlapping the
  visualizer now drop their backdrop blur automatically (they keep it
  everywhere else, and liquid-glass mode is exempt by choice). All 59
  visualizer bundles were also benchmarked: their draw code was already
  cheap, the compositing was the burn
- **The "offline" badge no longer reads as broken.** The
  zero-permissions badge on marketplace cards now says "no network" —
  it always meant "cannot phone home," not "unavailable"
- **Moving the window between monitors re-fits the layout.** A different
  resolution, DPI or orientation now re-clamps the saved arrangement to
  the new screen (debounced, no thrash while dragging); each
  orientation's layout stays separate and intact
- **macOS stops re-asking for audio permission.** The tap-liveness check
  misread quiet audio as a dead capture and rebuilt the tap — and every
  rebuild is a fresh macOS permission prompt. Liveness now uses the
  device's real error signal, with a rebuild cooldown as a second
  guard. First-time prompts and real device changes behave as before

### Added
- **Discord Rich Presence.** With Discord connected, your profile shows
  2ndMonitor and what you're listening to, with a live timestamp —
  updates on track change, clears when you turn it off (Settings →
  System, on by default), and stays quiet when Discord isn't running

## [0.9.12] - 2026-08-18

### Fixed
- **New tiles really do land on top of the visualizer now.** 0.9.8's fix
  ordered the tiles correctly, but the visualizer's internal overlay
  layers were escaping their tile and painting above every neighbour
  anyway. Each tile now contains its own layers, so stacking follows
  tile order — a freshly added tile is fully visible immediately
- **Editing is smooth around the visualizer.** The (potentially 4K)
  visualizer draw loop now freezes for the whole edit-mode session, so
  selecting, dragging and resizing tiles no longer competes with it.
  Leaving edit mode resumes the animation instantly
- **Tapping a queued song no longer wipes your queue.** Skipping to a
  song in Up Next used to replace all playback with just that track.
  Inside a playlist or album it now jumps within the same context, and
  otherwise it steps the real queue forward to your pick — everything
  after it still plays. Search results' play button is unchanged
- **Signing out really signs you out everywhere.** Registering a new
  account after signing out no longer shows the previous account's
  email, handle, avatar, stats or lists anywhere in the profile UI
- **Portrait layouts no longer overlap.** On vertical monitors the
  default arrangement squeezed the Todos tile under the system monitor
  row and overran the bottom bar; the portrait column is rebalanced and
  verified clean at 1080×1920 and scaled portrait resolutions

### Added
- **AMD and Intel GPU stats.** The system monitor's GPU cell no longer
  requires NVIDIA: with LibreHardwareMonitor (or OpenHardwareMonitor)
  running — the same app that already feeds temperatures and power —
  GPU utilization now appears for any vendor, labelled accordingly.
  NVIDIA machines keep their richer NVML readings unchanged

## [0.9.11] - 2026-08-18

### Added
- **Twenty new visualizers.** Scenes: Fireplace, Rainstorm, Jellyfish,
  Lasers, Ink drop, Galaxy, Koi pond, Circuit board, Smoke, Polyhedra,
  Meteor shower, Stained glass, Double helix. Spectrum: Fountain, ASCII
  terminal, Hex grid, Bounce. Waveform: Pulse (a real ECG sweep), Braids.
  Instruments: Sonar (a constant-rate PPI sweep that paints contacts
  where the energy is). Every one ships as a seed bundle, runs sandboxed
  with no permissions, and was verified drawing real content in the
  harness before release

### Changed
- **The visualizer gallery is organized now.** Six titled shelves —
  Engines, Spectrum, Waveform, Instruments, Scenes, Ambient — replace
  the flat wall of cards, and every bundle is filed: the ten previously
  undocumented visualizers got real descriptions, and honest measuring
  instruments (vectorscope, console, chroma, beatlab, note bars, sonar)
  now live together under Instruments

### Fixed
- **Full quality audit of all existing visualizers.** Every bundle was
  executed against real synthetic audio and eyeballed: no errors, no
  blank renders, and the instruments verified accurate — the BPM readout
  matches the test signal exactly, the key detector names the right key,
  and the vectorscope correctly collapses to a labelled vertical line on
  mono sources. No defects found; nothing needed patching

## [0.9.10] - 2026-08-18

### Added
- **Shader Lab — a Shadertoy-compatible GLSL visualizer.** A new engine
  bundle that runs fragment shaders written against the standard
  Shadertoy contract, with the classic 512×2 audio texture (FFT row,
  waveform row) as iChannel0 — the single largest audio-reactive visual
  ecosystem, one text file per visual. Eight original shaders ship built
  in (Spectrum Tunnel, Waveform Ribbon, Bass Bloom, Kaleido Pulse,
  Plasma Drift, Starburst EQ, Liquid Bars, Night City) — click the
  surface to switch, left third goes back, and your pick sticks. Only
  original shaders are bundled: Shadertoy's site default licence is
  CC BY-NC-SA, so ports are on the porter
- **Beatgrid — visuals synced to the music's actual structure.** With
  Spotify connected, cells flip on the track's analysed beats, the frame
  flashes on bar lines, and the palette turns over per section with
  brightness following each section's mastered loudness — timing no
  amplitude-reactive visual can know. Where the analysis isn't available
  (Spotify's analysis API is closed to newer API apps) it falls back
  honestly to live onset detection and says so in its corner tag
- **Sync channel for visualizer bundles.** Any bundle can declare
  `"sync": true` to receive the current Spotify track's beat/bar/section
  grid as `f.sync` — polled only while such a bundle is on screen,
  delivered once per track, cached per track on the Rust side
- Upgraders also receive the corrected Vectorscope and Console 1.0.2
  bundles that were previously only fixed on the marketplace

## [0.9.9] - 2026-08-18

### Changed
- **Surface themes now restyle the controls too.** Buttons, switches,
  selects, segmented pickers, text fields and slider thumbs follow each
  theme's design language instead of looking identical everywhere:
  Editorial sets them like print — squared corners (even the switch
  knobs), visible warm rules, flat ink-wash fills — while Frameless
  drops every control border and lets soft-rounded fills carry the
  shape. Hub stays exactly the classic look, and liquid glass is
  unaffected

## [0.9.8] - 2026-08-18

### Added
- **Gold price tile.** Live 24K spot gold in both USD per troy ounce and
  USD per gram (per-gram is spot ÷ 31.1035 — spot IS fine gold), on the
  same quote engine and 60-second cadence as the Stocks tile
- **48 Laws of Power tile.** One concisely-worded law at a time, rotating
  on your chosen cadence (every 3/4/6/12 hours or daily — set it in edit
  mode). Which law is showing survives restarts instead of reshuffling,
  and rotation always moves to a different law
- **Share setups, not just profiles.** The profile switcher gains
  "Export setup…" — pick any subset of the current arrangement's tiles
  (or keep all selected for the whole layout) and save it as a setup
  file — and "Import setup…", which ADDS a shared setup's tiles into
  your current profile without touching anything you already have. Same
  privacy guarantees as profile files: saved map locations and unsafe
  keys are stripped, imported tiles get fresh identities
- **Todo reminders and timestamps.** Hover a todo → ⏰ sets a due time;
  upcoming todos show amber, overdue red, and when the moment arrives
  the tile shows an in-app banner (once per deadline — editing the time
  re-arms it). Every todo also carries a tiny fine-print note of when it
  was written. New items still go on top

### Changed
- **Each surface theme is now its own design system, not a recolor.**
  Editorial is "set in print": flat near-opaque ink cards, no blur, no
  shadows, square corners, ruled hairlines carrying the structure, serif
  display type. Frameless is "air": card material gone entirely, content
  floats on the ground. Hub remains exactly the classic look, and liquid
  glass keeps its blur on top of any theme
- **Glow now means something.** Resting tiles no longer emit an ambient
  accent glow — cards sit on neutral elevation, and glow is reserved for
  real state cues: edit-mode selection, Claude "needs you" dots, Discord
  speaking rings, live audio meters
- **The visualizer strip is gone.** The row of mode buttons that crowded
  the top of the visualizer is replaced by a single compact button
  carrying the current style's name — click it for the full gallery.
  V-key cycling and Stream Deck actions are unchanged
- **Creating an account signs you in.** Registering with an invite (or on
  a dev-mail server) flows straight into a signed-in session — no more
  retyping into an empty form or reopening the panel; the whole app
  reflects sign-in/sign-out instantly now

### Fixed
- **The Claude Code tile now tells the truth.** It read only the last
  transcript line — which is often bookkeeping — so working sessions
  showed idle, long builds showed "Permission needed", and sessions
  killed mid-tool pulsed NEEDS YOU for a day. It now finds the last
  meaningful entry, knows which sessions have a live process, never
  flags read-only tools or long-running commands as permission prompts,
  and keeps the 15-second prompt heuristic only where it's accurate
- **F11 means fullscreen.** The window can no longer be dragged around by
  its header while in fullscreen; leaving F11 restores normal dragging
- **New tiles land where you can see them.** Adding a tile used to drop
  it into the vinyl backdrop's footprint (and sometimes behind it). The
  visualizer backdrop now always paints beneath other tiles and no
  longer blocks the empty-slot search, so a fresh tile appears clear of
  your real tiles without any manual rescue

## [0.9.7] - 2026-08-15

### Added
- **Surface themes — the whole app can wear a different look.** Settings →
  Appearance → Surface now offers three: **Hub** (the classic look,
  untouched), **Editorial** (ink-black ground, ruled hairlines, serif
  display type on the clock, forecast temperature and track titles — built
  to the Ficus design), and **Frameless** (card edges removed entirely;
  content floats on the ground). Themes restyle every tile, bar and panel
  at once, persist across restarts, and a corrupted saved value safely
  falls back to the classic look. Liquid glass composes on top: glass ON
  keeps its translucency while the theme's hairlines and type still apply.
  A light "Paper" surface from the same design is deferred — most text in
  the app is hard-coded for dark grounds and needs its own migration first
- **Ficus accent palette** — the Editorial design's sage green + warm
  amber, available to any surface

### Changed
- **MilkDrop follows the music now.** Auto-advance used to blind-rotate to
  a random preset every 30 seconds. It now switches when the song changes
  and when the music's energy genuinely shifts — a drop hitting, a quiet
  bridge — with a cooldown so busy mixes don't strobe, and picks presets
  in a way that keeps similar families recurring at similar energies. A
  flat mix still advances eventually, and without any live audio the old
  30-second cadence remains. The manual ‹ ⚄ › controls and the auto
  toggle are unchanged, and a manual pick is never immediately overridden.
  (Engine checked: bundled Butterchurn 2.6.7 is the latest stable release;
  the only newer publish is a 3.0 beta, not taken)

### Fixed
- **Stale lyrics no longer float over the visualizer.** Watching Netflix
  or a Firefox video after listening to music could leave the previous
  song's lyrics crawling over the screen — cached lyrics are now shown
  only while the playing track is the one they belong to
- **Settings stays a usable size at any Interface scale.** The panel
  counter-scales against the UI zoom, so turning the scale up no longer
  balloons the Settings dialog (and turning it down no longer shrinks it)
- **The media hub sits where it should at any Interface scale.** The
  embedded player's position and size were computed in unscaled pixels,
  so any zoom but 100% pushed it off-center; it now converts through the
  live zoom factor at creation and on every reposition, including when
  the scale changes while it's open

## [0.9.6] - 2026-08-14

### Changed
- **The Windows title bar is gone — the app's own bar is the title bar
  now.** No more double-bar stack: drag the window by the top bar, double
  click it to maximize, and native minimize / maximize / close buttons live
  at its right edge, styled like the rest of the app. Close still respects
  "Close to tray". (macOS keeps its native traffic lights)
- **Settings window keeps one size.** Clicking between categories used to
  grow and shrink the whole dialog with the row count; it's now a constant
  frame and the content scrolls inside

### Added
- **Onboarding asks where you are.** A new setup step searches your city
  (same engine as the Settings location picker) so weather, radar, sun,
  air quality and pollen start on YOUR location instead of everyone
  defaulting to Knoxville. Skippable — the default stays, clearly labelled.
  Existing installs are untouched

### Fixed
- **High CPU while doing nothing.** Reproduced at ~111% of one core with
  the app idle: the audio engine analyzed pure silence 60 times a second
  and broadcast all-zero spectrums that kept every meter — and the GPU —
  repainting forever. After ~2 seconds of silence the engine now goes to
  sleep (waking within a tenth of a second when sound returns), pauses
  entirely while the app is hidden in the tray, and the meters settle
  instead of redrawing zeros. Music reactivity is unchanged
- **Interface scale is smooth now.** Dragging the slider fired a full-page
  relayout on every notch — the reported choppiness. The percentage tracks
  your drag live and the zoom applies once, when you settle
- **Interface scale reaches the media player.** The embedded browser
  player renders in its own surface, which never inherited the zoom — it
  now scales with everything else, including when it's opened after the
  scale was set

## [0.9.5] - 2026-08-13

### Fixed
- **The idle RAM leak.** Two real causes found by instrumenting the running
  app. The big one: every now-playing update captured a fresh copy of the
  album-art styling (~240KB) inside React's update machinery, and with a
  paused media session those copies accumulated forever — measured at
  ~7MB/minute of permanently-retained memory, matching the reported
  multi-gigabyte climb over hours. Unchanged updates are now skipped
  outright before any of that machinery runs. The second: the Claude Code
  session scanner re-read entire session transcripts (often multi-MB) every
  5 seconds, forever, even with no Claude tile on the dashboard — it now
  runs only while the tile is mounted, reads only the tail of each file,
  and skips files that haven't changed. Also bounded as hygiene: the
  marketplace preview cache (now LRU), the mixer's per-app icon cache, and
  a duplicated internal event listener
- **Discord Connect can no longer get stuck on "Authorizing…".** A wrong
  Application ID means Discord never redirects back, and the app waited
  five silent minutes. There's now a Cancel button the moment authorization
  starts, and the automatic timeout is 2 minutes with a plain-language
  error telling you exactly what to check (the ID, and the OAuth2 redirect
  entry). Cancel or timeout, you can edit the ID and retry immediately
- **Discord voice list updates when you were already in the call.** If the
  app started while you were sitting in a voice channel, the member list
  filled once and then froze — mutes, joins, and leaves never arrived
  (and Ctrl+R couldn't fix it). The app now subscribes to live voice events
  for the channel it discovers at startup, same as when you join one later
- **Discord tile setup fits 1080p.** The not-connected view's paddings were
  sized for 1440p and crowded/overflowed the tile on 1080p monitors
- **YouTube's timeline no longer flickers away while playing.** Browser
  media sessions sometimes report a zero duration/position mid-playback;
  the app took that at face value and hid the progress bar until the next
  good report. Transient zeros for the same video now keep the last known
  values — pausing, resuming, and real track changes behave exactly as
  before
- **Shoutbox report spam capped.** One person can now hold at most 2 open
  reports per content type; the third is politely refused ("a moderator
  will get to them"). Reporting the same thing twice still quietly counts
  once, and resolved reports free the slot

### Added
- **Interface scale.** Settings → Appearance → Interface scale (75%–150%):
  resizes the entire interface instantly and persists. Turn it down on a
  1080p monitor to fit more; turn it up for readability. 100% is exactly
  today's appearance

## [0.9.4] - 2026-08-12

### Added
- **Pick a song.** The Up next tab (and the detached Up-next tile) can now
  actually choose music, not just skip: tap any queued track to jump
  straight to it, or use the new search box to find any song — tap to play
  it now, or + to add it to the queue. Spotify only (it's the only service
  with a public playback API); playing/queueing needs Spotify Premium, and
  the app says so plainly instead of failing silently. If Spotify asks for
  a new permission, the existing Reconnect banner handles it — most people
  connected recently won't need to
- **Search works on Free accounts** — only starting playback is
  Premium-limited, and the message explains exactly that

### Fixed
- **Vectorscope finally shows stereo — the real reason it never did.** The
  fixes shipped over the last three releases were fine; they just never
  reached anyone. The app's built-in content installer skipped any
  visualizer that was already installed, no matter how old — so a
  vectorscope installed before the stereo support existed kept its ancient
  version forever, showing the mono vertical line on every audio source.
  Seeded content now upgrades itself when the app ships a newer version
  (it never downgrades, and content you removed stays removed). One update
  and the stereo cloud, width and correlation meters come alive
- **1080p monitors: tiles no longer hide under the top and bottom bars.**
  Layouts are stored as fractions of the screen, but the bars are fixed
  pixels — so on 1080p (and especially laptops at 125% display scaling)
  the top row slid up to 18px under the top bar and bottom tiles poked
  below the bottom bar. Tiles now shrink just enough to clear the bars,
  keeping their arrangement — and at 1440p nothing changes at all
- **Creator profile edits save now.** Two compounding bugs: a profile
  without a display name couldn't save ANY field (the editor always sent
  the empty name and the server rejected the whole update), and the error
  message hid in a corner styled exactly like "Saved.". Display names are
  now optional — your handle shows where one isn't set — failures appear
  as a proper red banner with the actual reason, and a save either applies
  completely or not at all

## [0.9.3] - 2026-08-10

### Fixed
- **F11 fullscreen no longer leaves a thin uncovered strip.** On some
  setups the window settled a few pixels off its monitor (8px left / 1px
  top in the report that cracked it) because Windows keeps an invisible
  frame on undecorated windows. The fullscreen loop now measures where the
  window actually landed and corrects the next attempt, so the picture
  truly covers the monitor edge to edge — including monitors left of the
  primary. Starting fullscreen from a maximized window also works now, and
  leaving it restores the maximized state.
- **Stereo visualizers get real stereo from per-app audio.** Capturing a
  specific app (or several) used to flatten the sound to mono before the
  visualizers saw it, so the vectorscope and console styles drew a single
  vertical line. Per-app capture now carries true left/right all the way
  through, on Windows and macOS — a genuinely mono source still reads as
  the centered line it should be.
- **Applying a visualizer no longer seems to require the fullscreen
  preview.** Clicking a gallery card has always applied that style, but
  nothing said so. Cards now show an Apply button on hover, and the gallery
  header says it outright.

## [0.9.2] - 2026-08-06

### Added
- **System-wide audio equalizer.** A new section in the Audio mixer tile
  with ten adjustable frequency bands (31 Hz–16 kHz, ±12 dB), an on/off
  bypass, and a Flat reset — and it shapes what your speakers actually
  play, not just the visualizer. It works by driving **Equalizer APO**, the
  free, standard Windows system EQ: install it once (and run its
  Configurator for your output device), and 2ndMonitor writes your curve
  straight into it, applying within a blink of a slider move. A built-in
  preamp automatically offsets boosts so cranking a band can't distort.
  Your curve persists across restarts. Without Equalizer APO installed the
  section explains and links to it; on macOS the section doesn't appear.
  (True system EQ without such a component would require shipping an audio
  driver — this is the honest version.)
- **Total power draw on the System tile.** A watts figure (CPU package +
  graphics card power) now sits in the tile's bottom strip, from
  LibreHardwareMonitor sensors or the NVIDIA driver. Machines with no
  power sensor simply show nothing — never a fake 0 W
- **CPU and GPU temperatures, big and glanceable.** Both reporters were
  right: the temps were buried in the tiny strip at the tile's bottom
  edge. They now appear as large bold readouts directly under the CPU and
  GPU usage numbers, in your chosen unit, amber past 85°C and red past
  95°C. Board and drive temps remain in the strip
- **Music controls on every tab.** Previous / play-pause / next now stay
  visible on the Lyrics and Up-next tabs (and on the detached Lyrics and
  Up-next tiles) as a compact footer — no more switching back to Now just
  to skip a track. Works for every media source, not only Spotify

### Fixed
- **Authorize once, stay authorized.** The "should only need to allow it
  one time" report. Both Spotify and Discord stored their sign-in
  correctly but treated a momentary network failure during token refresh
  as if access had been revoked: Spotify dropped to the Connect form
  (and, because its tokens refresh hourly, practically every launch with
  slow Wi-Fi did this); Discord went further and erased the stored sign-in
  outright. Now only a genuine revocation by the service ends a session —
  network blips show a soft "unreachable — retrying" note and recover by
  themselves, sessions self-heal in the background, and a race between two
  simultaneous refreshes (which could genuinely kill a Spotify session)
  is prevented outright

## [0.9.1] - 2026-08-05

### Added
- **Detachable music tiles.** The Now-playing tile's three tabs — Player,
  Up next, and Lyrics — can now each be added as their own standalone tile
  from the Tile Library. Put synced lyrics on one edge of the monitor and
  your queue on another; every detached tile behaves exactly like its tab
  (same transport controls, same data), and the combined tile is unchanged
- **Custom performance mode.** Performance settings gained a fifth mode
  that exposes the three knobs the presets bundle: visualizer frame-rate
  cap (up to 165 fps or uncapped), render resolution, and audio update
  rate. Changes apply live, persist across restarts, and survive switching
  to a preset and back
- **Equalizer visualizer.** The classic segmented LED spectrum — 20 bands
  of stacked blocks with instant attack, slow release, and peak-hold caps
  that hang then fall, coloured from your theme. In the visualizer gallery
  like any other style. Note: this is a *visual* equalizer; if you wanted
  controls that change how the audio itself sounds (bass/boost etc.), tell
  us — that's a different, bigger feature, since the app currently only
  listens to audio and never modifies it

### Fixed
- **F11 fullscreen, round 4.** Two changes for the machines where a gap
  still shows: fullscreen now targets the monitor under the window's
  *center* (a window straddling two displays used to fullscreen onto the
  one holding its top-left corner — which looks exactly like the reported
  left/top gap), and the settle loop tries five passes instead of three.
  If the window still refuses the monitor's exact rectangle, a card now
  appears on screen with the precise numbers and a Copy button — please
  paste that into the Discord thread; it will pinpoint the cause on your
  setup

## [0.9.0] - 2026-08-05

The community release. 2ndMonitor's marketplace had 419 bundles and no people
in it — you could download somebody's work but never find out who they were.
This adds the person behind the work, and everything that follows from that.

### Added
- **You are somebody now**: claim a handle, upload a profile picture, write a
  bio, pick a colour, and every bundle you publish carries your name. Your
  creator page shows your work grouped into carousels — layouts, tiles,
  visualizers, presets — instead of one endless grid. Without a picture you
  get an identicon generated from your handle, so everybody has a face from
  the moment they arrive
- **Follow the people whose work you like**, and a "New from creators you
  follow" shelf leads the store's Discover page. Favourite anything with a
  star; the count is public, but that it was *you* is nobody else's business
- **A community window**: a searchable directory of every creator, a forum
  for questions that need an answer, and a shoutbox down the side for the
  ones that don't. Every bundle also has its own discussion board
- **Comments** on every marketplace item, plain text and nothing else — no
  markdown, no links, no formatting. One decision that stops abuse of all
  three kinds at once
- **Notifications** for follows, comments on your work, replies to your
  topics and mentions of your name, with an unread count on the bell. Nobody
  contributes into silence
- **Publish a layout**, not just a tile or a visualizer. Share the whole
  arrangement of your second monitor; installing one offers to fetch anything
  you are missing first. Published layouts carry the STRUCTURE only — every
  tile's settings are stripped, so your location, your calendar and your keys
  stay yours
- **Badges** (founder, moderator, verified…) granted by staff, shown wherever
  you appear
- **A staff panel** for moderators and admins: search every account, suspend,
  rename, grant badges and roles, work the report queue, and read a full
  audit log of every action taken — with an Undo button on the ones that can
  be reversed

### Changed
- Your profile and the community moved OUT of Settings and into the top bar.
  Becoming a creator is a place you go, not a preference you configure
- Registration happens in the app now. Until this release there was no way to
  create an account at all without using the command line

### Fixed
- **Auto-updates and downloads work again.** Making the source repository
  private also made its GitHub release assets private, and the updater sends
  no credentials — so every update check got a 404 ("can't reach the update
  server") and the installer links stopped resolving. Artifacts are now
  published to a separate public repository that holds nothing but releases,
  and the update manifest points there. The release workflow verifies the
  endpoint anonymously before finishing, so this cannot break silently again.
  **Installs on 0.8.1 or earlier have the old address compiled in and will not
  find this update — they need a manual reinstall**
- **The store no longer goes black when the marketplace is reachable.** The
  server answers one endpoint with a wrapper the app did not expect, and
  reading it crashed the whole store mid-render. It only ever appeared when
  things started *working*, which is why it survived two releases
- **Hiding reported content actually hides it.** Reports filed from the forum
  or shoutbox were labelled as comments, so hiding one updated nothing and
  cheerfully said it had worked. Every moderation action now refuses to
  report success when it changed nothing

### Security
- Profile pictures are accepted on their actual bytes rather than their
  claimed type, resized in the app before upload — which also strips the
  location data phones bury in photographs
- Blocking someone now covers following and notifications, not just what you
  see, so a mention cannot route around it
- Rate limits on every write surface, and one open report per person per
  target so nobody can bury the moderation queue

## [0.8.8] - 2026-08-05

Identical in content to 0.8.7, which never shipped: its build was stopped on
a compile error in macOS-only code (a log line added for the permission-prompt
investigation below), fixed here.

### Fixed
- **Aircraft Overhead no longer throttles for some users.** The tile relied
  on OpenSky's anonymous access, which grants a small daily budget per IP
  address — anyone behind a shared or VPN'd address was sharing an
  exhausted budget and saw the limit message permanently. Flight data now
  comes from adsb.lol, a community feed with no key and no per-IP budget;
  OpenSky remains only as an automatic fallback
- **Weather radar on slow connections no longer glitches.** When radar
  imagery arrived slower than the animation played (the New Zealand
  report), frames flashed empty because each one drew only what had already
  downloaded. The map now keeps showing the previous frame's imagery in any
  spot the new frame hasn't loaded yet, and downloads the next frame ahead
  of the animation
- **F11 fullscreen, third round.** On some machines the window settles a few
  pixels away from where it was told to go, leaving the reported gap on the
  left and top. Fullscreen now measures where the window actually landed,
  reapplies the correct rectangle up to three times, and — if the system
  still refuses — logs the exact numbers so a beta tester's console output
  pinpoints the cause. Also fixed: exiting fullscreen restores the window's
  true previous frame instead of a slightly-shifted one
- **macOS: the system-audio recording prompt should stop reappearing.**
  macOS re-asks for permission when it thinks a *different* device is being
  tapped. The app compared the default output device by its numeric ID,
  which macOS reassigns freely (sleep/wake, AirPods reconnecting, display
  changes), so a routine re-check looked like a new device and restarted
  the tap — triggering a fresh permission prompt roughly every 20 minutes
  for some setups. Devices are now compared by their stable unique ID, and
  every tap creation is logged so testers can confirm from Console.app

### Performance
- **Full pre-0.9.0 performance audit.** Every native command, background
  thread, polling loop, and animation path was reviewed. Measured result:
  an edit-mode tile drag costs 1 map repaint and zero long tasks (was 246
  repaints before the 0.7.3 pass — that fix has held through eight releases)
- **Marketplace tiles can no longer freeze the app.** Five native operations
  still did their network work on the interface thread — worst of all the
  fetch that every web-backed marketplace tile repeats on its own schedule,
  which could hold the entire app frozen for up to ten seconds per poll on
  a slow connection. Installing a bundle, signing in, rating, and posting a
  review had the same flaw. All five now run off-thread; this is the last
  of the bug class behind the 0.6.3 Content Library freeze
- **Visualizers now keep time by the clock, not the frame rate.** The
  spectrum engine assumed 25 frames per second while actually running at
  your display cap, so adaptive gain, beat detection decay, and the
  no-audio demo tempo all ran about 2.4x too fast at the default 60fps
  setting — and faster still on high-refresh monitors. Everything is now
  computed from real elapsed time, identical on every monitor and
  Performance Mode
- **Slightly faster startup.** A system-monitor warm-up pause ran on the
  main thread during launch and delayed first paint by 200ms; it now runs
  in the background
- **Stereo audio data is now sent only to visualizers that use it.** The
  two-channel waveform stream — roughly double the audio traffic — was
  broadcast whenever any visualizer ran, though only the Vectorscope and
  Loudness console read it. Those two now declare it and everyone else
  stops paying for it
- **Closing one visualizer no longer freezes the waveform in another.**
  Any visualizer being closed switched the waveform stream off globally,
  even with other visualizers still on screen — a long-standing latent bug
  the audit surfaced

## [0.8.6] - 2026-08-05

### Added
- **News ticker tile**: BBC and Guardian headlines, no API key, with
  category chips — Top stories, World, Politics, Business, Tech, Science,
  Sports, Entertainment. Two publishers interleaved so neither dominates;
  click a headline to open the story
- **Adaptive gain for the visualizer**: reactivity no longer depends on how
  loud the app is. Quiet playback is boosted toward a target level; loud
  playback renders exactly as before, and silence is never amplified into a
  light show. Settings → Visualizer → Adaptive gain, on by default
- **Discord tile scrolls**: all 20 retained notifications instead of 4, and
  every voice-call member instead of the first 8

### Fixed
- **The Marketplace black screen, actually fixed this time.** The error
  panel added in 0.8.5 finally produced a stack, and it pointed somewhere
  new: the marketplace server wraps its collections list in an envelope the
  app didn't expect, and the mismatch crashed the store roughly half a
  second after opening — the moment the network reply arrived. The app now
  accepts both shapes and refuses malformed data outright. This bug never
  reproduced outside the installed app, which is why two earlier fixes
  missed it
- **Opening Settings no longer stops your music.** Panels used to close the
  browser player to keep themselves visible, which killed playback and lost
  your signed-in session; reopening reloaded the site from scratch — the
  "settings freezes the app" report. The player is now simply made invisible
  behind panels: it cannot cover them, and playback and session continue
  underneath
- **F11 covers the whole monitor.** Fullscreen used to leave a gap on the
  left on some monitor/scale combinations — a DPI-conversion error, fixed by
  using raw pixel coordinates end to end
- **The auto-hide top bar works in fullscreen.** The invisible strip that
  reveals it sat exactly inside the window's hidden resize border, which
  swallowed the mouse; fullscreen windows are now non-resizable, which
  removes the border

## [0.8.5] - 2026-08-05

### Fixed
- **A problem in the Marketplace no longer blanks the whole app.** The app had
  no crash guard anywhere, so any fault while a panel was open took the entire
  interface down to a black screen with no message. Panels now show what went
  wrong, with Try again and Close, and everything else keeps running
- **Searching the Marketplace no longer crashes it.** Some listings have no
  description, and searching one of those threw an error — which, before the
  change above, is exactly what blanked the screen
- **Snap, Grid and Guides remember your choice.** All three reset to on every
  time you reopened edit mode; they now persist

### Changed
- **Phone notifications setup rewritten.** The name oversold what the tile
  does: it shows the latest message published to an ntfy topic, and ntfy does
  not forward your phone's notifications by itself. Getting that to work needs
  an automation app on the phone (MacroDroid or Tasker on Android; iOS has no
  equivalent and can only receive). The setup text now says so, names the
  field people usually mis-copy, and gives a one-line test so you can tell a
  misconfigured tile from one nothing is publishing to

## [0.8.4] - 2026-08-05

### Added
- **Two new visualizers for people who want the data**: **Vectorscope** shows
  the stereo image as engineers see it — a tall trace means mono, a wide one
  means spacious — with live correlation and width meters. **Loudness console**
  gives you L/R meters with peak-hold, a rolling level history and live peak,
  RMS, crest-factor and correlation numbers. Both install themselves when you
  open 0.8.4
- **Arrow keys move tiles in edit mode**: select a tile and nudge it with the
  arrow keys, or hold Shift for pixel-level adjustment

### Fixed
- **The Marketplace no longer goes black after a moment** (regression in
  0.8.3). 0.8.3 started keeping the browser tile alive behind panels instead of
  closing it, so switching sources wouldn't lose your session — but the browser
  runs in a native window that sits above everything the app draws, and when
  moving it aside didn't take, it ended up covering the Marketplace. Panels
  that fill the screen now close it properly again; tile edit settings still
  keep your session, which is what that change was for
- **Scrolling quickly through visualizers no longer freezes the app**: each
  preview that came into view immediately started a full live render, so a
  fast scroll started and stopped dozens of them in a row. Previews now wait
  until you actually settle on them
- **Connecting Discord tells you when the ID is wrong**: pasting the wrong
  value sent you to Discord only to be met with "unknown application", which
  never said what was wrong. The tile now checks it first and names the
  mistake — the Public Key and the Application ID sit next to each other in
  Discord's portal and are easy to mix up. Setup steps rewritten to say
  exactly which field to copy

### Note on the stereo visualizers
Vectorscope and Loudness console read both audio channels, which the app now
captures. Two things are expected rather than faults: a **per-app audio
source** is combined to mono before the app sees it, so the vectorscope will
show a vertical line and correlation will read 1.00 — pick the system-wide
source for a true stereo image. And the console is labelled **RMS**, not LUFS,
because that is genuinely what it measures.

## [0.8.3] - 2026-08-05

### Added
- **Search and filters are back for installed content**: the library has a
  search box again, plus Visualizers / Tiles / Presets filters with counts.
  When a search hides everything it now says so and offers to clear the
  filters, instead of looking empty
- **Settings shows which build you're running** — System → Version

### Fixed
- **The visualizer reacts at normal listening volume**: the audio pipeline
  threw away anything quieter than a fairly loud signal *before* the
  sensitivity slider was applied, so at around half volume there was nothing
  left for sensitivity to amplify — turning it up did nothing. The floor is
  now 20 dB lower, so quiet sources come through and the slider works across
  the range. Loud content reads a touch stronger than before; turn sensitivity
  down if you preferred the old feel
- **F11 no longer turns the app grey**: going fullscreen made Windows drop the
  window's transparency, taking liquid glass with it. Fullscreen now works a
  different way that keeps glass intact. One trade-off: while fullscreen the
  app stays above other windows, which is what keeps the taskbar covered
- **Liquid glass is restored when you come back to the app** after clicking
  away. Windows still dims the effect while the app is in the background —
  that part is the OS, not a setting
- **Opening tile edit settings no longer restarts what you're watching**: any
  panel used to close the browser tile entirely, so reopening reloaded the
  page and lost your signed-in session. The player is now moved aside instead
  of closed
- **Update failures say what actually went wrong** instead of always claiming
  the update server was unreachable
- **Release announcements list the fixes**, not just new features — a
  fixes-only release previously announced nothing

## [0.8.2] - 2026-08-04

### Fixed
- **Aircraft overhead stops running out of API budget**: the tile asked
  OpenSky for traffic every minute, which is far more than their free tier
  allows in a day — so it used up the whole day's allowance within a few hours
  and then showed "too many requests" until the next reset. It now checks
  every five minutes, which fits comfortably inside the allowance, and when
  the limit *is* hit it says so plainly instead of claiming the problem will
  clear in a minute
- **Weather radar no longer glitches while the loop plays**: the map shared
  one image cache between the background map and the radar frames, and a
  two-hour loop needs more images than that cache could hold — so playing it
  pushed out the map underneath, which then had to be re-downloaded over and
  over. The two now have their own caches
- **Zooming a map no longer stops it following**: one scroll wheel click used
  to permanently detach a map from what it was tracking, so the ISS tile
  stopped following the station and the radar and aircraft maps stopped
  centring on your location. Zooming now keeps following; only dragging the
  map takes manual control, and Recentre still returns you to the default view
- **Switching what's playing in the browser tile releases its memory**: moving
  from one site to another could leave the previous page alive in the
  background instead of closing it, so memory climbed as you switched

### Changed
- **Licence: 2ndMonitor is now under the Business Source License 1.1.** You can
  still read, modify and redistribute the source, and you can use the app for
  personal use and internal business use. What you can't do is offer it to
  other people as a commercial product or a hosted service. Each version turns
  into plain MIT on **2030-08-04**, or four years after that version was first
  published, whichever comes first — so nothing is locked away permanently
- **Versions up to and including 0.8.1 stay MIT.** That grant can't be
  withdrawn and isn't being withdrawn; `LICENSE-MIT` keeps the terms alongside
  the new licence for exactly that reason
- The app now declares its licence everywhere it should — the installer shows
  it, and the built executable finally carries a real publisher and copyright
  instead of blank fields

### Added
- **Third-party licence notices**: `THIRD-PARTY-LICENSES.md` lists every
  runtime dependency the app ships — 30 JavaScript packages and 428 Rust
  crates — with its version and licence. It's generated from the real
  dependency graphs by `scripts/gen-third-party-licenses.mjs` rather than
  maintained by hand, and the licence text plus the notices are now bundled
  into the installer

## [0.8.1] - 2026-08-04

### Added
- **Seven new visualizers**: **Chroma wheel** and **Note bars** show the
  actual pitch content of the music — the twelve notes as a wheel that names
  the strongest one, or as three octaves of piano keys. **Ridgeline** stacks
  the spectrum into scrolling ridges; **Terrain** turns that history into a
  wireframe landscape receding into the distance. **Moiré** and **Silk** are
  two cheap, calm ambient styles. **Beat lab** is for people who want the
  data: onset strength with a threshold line and beat markers, a brightness
  track, and a live BPM readout. They install themselves the first time you
  open 0.8.1 — no trip to the marketplace needed
- **Wind speed units**: Settings → Weather & location → Wind speed switches
  the forecast tile between mph and km/h, or follows your system locale

### Fixed
- **Panels no longer open behind the video**: with something playing on the
  visualizer, the profile switcher, the onboarding screen and the keyboard
  shortcuts sheet all opened *underneath* it. The video plays in a native
  window that sits above everything the app draws, so each panel has to ask
  for it to step aside — three of them never did
- **F11 no longer clears liquid glass**: going fullscreen made Windows drop
  the glass effect, and it stayed gone until you toggled the setting. It's
  now restored automatically

### Note on the pitch-based styles
Chroma wheel and Note bars derive pitch from the frequency spectrum. That
tracks sustained notes and chord changes well, and is unreliable on dense
percussive material — it's a good musical readout, not key detection.

## [0.8.0] - 2026-08-03

Market v2. The marketplace was hard to browse because the signed index carried
almost nothing — no summary, no category, no tags, no dates — so the catalog
synthesised a description from the author's masked email and had no sort
control at all. This release fixes the data first and then builds the surfaces
that data makes possible.

### Added
- **Store**: a full-bleed browsing surface with a Discover home of shelves
  (Updates, Featured, New this month, Most installed, Top rated, plus curated
  collections), a filterable and sortable grid, and a detail page per bundle.
  Esc pops one level at a time and only closes at the root.
- **Combinable filters**: "Installed" and "Weather" are now facets rather than
  mutually exclusive rail rows, so you can ask for installed weather tiles —
  a combination the old catalog could not express. Active facets show as
  chips you can clear individually.
- **Six sort orders**: best match, most installed, top rated, newest, recently
  updated, A–Z. Unknown values always sort last — an unrated bundle at the top
  of "Top rated" would be a lie.
- **Weighted search** over name, tags, summary, author and description,
  replacing a substring match that searched a synthesised "by oli***" string.
- **Library**: managing what you have moved out of the browsing surface into
  its own view with Installed / Updates / Needs setup / Removed sections,
  an "Update all" that runs sequentially, and per-item restore.
- **Written reviews** with a moderation path, **curated collections** with
  attributed multi-install consent, and **author pages**.
- **Media galleries**: bundles can publish up to six preview assets including
  an animation, with a hero and thumbnail strip in the detail view.
- **Offline catalog**: the last good signed index is cached and re-verified
  through the same Rust path a live fetch uses, so the Store works with the
  marketplace unreachable — shown as a banner, not an error.
- **Permissions up front**: capabilities appear as badges on every card and in
  plain English on the detail page, not for the first time in the install
  dialog.
- **Compatibility gate**: a bundle declaring a minimum app version is not
  offered an Install button the running app would fail at install time.

### Changed
- The catalog now takes descriptive text from the marketplace index rather
  than from an installed folder's synthesised author line.
- Preview frames use the capture stage's 576x194 aspect. They had been 16:9,
  which cropped roughly 40% off the width of every preview image.
- All 37 published bundles carry a real summary, description, category, tags
  and icon.

### Fixed
- The seven declarative tile bundles that had never had a preview image
  (`tile-birds`, `tile-githubprs`, `tile-launches`, `tile-onthisday`,
  `tile-phonenotifs`, `tile-randomwiki`, `tile-stocks`) now have one. The
  capture harness only ever handled visualizers, because a declarative tile
  has no `main.js` to drive.
- Four marketplace commands were registered without being added to the app's
  ACL manifest, which would have rejected them at runtime.

### Removed
- The 864-line combined catalog modal. It did two jobs — browsing and
  managing — and its information architecture had to serve both.

## [0.7.3] - 2026-08-03

### Fixed
- **Weather radar shows your location**: the radar was the only map without
  the white dot marking your saved location — the aircraft, lightning and ISS
  maps all had one. It's now drawn from a single shared helper, so the four
  maps can't drift apart again. Streamer mode still hides it, along with the
  rest of the map
- **The forecast no longer gets stuck empty**: if the very first forecast
  fetch failed — most often because the network wasn't up yet when the app
  launched — the tile stayed blank for up to 30 minutes, and only restarting
  the app brought it back. It now retries within 30 seconds and backs off
  gently if the problem persists. Separately, a window that finished loading
  just after an update arrived could miss it entirely; it now shows the last
  known forecast immediately instead of waiting for the next one

### Performance
- **Dragging tiles is much cheaper**: moving or resizing a tile in edit mode
  used to re-render every other tile and repaint every map on each mouse
  movement. The same drag now does that work once, when you let go. Measured
  over a 60-step drag with four maps on screen, map repaints dropped from 246
  to 0 and image draws from 2,580 to 3
- **Maps stay idle when nothing about them changed**: an unrelated settings
  change used to repaint all four map canvases. Panning, zooming and
  recentering still repaint immediately
- **Tiles no longer re-render for unrelated reasons**: changing any single
  setting used to re-render every tile on the canvas
- **The visualizer pauses behind Settings and the Content Library**, as it
  already did behind the visualizer gallery — it was previously still drawing
  at full speed behind those panels
- **System-monitor data is collected once and shared** rather than gathered
  separately for each tile that displays it
- **Settings are saved to one place instead of two**, halving the work done
  each time a setting changes

## [0.7.2] - 2026-08-03

### Added
- **Radar loop controls**: hover the weather radar tile's footer for a
  window switch (30 minutes / 1 hour / 2 hours) and a playback speed
  (0.5×/1×/1.5×) — both apply live while the loop plays. 2 hours is the
  longest window RainViewer's public feed offers; a longer-history
  provider is a parked idea for a future release
- **Auto-hide top bar frees its space**: with auto-hide on, tiles can now
  be dragged into the band the bar used to reserve — the revealed bar
  overlays them on top, the same way the Windows taskbar's auto-hide
  works, so nothing reflows underneath. Turning auto-hide back off
  re-clamps any tile still caught in the band, once, back below it
- **Platform-wide time & temperature formats**: Settings → Appearance →
  Time format (System/12h/24h) and Settings → Weather & location →
  Temperature (System/°F/°C) now apply across the app's clocks and
  temperatures, including the forecast tile's hourly strip and the
  system-monitor temps strip. This also fixes the forecast tile's
  clock, which was ignoring your locale and always rendering 24-hour.
  Two small exceptions keep their native form for now: the forecast
  tile's sunrise/sunset stats (still 12-hour) and the sysmon CPU/GPU
  sub-line (e.g. "58°C") — the latter is the sensor's native hardware
  reading, not a converted display value
- **Date & time tile styles**: hover the tile to cycle digital (the 0.7.1
  clock + date line), minimal (time only, larger), or analog — a canvas
  clock face with hour, minute and second hands

## [0.7.1] - 2026-08-03

### Fixed
- **F11 fullscreen**: the window-fullscreen permission was never granted, so
  F11 silently did nothing in the installed app. It now actually works.
  Failures are also logged instead of swallowed

### Added
- **Date & time tile**: a large digital clock (follows your system
  12/24-hour preference) with a full date line and an optional seconds
  display — hover the tile to toggle seconds on or off
- **Streamer mode**: one click in the top bar (⊘) hides every map and
  location label — radar, aircraft, lightning, ISS, city names, tide
  station — so screenshares can't reveal where you are. Also available in
  Settings → Appearance; a "streamer" chip shows in the status bar while
  active
- **Profile export/import**: export any profile to a shareable JSON file
  from the profile switcher — saved map positions are stripped from the
  file since they'd reveal your home location — and import one as a new
  profile or over an existing one

## [0.7.0] - 2026-08-03

### Added
- **macOS support**: 2ndMonitor now runs on macOS 14.2 (Sonoma) and later,
  as a universal build for both Apple Silicon and Intel Macs. Everything
  the Windows build does comes with it — tiles, profiles, the content
  library, the marketplace, and the visualizers
- **Audio-reactive visualizers on macOS**: the equalizer, MilkDrop, and
  scripted visualizers react to your sound using Core Audio process taps,
  including the per-app audio source picker. macOS asks for permission to
  record audio the first time you pick an app; the tap never mutes or
  alters what you hear
- **macOS system integration**: passwords and API keys are stored in the
  Keychain, the "now playing app" tile follows the frontmost app, and the
  audio mixer can list your output devices and switch the default one
- **Automatic updates on macOS**: Mac builds are served by the same
  in-app updater as Windows

### Known limitations on macOS
- Builds are **unsigned**, the same as the Windows builds. The first launch
  needs System Settings → Privacy & Security → "Open Anyway" — macOS's
  equivalent of the Windows SmartScreen prompt
- The audio-source picker lists **helper processes** for apps that are
  built from several processes. Chrome, Discord and Electron apps play
  their audio from a helper, so you may see something like
  `com.google.Chrome.helper` rather than the app's own name
- The audio-recording permission may need re-approving after an update,
  because the app is unsigned

## [0.6.7] - 2026-08-03

### Added
- **F11 fullscreen**: F11 toggles true fullscreen — the Windows taskbar
  disappears on that monitor. Press F11 again to leave; the app always
  starts windowed. Listed in the "?" shortcuts overlay
- **Auto-hide top bar**: a new Settings → Appearance toggle slides the top
  bar out of view until you move the mouse to the top edge. It stays put
  while edit mode, settings, or any other bar-anchored overlay is open.
  Off by default

### Fixed
- **Leftover tile piles**: profiles created before 0.6.1 could carry a
  stack of overlapping tiles that an old defaults bug materialized —
  especially in portrait. A one-time repair now removes tiles that are
  still at their exact default position and overlapping another tile.
  Anything removed can be re-added from the content library

## [0.6.6] - 2026-08-03

### Added
- **Liquid glass**: an optional translucent look where your desktop shows
  through the app (Windows acrylic). Toggle it in Settings → Appearance and
  set the strength — 0 is clear glass, 100 is fully frosted. Off by default
  and pixel-identical to before when off
- **Real maps**: the aircraft radar, weather radar, lightning, and ISS tiles
  now plot on an actual pannable, zoomable dark map (drag to pan, scroll to
  zoom). Each tile remembers its view, and a recenter button appears whenever
  you've panned away. Weather radar overlays live RainViewer precipitation
  with a play button that animates the last hour; the ISS tile draws the
  station's ground track as it moves
- **System temps**: the system monitor shows per-part temperatures — CPU,
  GPU, board, and drives — with amber/red warnings when parts run hot. Full
  detail comes from LibreHardwareMonitor when it's running; without it you
  get what the hardware exposes natively

### Changed
- The visualizer's audio source is now a strict include list: check up to
  4 apps and it hears exactly those, mixed together — or all system audio.
  Pick them in Settings → Visualizer → Audio source, or toggle any app with
  the headphone button on its Audio Mixer row
- The 0.6.4 auto-fallback is gone: the visualizer never switches source on
  its own. A selected app that isn't running contributes silence and the
  status bar says so ("Spotify (not running)"); it's picked up automatically
  the moment it starts playing
- A saved "only <app>" source upgrades to a one-app include list, keeping
  its tuned sensitivity. "Everything except <app>" has no equivalent in the
  new model and resets to all system audio

## [0.6.5] - 2026-08-02

### Fixed
- The visualizer tile can now be removed in edit mode like any other tile
  (add it back any time from the content library). It was the one tile
  with a permanently disabled Remove button
- The Layers and Properties panels in edit mode can now be dragged out of
  the way by their headers — they used to sit fixed over the canvas and
  block moving or resizing any tile underneath them

### Changed
- Settings → Performance mode now reads battery → balanced → high →
  uncapped, left to right

## [0.6.4] - 2026-08-02

### Added
- Pick what the visualizer listens to: **all system audio** (as before),
  **only one app**, or **everything except one app** — so the visualizer can
  follow your music and ignore Discord voice, game audio, and notifications.
  Choose it in Settings → Visualizer → Audio source, or click the new
  headphone button on any Audio Mixer row
- Sensitivity is remembered **per source**, so switching from a loud game to
  a quiet podcast doesn't mean re-tuning the gain every time
- The visualizer reattaches on its own: while the chosen app isn't playing it
  falls back to the full mix, then picks the app back up the moment it starts
  again. The status bar always says what it's actually listening to

### Fixed
- The visualizer no longer keeps capturing the old output device after you
  switch playback devices — it followed the device only on restart before
- A failed audio capture now falls back to the system mix and recovers
  instead of leaving the visualizer frozen on a stale frame

## [0.6.3] - 2026-08-02

### Fixed
- Opening the Content Library froze the app while it downloaded every
  preview thumbnail in the catalog at once (~370 since the 0.6.0 preset
  wave) — worse the slower your connection, up to a full lockup. Two
  causes, both fixed: marketplace fetches ran as blocking network calls
  on the app's main thread (now async on a worker), and every catalog
  row fetched its thumbnail immediately on mount (now only rows actually
  scrolled into view fetch, as you scroll)

## [0.6.2] - 2026-08-02

### Changed
- "Reset layout" now clears the profile's canvas completely and drops you
  into edit mode with the tile picker at hand, instead of re-placing every
  tile type (which recreated the 28-tile pile-up 0.6.1 fixed for fresh
  installs)

## [0.6.1] - 2026-08-02

### Fixed
- First-run onboarding never appeared on a truly fresh install — the
  auto-trigger checked for profiles once at startup, before they were
  seeded, and never looked again. It now fires as soon as the profile
  system is ready, and is offered once to existing installs that never
  got it
- Fresh installs started with every tile type placed at once (28
  overlapping tiles). New installs now start with curated layouts —
  Work: the core eight tiles, Gaming: five, Chill: three — matching what
  the onboarding profile cards advertise
- Dismissing onboarding with Esc now counts as "skip setup" instead of
  silently re-offering it on the next launch

## [0.6.0] - 2026-08-01

### Added
- Individual MilkDrop presets on the marketplace: ~370 classic presets from
  the Butterchurn packs (including the never-shipped Extra, Extra2, and MD1
  collections), each its own one-click install with an auto-captured preview
  thumbnail — browse them in the Content Library's new "MilkDrop → Presets"
  section
- The MilkDrop preset picker gains a "Marketplace" group for installed
  presets — with name, author, updates, and uninstall via the library —
  plus a "Get more presets →" link that jumps straight to the marketplace
  section
- Installed marketplace presets are real citizens: update detection when a
  newer version is published, clean uninstall, and they never mix with your
  hand-dropped files in the `presets/` folder

### Changed
- The built-in MilkDrop pack slims from 100 bundled presets to a curated
  12-preset starter pack — everything else (and much more) moved to
  individual marketplace installs. The MilkDrop code chunk shrinks from
  889 kB to 295 kB
- The preset picker's groups are now Originals / Marketplace / Starter pack /
  Your presets

### Fixed
- MilkDrop preset loading silently did nothing in dev builds (a React
  StrictMode double-mount left the surface's mounted-guard permanently
  false); packaged builds were unaffected

## [0.5.1] - 2026-08-01

### Added
- Auto-update: the app checks for new releases and offers a one-click
  "Update & restart" — updates are cryptographically signed, and nothing
  downloads or installs without your click
- "Check for updates" button in Settings → System for checking on demand
- Six original Tron-inspired MilkDrop presets in a new "Originals" group at
  the top of the preset picker, each with a ◐ toggle between the canonical
  Tron palette and your theme's accent colors

### Changed
- This is the first release the app can update itself FROM — anyone on 0.5.0
  or older needs one last manual install

## [0.5.0] - 2026-08-01

### Added
- Marketplace: browse, install, remove, and rate community visualizers and tiles
  from inside the app — signed index, per-bundle permissions shown before
  install, star ratings with sign-in, and one-click restore of removed content
- Preview images on every marketplace card, generated from each visualizer's
  real render; hovering an installed visualizer's card plays it live
- MilkDrop visualizer: the classic preset engine (Butterchurn) with the full
  preset pack, plus your own `.milk` presets from the app data `presets/` folder
- Scripted visualizers: write your own visualizer in JavaScript with a live
  in-app editor — code runs in a locked-down sandbox with a small `viz` API
- 27 visualizer styles and 10 tiles now ship as marketplace bundles, so they
  update independently of app releases
- Settings window with searchable Tile Library (replaces the dev Tweaks panel)
- Settings export/import via native file dialogs
- System tray with close-to-tray (toggle in Settings, default on)
- Encrypted secret store and shared polling infrastructure

### Changed
- Built-in visualizer styles and five built-in tiles migrated to marketplace
  bundles; existing layouts keep working through automatic id migration
- Faster startup: tiles, viz gallery, and the extra visualizer styles now lazy-load
- Fonts are self-hosted as 2 variable-weight files (no external font hosts)

### Security
- Tauri command ACL now ships a real manifest scoped to the main window, so
  embedded browser pages can no longer reach app commands
- The visualizer sandbox is served from its own origin with a header-delivered
  CSP and a per-process proof token; sandboxed code has no network or IPC
  access beyond its declared, brokered permissions

### Fixed
- Opening the marketplace no longer mounts a grid of live sandboxes at once —
  cards show images and animate only on hover (this was the marketplace-open
  lag/near-crash)
- MilkDrop presets now load in packaged builds. Butterchurn compiles preset
  equations with `new Function`, which the app CSP (`script-src 'self'`)
  rightly blocks in the main window; the visualizer now runs inside the
  eval-capable viz sandbox iframe, so downloaded presets also stop executing
  with app privileges. (`tauri dev` injects no CSP, which is why this never
  reproduced in development.)
- Visualizer frame pacing no longer fights 144 Hz vsync; the render loop pauses while hidden to tray
- Clicking the tray icon restores a minimized window; second launches refocus the running instance
- Settings import merges over current values (not defaults) and surfaces errors in the UI

## [0.4.0] - 2026-05-08

### Added
- Source-aware Now Playing tile that follows whichever player is active
- Apple Music integration

## [0.3.3] - 2026-05-08

### Added
- 16 new tiles

## [0.3.2] - 2026-05-08

### Added
- Stream Deck v2 actions and a Discord toggle
- 7 new tiles
- Streaming-browser launchpad in the visualizer (replaces the YouTube embed)

### Fixed
- Tile-edit interactivity, radar layout, and picker contrast

## [0.3.1] - 2026-05-08

### Fixed
- New tiles now fill their grid rect

## [0.3.0] - 2026-05-07

First tagged release — the foundation.

### Added
- Tile dashboard with drag/resize edit mode and persisted layouts
- Profile system: switcher, create/edit/delete, live layout previews
- Spotify integration: OAuth, Up Next queue, synced lyrics (LRCLIB) with visualizer overlay
- 22 visualizer styles with a browseable gallery
- Configurable weather location with city search
- Interactive todo list in the Notes tile
- Discord voice-channel commands
- Durable tweaks store in app data
