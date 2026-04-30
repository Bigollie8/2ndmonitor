import { useEffect, useState, type MutableRefObject } from 'react';
import type { SpectrumState } from '../state/tauri';
import type { VizMode } from '../types';
import { HiFiVizSurface } from './viz';

interface VizStyle { id: VizMode; label: string; desc: string }

export const VIZ_STYLES: VizStyle[] = [
  { id: 'bars',         label: 'Bars',         desc: 'Classic spectrum analyzer' },
  { id: 'waveform',     label: 'Waveform',     desc: 'Smooth oscilloscope' },
  { id: 'radial',       label: 'Radial',       desc: 'Circular spectrum' },
  { id: 'particles',    label: 'Particles',    desc: 'Drifting points' },
  { id: 'ambient',      label: 'Ambient',      desc: 'Slow morphing blobs' },
  { id: 'neonbars',     label: 'Neon bars',    desc: 'Glowing solid bars' },
  { id: 'splitmirror',  label: 'Split mirror', desc: 'Mirrored bars on a horizon' },
  { id: 'circular',     label: 'Circular pulse', desc: 'Radial w/ bass disc' },
  { id: 'tunnel',       label: 'Wave tunnel',  desc: 'Layered depth waveforms' },
  { id: 'pixelled',     label: 'Pixel LED',    desc: 'Retro LED matrix · heatmap' },
  { id: 'ribbon',       label: 'Ribbon',       desc: 'Filled symmetric flow' },
  { id: 'scope',        label: 'Oscilloscope', desc: 'CRT phosphor trace' },
  { id: 'spectrogram',  label: 'Spectrogram',  desc: 'Scrolling waterfall' },
  { id: 'vinyl',        label: 'Vinyl',        desc: 'Spinning record' },
  { id: 'kaleidoscope', label: 'Kaleidoscope', desc: 'Symmetric petals' },
  { id: 'freqgrid',     label: 'Freq grid',    desc: 'Time × frequency cells' },
  { id: 'minimal',      label: 'Minimal dots', desc: 'Bass / Mid / Treble pulse' },
  { id: 'starfield',    label: 'Starfield',    desc: 'Hyperspace · kick-flash bursts' },
  { id: 'perlin',       label: 'Perlin flow',  desc: 'Noise-field particles · drifting' },
  { id: 'orbital',      label: 'Orbital',      desc: 'Sun + 4 reactive frequency rings' },
  { id: 'aurora',       label: 'Aurora',       desc: 'Veils over moonlit horizon' },
  { id: 'city',         label: 'Neon city',    desc: 'Skyline w/ frequency-lit windows' },
  { id: 'strings',      label: 'Strings',      desc: 'Plucked physical strings' },
  { id: 'hud',          label: 'Aircraft HUD', desc: 'Reticle · pitch ladder · tapes' },
  { id: 'liquid',       label: 'Liquid',       desc: 'Metaball lava · bass merges' },
  { id: 'cassette',     label: 'Cassette',     desc: 'Tape deck · reels · VU meters' },
  { id: 'constellation', label: 'Constellation', desc: 'Particles connect when near' },
];

export function VizGallery({
  accent, accent2, spectrumRef, currentMode, onPick, onClose,
  sensitivity = 1, smoothing = 0,
}: {
  accent: string; accent2: string;
  spectrumRef?: MutableRefObject<SpectrumState>;
  currentMode: VizMode;
  onPick: (mode: VizMode) => void;
  onClose: () => void;
  sensitivity?: number;
  smoothing?: number;
}) {
  const [size, setSize] = useState<'compact' | 'regular' | 'large'>('regular');
  const cols = size === 'compact' ? 4 : size === 'regular' ? 3 : 2;
  const [focused, setFocused] = useState<VizMode | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Stop the App-level handler from also firing (e.g. closing edit
        // mode underneath us).
        e.stopPropagation();
        if (focused) setFocused(null);
        else onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [focused, onClose]);

  const focusedStyle = focused ? VIZ_STYLES.find((s) => s.id === focused) : null;

  return (
    <div onClick={onClose} style={{
      position: 'absolute', inset: 0, zIndex: 90,
      background: 'rgba(6,7,10,0.92)', backdropFilter: 'blur(20px)',
      overflowY: 'auto',
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        minHeight: '100%', position: 'relative', padding: '32px 48px 80px',
      }}>
        <div style={{
          position: 'sticky', top: 0, zIndex: 5,
          padding: '20px 0', marginBottom: 20,
          background: 'rgba(6,7,10,0.85)', backdropFilter: 'blur(20px)',
          borderBottom: '1px solid rgba(255,255,255,0.05)',
          display: 'flex', alignItems: 'center', gap: 24,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{
              width: 32, height: 32, borderRadius: 8,
              background: `linear-gradient(135deg, ${accent}, ${accent2})`,
              boxShadow: `0 0 20px ${accent}66`,
            }} />
            <h1 style={{ fontSize: 22, margin: 0, fontWeight: 700, letterSpacing: '-0.02em' }}>Visualizer Gallery</h1>
          </div>
          <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', fontFamily: '"JetBrains Mono", ui-monospace, monospace' }}>
            {VIZ_STYLES.length} styles · live preview
          </span>
          <div style={{ flex: 1 }} />
          {(['compact', 'regular', 'large'] as const).map((s) => (
            <button key={s} onClick={() => setSize(s)} style={{
              padding: '5px 10px', fontSize: 11,
              background: size === s ? `${accent}20` : 'transparent',
              color: size === s ? accent : 'rgba(255,255,255,0.55)',
              border: size === s ? `1px solid ${accent}55` : '1px solid rgba(255,255,255,0.08)',
              borderRadius: 5, cursor: 'pointer', fontWeight: 500,
            }}>{s === 'compact' ? '4 col' : s === 'regular' ? '3 col' : '2 col'}</button>
          ))}
          <button onClick={onClose} style={{
            padding: '6px 12px', fontSize: 12, color: 'rgba(255,255,255,0.5)',
            background: 'transparent', border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 6, cursor: 'pointer',
          }}>Esc</button>
        </div>

        <div style={{
          display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 20,
        }}>
          {VIZ_STYLES.map((s, i) => (
            <GalleryCard
              key={s.id}
              style={s}
              index={i + 1}
              accent={accent}
              accent2={accent2}
              spectrumRef={spectrumRef}
              active={s.id === currentMode}
              sensitivity={sensitivity}
              smoothing={smoothing}
              onPick={() => { onPick(s.id); onClose(); }}
              onFocus={() => setFocused(s.id)}
            />
          ))}
        </div>
      </div>

      {focusedStyle && (
        <div onClick={() => setFocused(null)} style={{
          position: 'fixed', inset: 0, zIndex: 100,
          background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(12px)',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          padding: 48, gap: 20,
        }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 16, width: '90%', maxWidth: 1600 }}>
            <h2 style={{ fontSize: 28, margin: 0, fontWeight: 700 }}>{focusedStyle.label}</h2>
            <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)' }}>{focusedStyle.desc}</span>
            <div style={{ flex: 1 }} />
            <button onClick={(e) => { e.stopPropagation(); onPick(focusedStyle.id); onClose(); }} style={{
              padding: '8px 14px', fontSize: 12, color: '#000', fontWeight: 700,
              background: accent, border: 'none', borderRadius: 6, cursor: 'pointer',
            }}>Apply</button>
            <button onClick={(e) => { e.stopPropagation(); setFocused(null); }} style={{
              padding: '8px 14px', fontSize: 12, color: 'rgba(255,255,255,0.6)',
              background: 'transparent', border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 6, cursor: 'pointer',
            }}>Esc</button>
          </div>
          <div onClick={(e) => e.stopPropagation()} style={{
            width: '90%', maxWidth: 1600, aspectRatio: '16/9',
            borderRadius: 14, overflow: 'hidden', position: 'relative',
            background: '#06070a',
            border: `1px solid ${accent}33`,
            boxShadow: `0 30px 80px -20px ${accent}66`,
          }}>
            <HiFiVizSurface mode={focusedStyle.id} accent={accent} accent2={accent2}
              spectrumRef={spectrumRef} sensitivity={sensitivity} smoothing={smoothing} />
          </div>
        </div>
      )}
    </div>
  );
}

function GalleryCard({
  style, index, accent, accent2, spectrumRef, active, sensitivity, smoothing,
  onPick, onFocus,
}: {
  style: VizStyle;
  index: number;
  accent: string; accent2: string;
  spectrumRef?: MutableRefObject<SpectrumState>;
  active: boolean;
  sensitivity: number; smoothing: number;
  onPick: () => void;
  onFocus: () => void;
}) {
  return (
    <div style={{
      position: 'relative',
      borderRadius: 12, overflow: 'hidden',
      background: '#06070a',
      border: active ? `2px solid ${accent}` : '1px solid rgba(255,255,255,0.06)',
      transition: 'border-color .15s, transform .15s',
      cursor: 'pointer',
    }}
    onMouseEnter={(e) => {
      if (!active) e.currentTarget.style.borderColor = `${accent}66`;
      e.currentTarget.style.transform = 'translateY(-2px)';
    }}
    onMouseLeave={(e) => {
      if (!active) e.currentTarget.style.borderColor = 'rgba(255,255,255,0.06)';
      e.currentTarget.style.transform = 'none';
    }}
    onClick={onPick}>
      <div style={{ position: 'relative', width: '100%', aspectRatio: '16/9', background: '#06070a' }}>
        <HiFiVizSurface mode={style.id} accent={accent} accent2={accent2}
          spectrumRef={spectrumRef} sensitivity={sensitivity} smoothing={smoothing} />
        <div style={{
          position: 'absolute', top: 12, left: 12,
          padding: '3px 8px', fontSize: 10, fontWeight: 600,
          background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(8px)',
          color: '#fff', borderRadius: 4,
          fontFamily: '"JetBrains Mono", ui-monospace, monospace',
          letterSpacing: '.05em',
        }}>{String(index).padStart(2, '0')}</div>
        <button onClick={(e) => { e.stopPropagation(); onFocus(); }}
          title="Open fullscreen preview"
          style={{
            position: 'absolute', top: 12, right: 12,
            width: 26, height: 26, borderRadius: 6,
            background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(8px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 11, color: 'rgba(255,255,255,0.7)',
            border: 'none', cursor: 'pointer',
          }}>⛶</button>
        {active && (
          <div style={{
            position: 'absolute', bottom: 12, left: 12,
            padding: '3px 8px', fontSize: 10, fontWeight: 700, letterSpacing: '.05em',
            background: accent, color: '#000', borderRadius: 4,
            fontFamily: '"JetBrains Mono", ui-monospace, monospace',
          }}>● ACTIVE</div>
        )}
      </div>
      <div style={{ padding: '14px 16px', display: 'flex', alignItems: 'baseline', gap: 12 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 3 }}>{style.label}</div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)' }}>{style.desc}</div>
        </div>
        <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)', fontFamily: '"JetBrains Mono", ui-monospace, monospace', textTransform: 'uppercase', letterSpacing: '.06em' }}>
          #{style.id}
        </span>
      </div>
    </div>
  );
}
