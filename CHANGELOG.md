# Changelog

All notable changes to 2ndMonitor are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/); versions follow semver.

## [Unreleased]

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
