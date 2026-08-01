import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useAnimateGate, getVizDpr, type VizProps } from './viz';
import { useWaveformRef } from '../state/waveform';
import { makeButterchurnLevels } from '../state/waveform-levels';
import {
  mergePresetLibrary, resolvePreset, type PresetEntry, type PresetDeps,
} from '../state/milkdrop-presets';
import type { BCVisualizer } from 'butterchurn';

/** MilkDrop 2 presets via Butterchurn (WebGL2). Fed by `audio:waveform` raw
 *  samples from Rust — no Web Audio graph involved. In `preview` mode
 *  (gallery grid) renders a cheap 2D placeholder instead: the gallery mounts
 *  all surfaces simultaneously and Chromium caps live WebGL contexts (~16). */
export function VizMilkdrop({ accent, accent2, spectrumRef, paused, preview }: VizProps) {
  if (preview) return <MilkdropPreviewCard accent={accent} accent2={accent2} />;
  return <MilkdropSurface accent={accent} spectrumRef={spectrumRef} paused={paused} />;
}

const AUTO_ADVANCE_MS = 30_000;
const BLEND_SECONDS = 2.7;
const LS_PRESET = 'milkdrop.preset';
const LS_AUTO = 'milkdrop.autoAdvance';

function MilkdropSurface({ accent, paused }: Pick<VizProps, 'accent' | 'spectrumRef' | 'paused'>) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const waveRef = useWaveformRef();
  const gate = useAnimateGate(paused, 'milkdrop');

  const vizRef = useRef<BCVisualizer | null>(null);
  const depsRef = useRef<PresetDeps | null>(null);
  const libraryRef = useRef<PresetEntry[]>([]);
  const indexRef = useRef(0);
  /** key → resolution error message, shown as ⚠ in the picker. */
  const failuresRef = useRef(new Map<string, string>());

  const [presetLabel, setPresetLabel] = useState('');
  const [fatal, setFatal] = useState('');
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

  /** Load library[index]; on failure, record it, toast, and walk forward
   *  until something loads (at most one full lap). */
  const loadAt = useCallback(async (index: number, blend: number) => {
    const lib = libraryRef.current;
    const viz = vizRef.current;
    const deps = depsRef.current;
    if (!lib.length || !viz || !deps) return;
    for (let attempt = 0; attempt < lib.length; attempt++) {
      const i = (index + attempt + lib.length) % lib.length;
      const entry = lib[i];
      try {
        const preset = await resolvePreset(entry, deps);
        viz.loadPreset(preset, blend);
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
  }, [showToast]);

  const advance = useCallback((how: 'next' | 'prev' | 'random', blend = BLEND_SECONDS) => {
    const lib = libraryRef.current;
    if (!lib.length) return;
    let target = indexRef.current;
    if (how === 'next') target = indexRef.current + 1;
    else if (how === 'prev') target = indexRef.current - 1;
    else {
      // Random ≠ current so the button always visibly does something.
      if (lib.length > 1) {
        do { target = Math.floor(Math.random() * lib.length); } while (target === indexRef.current);
      }
    }
    void loadAt(target, blend);
  }, [loadAt]);

  useEffect(() => {
    let disposed = false;
    let raf = 0;
    let resizeObs: ResizeObserver | null = null;
    const levels = makeButterchurnLevels();

    (async () => {
      try {
        const [{ default: butterchurn }, { default: presetPack }, { invoke }] = await Promise.all([
          import('butterchurn'),
          import('butterchurn-presets'),
          import('@tauri-apps/api/core'),
        ]);
        if (disposed || !canvasRef.current || !hostRef.current) return;

        const bundled = presetPack.getPresets();
        let user: { name: string; file: string; ext: string }[] = [];
        try {
          user = await invoke<{ name: string; file: string; ext: string }[]>('presets_list');
        } catch {
          // Preset folder unreadable — bundled pack still works.
        }
        libraryRef.current = mergePresetLibrary(bundled, user);
        depsRef.current = {
          bundled,
          readUserFile: (file) => invoke<string>('presets_read', { file }),
        };
        setLibraryVersion((v) => v + 1);

        const rect = hostRef.current.getBoundingClientRect();
        const dpr = getVizDpr();
        const w = Math.max(2, Math.round(rect.width * dpr));
        const h = Math.max(2, Math.round(rect.height * dpr));
        canvasRef.current.width = w;
        canvasRef.current.height = h;
        vizRef.current = butterchurn.createVisualizer(null, canvasRef.current, { width: w, height: h });

        // Resume the last-viewed preset when it still exists; random otherwise.
        const lib = libraryRef.current;
        const savedKey = localStorage.getItem(LS_PRESET);
        const savedIndex = savedKey ? lib.findIndex((e) => e.key === savedKey) : -1;
        await loadAt(savedIndex >= 0 ? savedIndex : Math.floor(Math.random() * lib.length), 0);

        resizeObs = new ResizeObserver(() => {
          const viz = vizRef.current;
          if (!viz || !hostRef.current || !canvasRef.current) return;
          const r = hostRef.current.getBoundingClientRect();
          const d = getVizDpr();
          const nw = Math.max(2, Math.round(r.width * d));
          const nh = Math.max(2, Math.round(r.height * d));
          canvasRef.current.width = nw;
          canvasRef.current.height = nh;
          viz.setRendererSize(nw, nh);
        });
        resizeObs.observe(hostRef.current);

        const tick = () => {
          if (disposed) return;
          if (gate.shouldDraw() && vizRef.current) {
            levels.update(waveRef.current.mono);
            vizRef.current.render({ audioLevels: levels.levels });
          }
          raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      } catch (e) {
        if (!disposed) setFatal(String(e));
      }
    })();

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      resizeObs?.disconnect();
      vizRef.current = null;
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      ref={hostRef}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ position: 'absolute', inset: 0, background: '#000', overflow: 'hidden' }}
    >
      <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />

      {presetLabel && (
        <div style={{
          position: 'absolute', left: 10, bottom: 8, fontSize: 10,
          color: 'rgba(255,255,255,0.45)', fontFamily: '"JetBrains Mono", ui-monospace, monospace',
          maxWidth: '60%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          pointerEvents: 'none',
        }}>{presetLabel}</div>
      )}

      <div style={{
        position: 'absolute', right: 10, bottom: 8, display: 'flex', gap: 6,
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
          position: 'absolute', left: '50%', top: 12, transform: 'translateX(-50%)',
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

      {fatal && (
        <div style={{
          position: 'absolute', inset: 0, display: 'grid', placeItems: 'center',
          color: accent, fontSize: 12, padding: 16, textAlign: 'center',
        }}>
          MilkDrop failed to start: {fatal}
        </div>
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
