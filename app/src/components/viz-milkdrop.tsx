import React, { useCallback, useEffect, useRef, useState } from 'react';
import { type VizProps } from './viz';
import { SandboxVizSurface } from './viz-sandbox-surface';
import { MILKDROP_FRAME_CODE } from './milkdrop-code';
import {
  mergePresetLibrary, resolveLoadSource,
  type PresetEntry, type MilkdropLoadSource, type MilkdropHostToFrame, type MilkdropFrameToHost,
} from '../state/milkdrop-presets';
import { ORIGINALS } from '../state/originals';
import { TRON_PALETTE, paletteFromAccents } from '../state/originals/palette';

/** MilkDrop 2 presets via Butterchurn (WebGL2), run inside the no-capability
 *  viz sandbox iframe — butterchurn compiles preset equations with
 *  `new Function`, which the app document's packaged CSP (script-src 'self')
 *  forbids. The frame ships butterchurn + the bundled preset pack as raw
 *  code (see milkdrop-code.ts); this host only talks to it over the sandbox
 *  data channel. In `preview` mode (gallery grid) renders a cheap 2D
 *  placeholder instead: the gallery mounts all surfaces simultaneously and
 *  Chromium caps live WebGL contexts (~16). */
export function VizMilkdrop({ accent, accent2, spectrumRef, paused, preview, onOpenLibrary }: VizProps) {
  if (preview) return <MilkdropPreviewCard accent={accent} accent2={accent2} />;
  return <MilkdropSurface accent={accent} accent2={accent2} spectrumRef={spectrumRef} paused={paused} onOpenLibrary={onOpenLibrary} />;
}

const AUTO_ADVANCE_MS = 30_000;
const BLEND_SECONDS = 2.7;
const LS_PRESET = 'milkdrop.preset';
const LS_AUTO = 'milkdrop.autoAdvance';
/** Per-original tint choice — canonical Tron palette vs the app accents. */
const lsTintKey = (id: string) => `milkdrop.tint.${id}`;
/** The picker rows for `mergePresetLibrary`'s first parameter — module-scope
 *  because the registry is compile-time static. */
const ORIGINAL_ROWS = ORIGINALS.map((o) => ({ id: o.id, label: o.label }));

/** Stable identity is load-bearing: SandboxVizSurface documents localSource
 *  as a module-scope constant; an inline literal would re-init per render. */
const MILKDROP_LOCAL_SOURCE = { code: MILKDROP_FRAME_CODE };
/** Distinct from any installable marketplace id ('builtin-' prefix) so the
 *  settings key and perf-HUD bucket can never collide with a shop bundle. */
const MILKDROP_BUNDLE_ID = 'builtin-milkdrop';
const LOAD_TIMEOUT_MS = 5000;

function MilkdropSurface({ accent, accent2, spectrumRef, paused, onOpenLibrary }: Pick<VizProps, 'accent' | 'accent2' | 'spectrumRef' | 'paused' | 'onOpenLibrary'>) {
  const libraryRef = useRef<PresetEntry[]>([]);
  const indexRef = useRef(0);
  /** key → resolution error message, shown as ⚠ in the picker. */
  const failuresRef = useRef(new Map<string, string>());
  /** Cache the PROMISE, not the resolved list: 'milkdrop:names' can arrive
   *  twice in quick succession (the frame re-posts it on every proven-ready
   *  init, and a >250ms main-thread stall — plausible while the ~846KB
   *  milkdrop chunk lands — makes a second 'ready' race the first's init
   *  before readyRef settles). Caching only the result left a window where
   *  both arrivals saw `null` and both fired invoke('presets_list'). */
  const userPromiseRef = useRef<Promise<{ name: string; file: string; ext: string }[]> | null>(null);
  /** Same promise-cache reasoning as userPromiseRef, for the installed
   *  marketplace preset list. Cleared (alongside userPromiseRef) whenever
   *  'market-presets:changed' fires so a fresh install/uninstall/restore is
   *  reflected without waiting for the next frame re-init. */
  const marketPromiseRef = useRef<Promise<{ id: string; name: string }[]> | null>(null);
  /** Bumped on every rebuildLibrary call; a walk whose generation is stale by
   *  the time its (now-deduped) user/market list promises resolve abandons
   *  its walk instead of writing host state (library/index/label/LS_PRESET)
   *  that a newer, still-in-flight rebuild is about to overwrite anyway. */
  const namesGenRef = useRef(0);
  /** The last 'milkdrop:names' payload — replayed by the
   *  'market-presets:changed' handler, which has no fresh names of its own
   *  (the frame's bundled-preset list didn't change, only the marketplace/user
   *  dir did). */
  const namesRef = useRef<string[]>([]);
  const mountedRef = useRef(true);

  const seqRef = useRef(0);
  const pendingRef = useRef(new Map<number, (r: { ok: boolean; error?: string }) => void>());
  const dataSenderRef = useRef<((payload: unknown) => boolean) | null>(null);

  const [presetLabel, setPresetLabel] = useState('');
  const [toast, setToast] = useState('');
  const [hovered, setHovered] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [libraryVersion, setLibraryVersion] = useState(0);
  const [autoAdvance, setAutoAdvance] = useState(() => localStorage.getItem(LS_AUTO) !== 'off');
  /** Bumped on tint toggles so the ◐ chip re-reads localStorage. */
  const [tintVersion, setTintVersion] = useState(0);

  /** Current accents behind a ref so `loadAt` (and everything hanging off it)
   *  stays referentially stable across theme changes — the tint builder reads
   *  the ref at build time instead of closing over stale props. */
  const accentsRef = useRef({ accent, accent2 });
  accentsRef.current = { accent, accent2 };

  /** Builds an original's preset JSON at load time: canonical Tron palette by
   *  default, or a palette derived from the CURRENT app accents when this
   *  preset's ◐ tint is on. */
  const buildOriginal = useCallback((id: string): object => {
    const def = ORIGINALS.find((o) => o.id === id);
    if (!def) throw new Error(`original preset missing: ${id}`);
    const tinted = localStorage.getItem(lsTintKey(id)) === 'on';
    const { accent: a1, accent2: a2 } = accentsRef.current;
    return def.build(tinted ? paletteFromAccents(a1, a2) : TRON_PALETTE);
  }, []);

  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 4000);
  }, []);
  useEffect(() => {
    // Re-arm on every effect run, not just via useRef's initial value:
    // StrictMode's dev-only mount→cleanup→remount pass runs the cleanup
    // below on the SAME component instance, and a ref survives that pass —
    // without this line the ref stays false forever after the remount and
    // every loadAt walk silently aborts at its mounted guard (dev-only:
    // packaged builds don't double-mount). Same footgun ContentLibrary's
    // fetchIndex doc comment describes.
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, []);

  const readUserFile = useCallback(async (file: string) => {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<string>('presets_read', { file });
  }, []);

  /** Reads one installed marketplace preset's JSON text by item id. */
  const readMarketPreset = useCallback(async (id: string) => {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<string>('presets_market_read', { id });
  }, []);

  /** Post one load into the frame; resolves on the frame's seq-matched
   *  result, a timeout (dead frame), or immediately when the frame is not
   *  ready — never hangs the caller's walk-forward loop. */
  const sendLoad = useCallback((source: MilkdropLoadSource, blend: number) => {
    return new Promise<{ ok: boolean; error?: string }>((resolve) => {
      const seq = ++seqRef.current;
      const timer = setTimeout(() => {
        pendingRef.current.delete(seq);
        // Unmounted while this load was in flight: let the promise hang
        // instead of resolving it. Resolving would resume loadAt's await,
        // whose catch schedules a fresh (now-orphaned) toast timer and walks
        // the ENTIRE remaining library — every iteration resolving instantly
        // via the not-ready branch below since dataSenderRef is torn down,
        // including a real invoke('presets_read') per user entry — all of it
        // pointless work against a component nothing can see anymore.
        if (!mountedRef.current) return;
        resolve({ ok: false, error: 'no response from visualizer frame' });
      }, LOAD_TIMEOUT_MS);
      pendingRef.current.set(seq, (r) => { clearTimeout(timer); resolve(r); });
      const msg: MilkdropHostToFrame = { kind: 'milkdrop:load', seq, source, blend };
      if (!dataSenderRef.current?.(msg)) {
        clearTimeout(timer);
        pendingRef.current.delete(seq);
        resolve({ ok: false, error: 'visualizer not ready' });
      }
    });
  }, []);

  /** Load library[index]; on failure, record it, toast, and walk forward
   *  until something loads (at most one full lap). Unchanged shape from the
   *  in-document era — only the resolve/load seam moved to the frame. */
  const loadAt = useCallback(async (index: number, blend: number) => {
    const lib = libraryRef.current;
    if (!lib.length) return;
    for (let attempt = 0; attempt < lib.length; attempt++) {
      // Unmount can land between iterations (e.g. a genuine load failure's
      // catch ran, then the component unmounted before the next attempt) —
      // the old canvas-based component was implicitly guarded here because
      // vizRef.current went null; this is the equivalent stop sign.
      if (!mountedRef.current) return;
      const i = (index + attempt + lib.length) % lib.length;
      const entry = lib[i];
      try {
        const source = await resolveLoadSource(entry, readUserFile, buildOriginal, readMarketPreset);
        const res = await sendLoad(source, blend);
        if (!res.ok) throw new Error(res.error ?? 'load failed');
        indexRef.current = i;
        setPresetLabel(entry.label);
        localStorage.setItem(LS_PRESET, entry.key);
        return;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        failuresRef.current.set(entry.key, msg);
        setLibraryVersion((v) => v + 1);
        showToast(`${entry.label}: ${msg}`);
      }
    }
  }, [readUserFile, sendLoad, showToast, buildOriginal, readMarketPreset]);

  const advance = useCallback((how: 'next' | 'prev' | 'random', blend = BLEND_SECONDS) => {
    const lib = libraryRef.current;
    if (!lib.length) return;
    let target = indexRef.current;
    if (how === 'next') target = indexRef.current + 1;
    else if (how === 'prev') target = indexRef.current - 1;
    else if (lib.length > 1) {
      // Random ≠ current so the button always visibly does something.
      do { target = Math.floor(Math.random() * lib.length); } while (target === indexRef.current);
    }
    void loadAt(target, blend);
  }, [loadAt]);

  /** invoke('presets_list') is memoized on the PROMISE (not its result) so
   *  two onNames calls arriving before the first invoke resolves share one
   *  in-flight request instead of both firing it. */
  const getUserFiles = useCallback(() => {
    if (!userPromiseRef.current) {
      userPromiseRef.current = (async () => {
        try {
          const { invoke } = await import('@tauri-apps/api/core');
          return await invoke<{ name: string; file: string; ext: string }[]>('presets_list');
        } catch {
          return []; // preset folder unreadable — bundled pack still works
        }
      })();
    }
    return userPromiseRef.current;
  }, []);

  /** Same promise-cache reasoning as getUserFiles, for the marketplace list. */
  const getMarketPresets = useCallback(() => {
    if (!marketPromiseRef.current) {
      marketPromiseRef.current = (async () => {
        try {
          const { invoke } = await import('@tauri-apps/api/core');
          return await invoke<{ id: string; name: string; author: string | null; version: string }[]>('presets_market_list');
        } catch { return []; }
      })();
    }
    return marketPromiseRef.current;
  }, []);

  /** Rebuilds the library from a frame names list plus the (possibly cached)
   *  user-file and marketplace lists, and restores a preset afterward — the
   *  saved preset when `forceReload`, since after a frame re-init the
   *  visualizer is blank and must always be given something; otherwise only
   *  when the previously-playing entry's key no longer exists in the rebuilt
   *  library (a marketplace uninstall took it out from under the frame).
   *
   *  Shared by onNames (below) and the 'market-presets:changed' listener, both
   *  of which increment the same generation counter: two calls arriving close
   *  together (the frame re-posts names on every proven 'ready', and a
   *  >250ms main-thread stall — plausible while the ~846KB milkdrop chunk
   *  lands — can make a second 'ready' race the first's init; or a names
   *  arrival can race a marketplace change) must not both finish a walk —
   *  whichever ends up older abandons before touching host state, or
   *  indexRef/presetLabel/LS_PRESET can end up describing a preset the frame
   *  never actually settled on. */
  const rebuildLibrary = useCallback(async (names: string[], forceReload: boolean) => {
    const gen = ++namesGenRef.current;
    const [user, market] = await Promise.all([getUserFiles(), getMarketPresets()]);
    if (gen !== namesGenRef.current) return; // superseded by a newer rebuild while we awaited
    const prevKey = libraryRef.current[indexRef.current]?.key;
    libraryRef.current = mergePresetLibrary(ORIGINAL_ROWS, names, user, market);
    setLibraryVersion((v) => v + 1);
    const lib = libraryRef.current;
    const stillThere = prevKey !== undefined && lib.some((e) => e.key === prevKey);
    if (!forceReload && stillThere) {
      // The rebuilt library can shift positions even when the playing preset is
      // still in it (e.g. installing a marketplace preset shifts every bundled
      // entry's index) — re-point indexRef at the same entry's new position so
      // the picker highlight, next/prev walking, and the tint-rebuild effect
      // (all of which read library[indexRef.current]) stay in sync.
      indexRef.current = lib.findIndex((e) => e.key === prevKey);
      return;
    }
    const savedKey = localStorage.getItem(LS_PRESET);
    const savedIndex = savedKey ? lib.findIndex((e) => e.key === savedKey) : -1;
    void loadAt(savedIndex >= 0 ? savedIndex : Math.floor(Math.random() * lib.length), 0);
  }, [loadAt, getUserFiles, getMarketPresets]);

  /** Fires on every 'milkdrop:names' — first init AND hot re-inits. After a
   *  re-init the frame has a blank visualizer, so this always reloads. */
  const onNames = useCallback(async (names: string[]) => {
    namesRef.current = names;
    await rebuildLibrary(names, true);
  }, [rebuildLibrary]);

  // A marketplace preset install/uninstall/restore changes what
  // presets_market_list (and, for an uninstall, presets_list — the flat user
  // dir) report, but the frame's own bundled-preset names haven't changed —
  // replay the last names payload against fresh lists instead of waiting for
  // the frame to re-post 'milkdrop:names' (it never will on its own). Only
  // reload the live preset if the change actually took it out of the library;
  // otherwise let it keep playing undisturbed.
  useEffect(() => {
    const onMarketChanged = () => {
      marketPromiseRef.current = null;
      userPromiseRef.current = null;
      void rebuildLibrary(namesRef.current, false);
    };
    window.addEventListener('market-presets:changed', onMarketChanged);
    return () => window.removeEventListener('market-presets:changed', onMarketChanged);
  }, [rebuildLibrary]);

  const handleData = useCallback((payload: unknown) => {
    const msg = payload as MilkdropFrameToHost;
    if (msg?.kind === 'milkdrop:load:result') {
      const pending = pendingRef.current.get(msg.seq);
      if (pending) { pendingRef.current.delete(msg.seq); pending({ ok: msg.ok, error: msg.error }); }
    } else if (msg?.kind === 'milkdrop:names') {
      void onNames(msg.names);
    }
  }, [onNames]);

  // Auto-advance to a random preset while playing (paused also pauses this).
  useEffect(() => {
    if (!autoAdvance || paused) return;
    const id = setInterval(() => advance('random'), AUTO_ADVANCE_MS);
    return () => clearInterval(id);
  }, [autoAdvance, paused, advance]);

  // Rebuild a TINTED original when the app accents change under it — its
  // colors are baked from the accents at build time, so without this it keeps
  // wearing the previous theme. Canonical-palette originals don't care.
  useEffect(() => {
    const e = libraryRef.current[indexRef.current];
    if (e?.source === 'original' && localStorage.getItem(lsTintKey(e.id!)) === 'on') {
      void loadAt(indexRef.current, 0.8);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accent, accent2]);

  const toggleAuto = () => {
    setAutoAdvance((prev) => {
      localStorage.setItem(LS_AUTO, prev ? 'off' : 'on');
      return !prev;
    });
  };

  const chip: React.CSSProperties = {
    padding: '4px 9px', fontSize: 12, lineHeight: 1, cursor: 'pointer',
    background: 'rgba(0,0,0,0.55)', color: 'rgba(255,255,255,0.85)',
    border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8,
  };

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ position: 'absolute', inset: 0, background: '#000', overflow: 'hidden' }}
    >
      <SandboxVizSurface
        bundleId={MILKDROP_BUNDLE_ID}
        localSource={MILKDROP_LOCAL_SOURCE}
        onData={handleData}
        dataSenderRef={dataSenderRef}
        accent={accent}
        accent2={accent2}
        spectrumRef={spectrumRef}
        paused={paused}
      />
      {/* Mouse events over an iframe are dispatched to ITS document, never the
          parent's — without this shield the wrapper's onMouseEnter never fires
          and every chip is unreachable. MilkDrop takes no pointer input, so
          covering the frame costs nothing. Chrome renders above the shield. */}
      <div data-pointer-shield style={{ position: 'absolute', inset: 0, zIndex: 1 }} />

      {presetLabel && (
        <div style={{
          position: 'absolute', left: 10, bottom: 8, fontSize: 10, zIndex: 2,
          color: 'rgba(255,255,255,0.45)', fontFamily: '"JetBrains Mono", ui-monospace, monospace',
          maxWidth: '60%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          pointerEvents: 'none',
        }}>{presetLabel}</div>
      )}

      <div style={{
        position: 'absolute', right: 10, bottom: 8, display: 'flex', gap: 6, zIndex: 2,
        opacity: hovered || pickerOpen ? 1 : 0, transition: 'opacity 160ms ease',
        pointerEvents: hovered || pickerOpen ? 'auto' : 'none',
      }}>
        {(() => {
          const current = libraryRef.current[indexRef.current];
          if (current?.source !== 'original') return null;
          void tintVersion; // re-read localStorage after each toggle
          const tinted = localStorage.getItem(lsTintKey(current.id!)) === 'on';
          return (
            <button
              style={{ ...chip, color: tinted ? accent : 'rgba(255,255,255,0.85)' }}
              title={tinted
                ? 'Tinted with your accent colors — click for the canonical Tron palette'
                : 'Canonical Tron palette — click to tint with your accent colors'}
              onClick={() => {
                localStorage.setItem(lsTintKey(current.id!), tinted ? 'off' : 'on');
                setTintVersion((v) => v + 1);
                void loadAt(indexRef.current, 0.5);
              }}
            >◐</button>
          );
        })()}
        <button style={chip} title="Previous preset" onClick={() => advance('prev', 1.0)}>‹</button>
        <button style={chip} title="Random preset" onClick={() => advance('random', 1.0)}>⚄</button>
        <button style={chip} title="Next preset" onClick={() => advance('next', 1.0)}>›</button>
        <button
          style={{ ...chip, color: autoAdvance ? accent : 'rgba(255,255,255,0.85)' }}
          title={autoAdvance ? 'Auto-advance on (30s) — click to hold current preset' : 'Auto-advance off — click to cycle every 30s'}
          onClick={toggleAuto}
        >{autoAdvance ? '▶' : '⏸'}</button>
        <button style={chip} title="Preset picker" onClick={() => setPickerOpen((o) => !o)}>☰</button>
      </div>

      {toast && (
        <div style={{
          position: 'absolute', left: '50%', top: 12, transform: 'translateX(-50%)', zIndex: 2,
          padding: '6px 12px', fontSize: 11, color: 'rgba(255,255,255,0.9)',
          background: 'rgba(0,0,0,0.7)', border: '1px solid rgba(255,255,255,0.15)',
          borderRadius: 8, maxWidth: '85%', pointerEvents: 'none',
        }}>{toast}</div>
      )}

      {pickerOpen && (
        <PresetPicker
          key={libraryVersion}
          library={libraryRef.current}
          failures={failuresRef.current}
          currentKey={libraryRef.current[indexRef.current]?.key}
          accent={accent}
          onPick={(i) => { void loadAt(i, 1.0); setPickerOpen(false); }}
          onClose={() => setPickerOpen(false)}
          onOpenLibrary={onOpenLibrary}
        />
      )}
    </div>
  );
}

function PresetPicker({ library, failures, currentKey, accent, onPick, onClose, onOpenLibrary }: {
  library: PresetEntry[];
  failures: Map<string, string>;
  currentKey?: string;
  accent: string;
  onPick: (index: number) => void;
  onClose: () => void;
  onOpenLibrary?: (rail?: string) => void;
}) {
  const bundledCount = library.filter((e) => e.source === 'bundled').length;
  const originalCount = library.filter((e) => e.source === 'original').length;
  const marketCount = library.filter((e) => e.source === 'market').length;
  const renderGroup = (source: PresetEntry['source'], title: string) => {
    const items = library
      .map((entry, index) => ({ entry, index }))
      .filter(({ entry }) => entry.source === source);
    if (!items.length) return null;
    return (
      <div key={source}>
        <div style={{
          padding: '8px 12px 4px', fontSize: 10, fontWeight: 600, letterSpacing: '0.06em',
          textTransform: 'uppercase', color: 'rgba(255,255,255,0.4)',
        }}>{title}</div>
        {items.map(({ entry, index }) => {
          const failure = failures.get(entry.key);
          const active = entry.key === currentKey;
          return (
            <div
              key={entry.key}
              title={failure ?? entry.label}
              onClick={() => onPick(index)}
              style={{
                padding: '5px 12px', fontSize: 12, cursor: 'pointer',
                color: failure ? 'rgba(255,255,255,0.35)' : active ? accent : 'rgba(255,255,255,0.8)',
                background: active ? 'rgba(255,255,255,0.06)' : 'transparent',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}
            >{failure ? '⚠ ' : ''}{entry.label}</div>
          );
        })}
      </div>
    );
  };

  return (
    <div
      onClick={onClose}
      style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 5 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'absolute', right: 10, bottom: 40, width: 300, maxHeight: '70%',
          overflowY: 'auto', background: 'rgba(10,11,16,0.96)',
          border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10,
          boxShadow: '0 16px 48px rgba(0,0,0,0.6)',
        }}
      >
        {renderGroup('original', `Originals · ${originalCount}`)}
        {renderGroup('market', `Marketplace · ${marketCount}`)}
        {renderGroup('bundled', `Bundled · ${bundledCount}`)}
        {renderGroup('user', 'Your presets — %APPDATA%\\com.secondmonitor.hub\\presets')}
        <div style={{
          padding: '8px 12px', fontSize: 10, color: 'rgba(255,255,255,0.35)',
          borderTop: '1px solid rgba(255,255,255,0.06)',
        }}>
          Drop Butterchurn .json presets in the folder above. MilkDrop 2 presets only — .milk2 (MilkDrop 3) is not supported.
        </div>
        <div style={{
          padding: '8px 12px 10px', borderTop: '1px solid rgba(255,255,255,0.06)',
        }}>
          <button
            onClick={() => { onOpenLibrary?.('preset:all'); onClose(); }}
            style={{
              background: 'none', border: 'none', padding: 0, cursor: 'pointer',
              fontSize: 11, fontWeight: 600, color: accent,
            }}
          >Get more presets →</button>
        </div>
      </div>
    </div>
  );
}

function MilkdropPreviewCard({ accent, accent2 }: { accent: string; accent2: string }) {
  return (
    <div style={{
      position: 'absolute', inset: 0, display: 'grid', placeItems: 'center',
      background: `radial-gradient(ellipse at 30% 70%, ${accent}33, transparent 60%), radial-gradient(ellipse at 70% 30%, ${accent2}33, transparent 60%), #000`,
    }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{
          fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em',
          background: `linear-gradient(90deg, ${accent}, ${accent2})`,
          WebkitBackgroundClip: 'text', color: 'transparent',
        }}>
          MilkDrop
        </div>
        <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.45)', marginTop: 4 }}>
          MilkDrop 2 presets · WebGL — renders live outside the gallery
        </div>
      </div>
    </div>
  );
}
