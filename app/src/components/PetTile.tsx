import React, { useEffect, useMemo, useRef, useState } from 'react';
import { HFTile } from './tiles';
import {
  type PetMood,
  type PetState,
  MOOD_LABELS,
  PET_NAME_MAX,
  deriveMood,
  feedPet,
  hydratePet,
  petAgeDays,
  playWithPet,
  renamePet,
  strokePet,
  tickPet,
} from '../state/pet';
import type { Density } from '../types';

const MONO = '"JetBrains Mono", ui-monospace, monospace';

/** Re-render cadence — the meters move ~0.2/min, so once a minute is plenty.
 *  Display is always derived live from the persisted state via tickPet, so
 *  this interval is purely cosmetic and never drifts the model. */
const RENDER_TICK_MS = 60 * 1000;
/** How often the ticked state is written back to Tweaks (which serializes
 *  the whole settings object to disk). Actions persist immediately. */
const PERSIST_TICK_MS = 5 * 60 * 1000;

/** One-shot reaction frame after an action, so the pet visibly responds. */
const REACT_MS = 900;

export interface PetTileProps {
  density: Density;
  accent: string;
  editing: boolean;
  state: PetState;
  setState: (next: PetState) => void;
}

type Reaction = 'eat' | 'bounce' | 'purr' | null;

export function PetTile({ density, accent, editing, state, setState }: PetTileProps) {
  const [now, setNow] = useState(() => Date.now());
  const [reaction, setReaction] = useState<Reaction>(null);
  const reactTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  // Persisted state may predate this tile (mergeTweaks fills a missing `pet`
  // with DEFAULT_PET_STATE, whose timestamps are 0) or be hand-edited JSON —
  // coerce every read, and adopt the pet on first sight.
  const hydrated = useMemo(() => hydratePet(state, now), [state, now]);
  useEffect(() => {
    if (state.born <= 0 || state.lastTickAt <= 0) setState(hydratePet(state, Date.now()));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.born, state.lastTickAt]);

  // Cosmetic re-render tick; no rAF anywhere in this tile.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), RENDER_TICK_MS);
    return () => clearInterval(id);
  }, []);

  // Sparse persistence of elapsed progression.
  useEffect(() => {
    const id = setInterval(() => {
      const cur = stateRef.current;
      if (cur.born <= 0) return;
      setState(tickPet(hydratePet(cur, Date.now()), Date.now()));
    }, PERSIST_TICK_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => () => { if (reactTimer.current) clearTimeout(reactTimer.current); }, []);

  const live = tickPet(hydrated, now);
  const mood = deriveMood(live, new Date(now).getHours());
  const ageDays = petAgeDays(live, now);

  const react = (r: Reaction) => {
    if (reactTimer.current) clearTimeout(reactTimer.current);
    setReaction(r);
    reactTimer.current = setTimeout(() => setReaction(null), REACT_MS);
  };
  const act = (fn: (s: PetState, t: number) => PetState, r: Reaction) => {
    const t = Date.now();
    setNow(t);
    setState(fn(hydrated, t));
    react(r);
  };

  const headRight = (
    <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.45)', fontFamily: MONO }}>
      {ageDays === 0 ? 'new' : `${ageDays}d`}
    </span>
  );

  return (
    <HFTile title="Pet" headRight={headRight} accent={accent} density={density} style={{ height: '100%' }}>
      <style>{PET_CSS}</style>
      <div style={{
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        width: '100%', height: '100%', gap: 6, padding: '0 10px 8px',
        boxSizing: 'border-box',
      }}>
        <Creature mood={mood} reaction={reaction} accent={accent} />

        <NameLine name={live.name} mood={mood} editing={editing}
          onRename={(n) => setState(renamePet(hydrated, n))} />

        <div style={{ display: 'flex', gap: 10, width: '100%', maxWidth: 220 }}>
          <Meter label="Food" value={100 - live.hunger} color={accent} />
          <Meter label="Joy" value={live.happiness} color={accent} />
        </div>

        <div style={{ display: 'flex', gap: 6, marginTop: 2, flexWrap: 'wrap', justifyContent: 'center' }}>
          <ActionButton onClick={() => act(feedPet, 'eat')} accent={accent} primary={mood === 'hungry'}>Feed</ActionButton>
          <ActionButton onClick={() => act(playWithPet, 'bounce')} accent={accent} primary={mood === 'sad'}>Play</ActionButton>
          <ActionButton onClick={() => act(strokePet, 'purr')} accent={accent}>Pet</ActionButton>
        </div>
      </div>
    </HFTile>
  );
}

// ---------------------------------------------------------------- creature

const MOOD_TINT: Record<PetMood, string> = {
  happy: 'rgba(255,255,255,0.92)',
  content: 'rgba(255,255,255,0.82)',
  hungry: 'rgba(255,255,255,0.66)',
  sad: 'rgba(255,255,255,0.58)',
  sleepy: 'rgba(255,255,255,0.72)',
};

function Creature({ mood, reaction, accent }: { mood: PetMood; reaction: Reaction; accent: string }) {
  const asleep = mood === 'sleepy';
  const cls = ['pet-body', `pet-${mood}`, reaction ? `pet-react-${reaction}` : ''].filter(Boolean).join(' ');
  return (
    <div className="pet-stage" aria-label={`${MOOD_LABELS[mood]} pet`} role="img">
      <div className={cls} style={{
        // Accent tints the blob; mood sets its brightness.
        background: `linear-gradient(160deg, ${MOOD_TINT[mood]}, ${accent}cc)`,
        boxShadow: `0 6px 18px -6px ${accent}66`,
      }}>
        <div className="pet-face">
          <div className={`pet-eye${asleep ? ' pet-eye-closed' : ''}`} />
          <div className={`pet-eye${asleep ? ' pet-eye-closed' : ''}`} />
        </div>
        <div className={`pet-mouth pet-mouth-${mood}`} />
        {(mood === 'happy' || reaction === 'purr') && <div className="pet-cheek pet-cheek-l" />}
        {(mood === 'happy' || reaction === 'purr') && <div className="pet-cheek pet-cheek-r" />}
      </div>
      {asleep && <div className="pet-zz" style={{ color: accent }}>z<span>z</span></div>}
      {reaction === 'eat' && <div className="pet-crumb" style={{ background: accent }} />}
      <div className="pet-shadow" />
    </div>
  );
}

function NameLine({ name, mood, editing, onRename }: {
  name: string; mood: PetMood; editing: boolean; onRename: (n: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => { if (draft !== null) onRename(draft); setDraft(null); };
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, minHeight: 18 }}>
      {draft === null ? (
        <button
          onClick={() => { if (!editing) setDraft(name); }}
          title="Rename"
          style={{
            background: 'transparent', border: 'none', padding: 0, cursor: editing ? 'default' : 'text',
            fontSize: 13, fontWeight: 700, color: '#fff', fontFamily: 'inherit', letterSpacing: '0.01em',
          }}
        >{name}</button>
      ) : (
        <input
          autoFocus
          value={draft}
          maxLength={PET_NAME_MAX}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
            else if (e.key === 'Escape') setDraft(null);
          }}
          style={{
            width: 110, fontSize: 12, padding: '1px 6px', borderRadius: 4,
            background: 'rgba(255,255,255,0.06)', color: '#fff',
            border: '1px solid rgba(255,255,255,0.15)', fontFamily: 'inherit',
          }}
        />
      )}
      <span style={{
        fontSize: 10, color: 'rgba(255,255,255,0.5)',
        textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600,
      }}>{MOOD_LABELS[mood]}</span>
    </div>
  );
}

function Meter({ label, value, color }: { label: string; value: number; color: string }) {
  const pct = Math.round(Math.max(0, Math.min(100, value)));
  return (
    <div style={{ flex: 1, minWidth: 0 }} title={`${label} ${pct}%`}>
      <div style={{
        display: 'flex', justifyContent: 'space-between', fontSize: 9, marginBottom: 2,
        color: 'rgba(255,255,255,0.5)', fontFamily: MONO, letterSpacing: '0.06em',
      }}>
        <span>{label.toUpperCase()}</span><span>{pct}</span>
      </div>
      <div style={{ height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
        <div style={{
          width: `${pct}%`, height: '100%', borderRadius: 2,
          background: pct < 30 ? 'rgba(255,255,255,0.45)' : color,
          transition: 'width .4s ease',
        }} />
      </div>
    </div>
  );
}

function ActionButton({ onClick, accent, primary, children }: {
  onClick: () => void; accent: string; primary?: boolean; children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '4px 10px', fontSize: 10.5, fontWeight: 600, borderRadius: 5,
        background: primary ? `${accent}22` : 'rgba(255,255,255,0.05)',
        color: primary ? accent : 'rgba(255,255,255,0.75)',
        border: primary ? `1px solid ${accent}55` : '1px solid rgba(255,255,255,0.08)',
        cursor: 'pointer', fontFamily: 'inherit',
      }}
    >{children}</button>
  );
}

// ---------------------------------------------------------------- CSS
// All idle motion is transform/opacity keyframes (compositor-only, no layout
// or paint on the main thread) and stops under prefers-reduced-motion.

const PET_CSS = `
.pet-stage { position: relative; width: 72px; height: 66px; flex-shrink: 0; }
.pet-body {
  position: absolute; left: 6px; top: 4px; width: 60px; height: 52px;
  border-radius: 48% 52% 50% 50% / 60% 60% 40% 40%;
  transform-origin: 50% 100%;
  animation: pet-breathe 3.6s ease-in-out infinite;
}
.pet-sleepy { animation-duration: 5.5s; }
.pet-sad { transform: translateY(3px) scale(0.96, 0.92); animation: pet-breathe-slow 4.8s ease-in-out infinite; }
.pet-hungry { animation-duration: 2.6s; }
.pet-face { position: absolute; left: 0; right: 0; top: 40%; display: flex; justify-content: center; gap: 14px; }
.pet-eye {
  width: 7px; height: 9px; border-radius: 50%; background: rgba(12,14,20,0.9);
  transform-origin: 50% 50%;
  animation: pet-blink 4.2s ease-in-out infinite;
}
.pet-eye:nth-child(2) { animation-delay: 0.08s; }
.pet-eye-closed { height: 2px; border-radius: 2px; animation: none; }
.pet-sad .pet-eye { height: 6px; transform: translateY(2px); }
.pet-mouth {
  position: absolute; left: 50%; top: 66%; width: 10px; height: 5px; margin-left: -5px;
  border: 2px solid rgba(12,14,20,0.85); border-top: none; border-radius: 0 0 10px 10px;
}
.pet-mouth-content { width: 8px; height: 3px; margin-left: -4px; }
.pet-mouth-sleepy { width: 5px; height: 4px; margin-left: -2.5px; border-radius: 50%; border-top: 2px solid rgba(12,14,20,0.85); }
.pet-mouth-hungry { width: 7px; height: 7px; margin-left: -3.5px; border-radius: 50%; border-top: 2px solid rgba(12,14,20,0.85); }
.pet-mouth-sad { border: none; border-top: 2px solid rgba(12,14,20,0.85); border-radius: 10px 10px 0 0; top: 70%; }
.pet-cheek { position: absolute; top: 56%; width: 8px; height: 4px; border-radius: 50%; background: rgba(255,120,140,0.45); }
.pet-cheek-l { left: 12px; } .pet-cheek-r { right: 12px; }
.pet-shadow {
  position: absolute; left: 14px; right: 14px; bottom: 0; height: 6px; border-radius: 50%;
  background: rgba(0,0,0,0.35); filter: blur(2px);
  animation: pet-shadow 3.6s ease-in-out infinite;
}
.pet-zz {
  position: absolute; right: -2px; top: -4px; font: 700 11px ${MONO}; opacity: 0.8;
  animation: pet-zz 2.4s ease-in-out infinite;
}
.pet-zz span { font-size: 8px; margin-left: 1px; }
.pet-crumb { position: absolute; left: 50%; bottom: 10px; width: 5px; height: 5px; border-radius: 50%; margin-left: -2px; animation: pet-crumb ${REACT_MS}ms ease-out forwards; }
.pet-react-bounce { animation: pet-bounce ${REACT_MS}ms cubic-bezier(.3,1.4,.5,1) 1; }
.pet-react-eat { animation: pet-chomp ${REACT_MS}ms ease-in-out 1; }
.pet-react-purr { animation: pet-wiggle ${REACT_MS}ms ease-in-out 1; }

@keyframes pet-breathe { 0%,100% { transform: scale(1,1) } 50% { transform: scale(1.03,0.97) } }
@keyframes pet-breathe-slow { 0%,100% { transform: translateY(3px) scale(0.96,0.92) } 50% { transform: translateY(3px) scale(0.98,0.90) } }
@keyframes pet-shadow { 0%,100% { transform: scaleX(1); opacity: .35 } 50% { transform: scaleX(1.06); opacity: .28 } }
@keyframes pet-blink { 0%,92%,100% { transform: scaleY(1) } 95% { transform: scaleY(0.1) } }
@keyframes pet-zz { 0% { transform: translate(0,0); opacity: 0 } 30% { opacity: .9 } 100% { transform: translate(6px,-10px); opacity: 0 } }
@keyframes pet-bounce { 0% { transform: translateY(0) } 35% { transform: translateY(-14px) scale(0.96,1.06) } 70% { transform: translateY(0) scale(1.05,0.94) } 100% { transform: translateY(0) } }
@keyframes pet-chomp { 0%,100% { transform: scale(1) } 25% { transform: scale(1.08,0.94) } 50% { transform: scale(0.96,1.05) } 75% { transform: scale(1.06,0.96) } }
@keyframes pet-wiggle { 0%,100% { transform: rotate(0) } 25% { transform: rotate(-5deg) } 75% { transform: rotate(5deg) } }
@keyframes pet-crumb { 0% { transform: translateY(-26px) scale(1); opacity: 1 } 70% { transform: translateY(-6px) scale(0.8); opacity: 1 } 100% { transform: translateY(-2px) scale(0); opacity: 0 } }

@media (prefers-reduced-motion: reduce) {
  .pet-body, .pet-eye, .pet-shadow, .pet-zz, .pet-crumb,
  .pet-react-bounce, .pet-react-eat, .pet-react-purr { animation: none !important; }
}
`;
