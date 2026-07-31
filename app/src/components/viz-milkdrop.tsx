import React, { useCallback, useEffect, useRef, useState } from 'react';
import { type VizProps } from './viz';
import { SandboxVizSurface } from './viz-sandbox-surface';
import { MILKDROP_FRAME_CODE } from './milkdrop-code';
import {
  mergePresetLibrary, resolveLoadSource,
  type PresetEntry, type MilkdropLoadSource, type MilkdropHostToFrame, type MilkdropFrameToHost,
} from '../state/milkdrop-presets';

/** MilkDrop 2 presets via Butterchurn (WebGL2), run inside the no-capability
 *  viz sandbox iframe — butterchurn compiles preset equations with
 *  `new Function`, which the app document's packaged CSP (script-src 'self')
 *  forbids. The frame ships butterchurn + the bundled preset pack as raw
 *  code (see milkdrop-code.ts); this host only talks to it over the sandbox
 *  data channel. In `preview` mode (gallery grid) renders a cheap 2D
 *  placeholder instead: the gallery mounts all surfaces simultaneously and
 *  Chromium caps live WebGL contexts (~16). */
export function VizMilkdrop({ accent, accent2, spectrumRef, paused, preview }: VizProps) {
  if (preview) return <MilkdropPreviewCard accent={accent} accent2={accent2} />;
  return <MilkdropSurface accent={accent} accent2={accent2} spectrumRef={spectrumRef} paused={paused} />;
}

const AUTO_ADVANCE_MS = 30_000;
const BLEND_SECONDS = 2.7;
const LS_PRESET = 'milkdrop.preset';
const LS_AUTO = 'milkdrop.autoAdvance';

/** Stable identity is load-bearing: SandboxVizSurface documents localSource
 *  as a module-scope constant; an inline literal would re-init per render. */
const MILKDROP_LOCAL_SOURCE = { code: MILKDROP_FRAME_CODE };
/** Distinct from any installable marketplace id ('builtin-' prefix) so the
 *  settings key and perf-HUD bucket can never collide with a shop bundle. */
const MILKDROP_BUNDLE_ID = 'builtin-milkdrop';
const LOAD_TIMEOUT_MS = 5000;

function MilkdropSurface({ accent, accent2, spectrumRef, paused }: Pick<VizProps, 'accent' | 'accent2' | 'spectrumRef' | 'paused'>) {
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
  /** Bumped on every onNames call; an onNames whose generation is stale by
   *  the time its (now-deduped) user-list promise resolves abandons its walk
   *  instead of writing host state (library/index/label/LS_PRESET) that a
   *  newer, still-in-flight onNames is about to overwrite anyway. */
  const namesGenRef = useRef(0);
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

  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 4000);
  }, []);
  useEffect(() => () => {
    mountedRef.current = false;
    if (toastTimer.current) clearTimeout(toastTimer.current);
  }, []);

  const readUserFile = useCallback(async (file: string) => {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<string>('presets_read', { file });
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
        const source = await resolveLoadSource(entry, readUserFile);
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
  }, [readUserFile, sendLoad, showToast]);

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

  /** Fires on every 'milkdrop:names' — first init AND hot re-inits. Rebuilds
   *  the library (frame names + user files) and restores the saved preset;
   *  after a re-init the frame has a blank visualizer, so always reload.
   *
   *  Two arrivals close together (the frame re-posts names on every proven
   *  'ready', and a >250ms main-thread stall — plausible while the ~846KB
   *  milkdrop chunk lands — can make a second 'ready' race the first's init)
   *  must not both start a walk: whichever ends up older abandons before
   *  touching host state, or indexRef/presetLabel/LS_PRESET can end up
   *  describing a preset the frame never actually settled on. */
  const onNames = useCallback(async (names: string[]) => {
    const gen = ++namesGenRef.current;
    const user = await getUserFiles();
    if (gen !== namesGenRef.current) return; // superseded by a newer onNames while we awaited
    libraryRef.current = mergePresetLibrary(names, user);
    setLibraryVersion((v) => v + 1);
    const lib = libraryRef.current;
    const savedKey = localStorage.getItem(LS_PRESET);
    const savedIndex = savedKey ? lib.findIndex((e) => e.key === savedKey) : -1;
    void loadAt(savedIndex >= 0 ? savedIndex : Math.floor(Math.random() * lib.length), 0);
  }, [loadAt, getUserFiles]);

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
        />
      )}
    </div>
  );
}

function PresetPicker({ library, failures, currentKey, accent, onPick, onClose }: {
  library: PresetEntry[];
  failures: Map<string, string>;
  currentKey?: string;
  accent: string;
  onPick: (index: number) => void;
  onClose: () => void;
}) {
  const bundledCount = library.filter((e) => e.source === 'bundled').length;
  const renderGroup = (source: 'bundled' | 'user', title: string) => {
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
        {renderGroup('bundled', `Bundled · ${bundledCount}`)}
        {renderGroup('user', 'Your presets — %APPDATA%\\com.secondmonitor.hub\\presets')}
        <div style={{
          padding: '8px 12px', fontSize: 10, color: 'rgba(255,255,255,0.35)',
          borderTop: '1px solid rgba(255,255,255,0.06)',
        }}>
          Drop Butterchurn .json presets in the folder above. MilkDrop 2 presets only — .milk2 (MilkDrop 3) is not supported.
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
