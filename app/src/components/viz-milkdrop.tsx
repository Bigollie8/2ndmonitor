import { useEffect, useRef, useState } from 'react';
import { useAnimateGate, getVizDpr, type VizProps } from './viz';
import { useWaveformRef } from '../state/waveform';
import { makeButterchurnLevels } from '../state/waveform-levels';
import type { BCVisualizer } from 'butterchurn';

/** MilkDrop 2 presets via Butterchurn (WebGL2). Fed by `audio:waveform` raw
 *  samples from Rust — no Web Audio graph involved. In `preview` mode
 *  (gallery grid) renders a cheap 2D placeholder instead: the gallery mounts
 *  all surfaces simultaneously and Chromium caps live WebGL contexts (~16). */
export function VizMilkdrop({ accent, accent2, spectrumRef, paused, preview }: VizProps) {
  if (preview) return <MilkdropPreviewCard accent={accent} accent2={accent2} />;
  return <MilkdropSurface accent={accent} spectrumRef={spectrumRef} paused={paused} />;
}

function MilkdropSurface({ accent, paused }: Pick<VizProps, 'accent' | 'spectrumRef' | 'paused'>) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const waveRef = useWaveformRef();
  const gate = useAnimateGate(paused, 'milkdrop');
  const [presetName, setPresetName] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let disposed = false;
    let raf = 0;
    let viz: BCVisualizer | null = null;
    let resizeObs: ResizeObserver | null = null;
    const levels = makeButterchurnLevels();

    (async () => {
      try {
        const [{ default: butterchurn }, { default: presetPack }] = await Promise.all([
          import('butterchurn'),
          import('butterchurn-presets'),
        ]);
        if (disposed || !canvasRef.current || !hostRef.current) return;
        const rect = hostRef.current.getBoundingClientRect();
        const dpr = getVizDpr();
        const w = Math.max(2, Math.round(rect.width * dpr));
        const h = Math.max(2, Math.round(rect.height * dpr));
        canvasRef.current.width = w;
        canvasRef.current.height = h;
        viz = butterchurn.createVisualizer(null, canvasRef.current, { width: w, height: h });
        const presets = presetPack.getPresets();
        const names = Object.keys(presets);
        const pick = names[Math.floor(Math.random() * names.length)];
        viz.loadPreset(presets[pick], 0);
        setPresetName(pick);

        resizeObs = new ResizeObserver(() => {
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
          if (gate.shouldDraw() && viz) {
            levels.update(waveRef.current.mono);
            viz.render({ audioLevels: levels.levels });
          }
          raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      } catch (e) {
        if (!disposed) setError(String(e));
      }
    })();

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      resizeObs?.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div ref={hostRef} style={{ position: 'absolute', inset: 0, background: '#000', overflow: 'hidden' }}>
      <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />
      {presetName && (
        <div style={{
          position: 'absolute', left: 10, bottom: 8, fontSize: 10,
          color: 'rgba(255,255,255,0.45)', fontFamily: '"JetBrains Mono", ui-monospace, monospace',
          maxWidth: '80%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          pointerEvents: 'none',
        }}>{presetName}</div>
      )}
      {error && (
        <div style={{
          position: 'absolute', inset: 0, display: 'grid', placeItems: 'center',
          color: accent, fontSize: 12, padding: 16, textAlign: 'center',
        }}>
          MilkDrop failed to start: {error}
        </div>
      )}
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
