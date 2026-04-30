import React, { useState } from 'react';
import { ProfilePreview } from './profile';

const STEPS = ['Welcome', 'Audio source', 'Pick a profile', 'Connect tiles', 'Ready'];

export function Onboarding({ accent, onFinish }: { accent: string; onFinish: () => void }) {
  const [step, setStep] = useState(0);
  const [audio, setAudio] = useState('wasapi');
  const [profile, setProfile] = useState<string | null>(null);
  const [tiles, setTiles] = useState<Record<string, boolean>>({
    spotify: true, discord: true, calendar: true, sysmon: true, notes: false, weather: true,
  });

  return (
    <div style={{
      position: 'absolute', inset: 0, zIndex: 90,
      background: '#06070a',
      display: 'flex', flexDirection: 'column',
    }}>
      <div style={{
        position: 'absolute', inset: 0,
        background: `radial-gradient(ellipse at 30% 20%, ${accent}25 0%, transparent 50%), radial-gradient(ellipse at 70% 80%, ${accent}15 0%, transparent 50%)`,
        opacity: 0.7,
      }} />
      <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(ellipse at 50% 50%, transparent 30%, rgba(0,0,0,0.5) 100%)' }} />
      <div style={{ position: 'relative', zIndex: 2, padding: '32px 48px', display: 'flex', alignItems: 'center', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 28, height: 28, borderRadius: 8, background: `linear-gradient(135deg, ${accent}, ${accent}aa)`, boxShadow: `0 0 20px ${accent}66` }} />
          <span style={{ fontSize: 16, fontWeight: 700 }}>Hub</span>
        </div>
        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {STEPS.map((s, i) => (
            <React.Fragment key={s}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{
                  width: 22, height: 22, borderRadius: 11,
                  background: i < step ? accent : 'transparent',
                  border: i === step ? `2px solid ${accent}` : (i < step ? 'none' : '2px solid rgba(255,255,255,0.15)'),
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 10, fontWeight: 700, color: i < step ? '#000' : (i === step ? accent : 'rgba(255,255,255,0.3)'),
                }}>{i < step ? '✓' : i + 1}</div>
                <span style={{ fontSize: 12, color: i <= step ? '#fff' : 'rgba(255,255,255,0.3)', fontWeight: i === step ? 600 : 400 }}>{s}</span>
              </div>
              {i < STEPS.length - 1 && <div style={{ width: 24, height: 1, background: i < step ? accent : 'rgba(255,255,255,0.1)' }} />}
            </React.Fragment>
          ))}
        </div>
        <div style={{ flex: 1 }} />
        <button onClick={onFinish} style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', background: 'transparent', border: 'none', cursor: 'pointer' }}>Skip setup</button>
      </div>
      <div style={{ flex: 1, position: 'relative', zIndex: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40 }}>
        {step === 0 && <OnbWelcome accent={accent} />}
        {step === 1 && <OnbAudio accent={accent} value={audio} setValue={setAudio} />}
        {step === 2 && <OnbProfile accent={accent} value={profile} setValue={setProfile} />}
        {step === 3 && <OnbTiles accent={accent} tiles={tiles} setTiles={setTiles} />}
        {step === 4 && <OnbReady accent={accent} profile={profile} audio={audio} tiles={tiles} />}
      </div>
      <div style={{ position: 'relative', zIndex: 2, padding: '24px 48px', display: 'flex', alignItems: 'center', gap: 12, borderTop: '1px solid rgba(255,255,255,0.04)' }}>
        <button onClick={() => step > 0 && setStep(step - 1)} disabled={step === 0} style={{
          padding: '10px 18px', fontSize: 13, fontWeight: 500,
          background: 'transparent', color: step === 0 ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.7)',
          border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8,
          cursor: step === 0 ? 'default' : 'pointer',
        }}>← Back</button>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', fontFamily: '"JetBrains Mono", ui-monospace, monospace' }}>Step {step + 1} of {STEPS.length}</span>
        <div style={{ flex: 1 }} />
        {step < STEPS.length - 1 ? (
          <button onClick={() => setStep(step + 1)} style={{
            padding: '10px 22px', fontSize: 13, fontWeight: 600,
            background: accent, color: '#000', border: 'none', borderRadius: 8,
            cursor: 'pointer', boxShadow: `0 8px 24px -6px ${accent}aa`,
          }}>Continue →</button>
        ) : (
          <button onClick={onFinish} style={{
            padding: '10px 22px', fontSize: 13, fontWeight: 600,
            background: accent, color: '#000', border: 'none', borderRadius: 8,
            cursor: 'pointer', boxShadow: `0 8px 24px -6px ${accent}aa`,
          }}>Launch Hub →</button>
        )}
      </div>
    </div>
  );
}

function OnbWelcome({ accent }: { accent: string }) {
  return (
    <div style={{ maxWidth: 720, textAlign: 'center' }}>
      <div style={{
        width: 96, height: 96, margin: '0 auto 32px', borderRadius: 24,
        background: `linear-gradient(135deg, ${accent}, ${accent}66)`,
        boxShadow: `0 20px 80px -10px ${accent}88`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <span style={{ fontSize: 48, color: '#000', fontWeight: 800 }}>◢</span>
      </div>
      <h1 style={{ fontSize: 56, fontWeight: 800, margin: '0 0 16px 0', letterSpacing: '-0.03em' }}>
        Your second monitor, finally with a job.
      </h1>
      <p style={{ fontSize: 18, color: 'rgba(255,255,255,0.6)', lineHeight: 1.5, margin: '0 0 40px 0' }}>
        Hub turns spare screens into a glanceable cockpit. Audio reactive visualizers, system monitor, your apps as tiles —
        all themed to whatever's playing.
      </p>
      <div style={{ display: 'flex', gap: 24, justifyContent: 'center', marginTop: 48 }}>
        {[
          { i: '◢', label: 'Audio reactive' },
          { i: '▤', label: 'System monitor' },
          { i: '⊞', label: 'App tiles' },
          { i: '◐', label: 'Theme-linked' },
        ].map((f) => (
          <div key={f.label} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 48, height: 48, borderRadius: 10, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, color: accent }}>{f.i}</div>
            <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)' }}>{f.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function OnbAudio({ accent, value, setValue }: { accent: string; value: string; setValue: (s: string) => void }) {
  const SOURCES = [
    { id: 'wasapi',  name: 'System loopback', subtitle: 'Capture everything on this PC (recommended)', sub2: 'WASAPI · zero config',     icon: '◢' },
    { id: 'spotify', name: 'Spotify',         subtitle: 'Direct from Spotify with track metadata',     sub2: 'Connects to your account', icon: '♪' },
    { id: 'mic',     name: 'Microphone',      subtitle: 'Vocal-driven viz for streaming or DJ sets',   sub2: 'Default input device',     icon: '◓' },
    { id: 'cable',   name: 'Virtual cable',   subtitle: 'Route any specific app or hardware',          sub2: 'Advanced · VB-Audio',      icon: '⌥' },
  ];
  return (
    <div style={{ maxWidth: 880, width: '100%' }}>
      <h1 style={{ fontSize: 40, fontWeight: 700, margin: '0 0 8px 0', letterSpacing: '-0.02em', textAlign: 'center' }}>Where's the audio coming from?</h1>
      <p style={{ fontSize: 15, color: 'rgba(255,255,255,0.5)', margin: '0 0 36px 0', textAlign: 'center' }}>The visualizer needs an audio stream. You can change this anytime.</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 14 }}>
        {SOURCES.map((s) => (
          <button key={s.id} onClick={() => setValue(s.id)} style={{
            display: 'flex', alignItems: 'flex-start', gap: 16, padding: 20, borderRadius: 12,
            background: value === s.id ? `${accent}10` : 'rgba(255,255,255,0.02)',
            border: value === s.id ? `2px solid ${accent}` : '2px solid rgba(255,255,255,0.06)',
            color: '#fff', textAlign: 'left', cursor: 'pointer',
          }}>
            <div style={{ width: 44, height: 44, borderRadius: 10, background: value === s.id ? accent : 'rgba(255,255,255,0.04)', color: value === s.id ? '#000' : accent, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, flexShrink: 0 }}>{s.icon}</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>{s.name}</div>
              <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.6)', marginBottom: 6, lineHeight: 1.4 }}>{s.subtitle}</div>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', fontFamily: '"JetBrains Mono", ui-monospace, monospace', textTransform: 'uppercase', letterSpacing: '.06em' }}>{s.sub2}</div>
            </div>
            {value === s.id && <span style={{ fontSize: 14, color: accent }}>●</span>}
          </button>
        ))}
      </div>
    </div>
  );
}

function OnbProfile({ accent, value, setValue }: { accent: string; value: string | null; setValue: (s: string) => void }) {
  const PROFILES: { id: string; name: string; subtitle: string; layout: 'work' | 'gaming' | 'chill' }[] = [
    { id: 'work',   name: 'Work',   subtitle: 'Calendar, sysmon, notes — focus mode',     layout: 'work' },
    { id: 'gaming', name: 'Gaming', subtitle: 'Big viz hero with sysmon strip',           layout: 'gaming' },
    { id: 'chill',  name: 'Chill',  subtitle: 'Fullscreen ambient with glass overlays',   layout: 'chill' },
  ];
  return (
    <div style={{ maxWidth: 1200, width: '100%' }}>
      <h1 style={{ fontSize: 40, fontWeight: 700, margin: '0 0 8px 0', letterSpacing: '-0.02em', textAlign: 'center' }}>Pick a starter layout</h1>
      <p style={{ fontSize: 15, color: 'rgba(255,255,255,0.5)', margin: '0 0 36px 0', textAlign: 'center' }}>You can have multiple profiles and switch with ⌘1/2/3. Customize anytime.</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 18 }}>
        {PROFILES.map((p) => (
          <button key={p.id} onClick={() => setValue(p.id)} style={{
            padding: 0, borderRadius: 12, overflow: 'hidden', textAlign: 'left',
            background: value === p.id ? `${accent}10` : 'rgba(255,255,255,0.02)',
            border: value === p.id ? `2px solid ${accent}` : '2px solid rgba(255,255,255,0.06)',
            cursor: 'pointer', color: '#fff',
            transform: value === p.id ? 'translateY(-2px)' : 'none',
            boxShadow: value === p.id ? `0 12px 40px -8px ${accent}88` : 'none',
          }}>
            <ProfilePreview layout={p.layout} accent={accent} />
            <div style={{ padding: 18 }}>
              <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>{p.name}</div>
              <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.55)' }}>{p.subtitle}</div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function OnbTiles({ accent, tiles, setTiles }: { accent: string; tiles: Record<string, boolean>; setTiles: (t: Record<string, boolean>) => void }) {
  const AVAILABLE = [
    { id: 'spotify',  name: 'Spotify',          desc: 'Now playing + remote',     icon: '♪', type: 'integration' },
    { id: 'discord',  name: 'Discord',          desc: 'Channels + voice',         icon: '◇', type: 'integration' },
    { id: 'calendar', name: 'Calendar',         desc: 'Today + upcoming',         icon: '◫', type: 'integration' },
    { id: 'sysmon',   name: 'System monitor',   desc: 'Always available',         icon: '▤', type: 'built-in', locked: true },
    { id: 'notes',    name: 'Notes scratchpad', desc: 'Markdown · auto-save',     icon: '✎', type: 'built-in' },
    { id: 'weather',  name: 'Weather + clock',  desc: 'Local conditions',         icon: '◐', type: 'built-in' },
    { id: 'youtube',  name: 'YouTube',          desc: 'Pinned video',             icon: '▶', type: 'integration' },
    { id: 'web',      name: 'Custom web tile',  desc: 'Any URL',                  icon: '◰', type: 'built-in' },
  ];
  return (
    <div style={{ maxWidth: 980, width: '100%' }}>
      <h1 style={{ fontSize: 40, fontWeight: 700, margin: '0 0 8px 0', letterSpacing: '-0.02em', textAlign: 'center' }}>Connect your tiles</h1>
      <p style={{ fontSize: 15, color: 'rgba(255,255,255,0.5)', margin: '0 0 36px 0', textAlign: 'center' }}>Tap to add. Integrations open auth in a popup. Add more anytime from edit mode.</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        {AVAILABLE.map((t) => {
          const on = !!tiles[t.id];
          const locked = t.locked;
          return (
            <button key={t.id} onClick={() => !locked && setTiles({ ...tiles, [t.id]: !on })} style={{
              padding: 16, borderRadius: 10, textAlign: 'left',
              background: on ? `${accent}10` : 'rgba(255,255,255,0.02)',
              border: on ? `1.5px solid ${accent}` : '1.5px solid rgba(255,255,255,0.06)',
              color: '#fff', cursor: locked ? 'default' : 'pointer',
              opacity: locked ? 0.7 : 1,
              display: 'flex', flexDirection: 'column', gap: 8,
              minHeight: 110,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ width: 36, height: 36, borderRadius: 8, background: on ? accent : 'rgba(255,255,255,0.04)', color: on ? '#000' : accent, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>{t.icon}</div>
                {on ? (
                  <span style={{ fontSize: 10, color: accent, padding: '2px 8px', background: `${accent}20`, borderRadius: 3, fontFamily: '"JetBrains Mono", ui-monospace, monospace' }}>● ADDED</span>
                ) : locked ? (
                  <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', padding: '2px 8px', background: 'rgba(255,255,255,0.04)', borderRadius: 3, fontFamily: '"JetBrains Mono", ui-monospace, monospace' }}>LOCKED</span>
                ) : (
                  <span style={{ fontSize: 14, color: 'rgba(255,255,255,0.3)' }}>+</span>
                )}
              </div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 2 }}>{t.name}</div>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', marginBottom: 4 }}>{t.desc}</div>
                <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)', fontFamily: '"JetBrains Mono", ui-monospace, monospace', textTransform: 'uppercase', letterSpacing: '.06em' }}>{t.type}</div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function OnbReady({ accent, profile, audio, tiles }: { accent: string; profile: string | null; audio: string; tiles: Record<string, boolean> }) {
  const tileCount = Object.values(tiles).filter(Boolean).length;
  return (
    <div style={{ maxWidth: 720, textAlign: 'center' }}>
      <div style={{
        width: 96, height: 96, margin: '0 auto 32px', borderRadius: 24,
        background: `linear-gradient(135deg, ${accent}, ${accent}88)`,
        boxShadow: `0 20px 80px -10px ${accent}88`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <span style={{ fontSize: 48, color: '#000', fontWeight: 800 }}>✓</span>
      </div>
      <h1 style={{ fontSize: 48, fontWeight: 800, margin: '0 0 16px 0', letterSpacing: '-0.03em' }}>You're set.</h1>
      <p style={{ fontSize: 16, color: 'rgba(255,255,255,0.6)', lineHeight: 1.5, margin: '0 0 40px 0' }}>
        Hub will launch with your <b style={{ color: accent }}>{profile || 'Work'}</b> profile, <b style={{ color: accent }}>{tileCount}</b> tiles, audio from <b style={{ color: accent }}>{audio === 'wasapi' ? 'system loopback' : audio}</b>.
      </p>
      <div style={{
        padding: 20, borderRadius: 12, background: 'rgba(255,255,255,0.02)',
        border: '1px solid rgba(255,255,255,0.06)', textAlign: 'left',
        display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12,
      }}>
        <KbHint k="⌘ E" desc="Toggle edit mode" />
        <KbHint k="⌘ 1/2/3" desc="Switch profiles" />
        <KbHint k="⌘ K" desc="Command palette" />
        <KbHint k="⌘ ," desc="Settings" />
        <KbHint k="V" desc="Cycle viz mode" />
        <KbHint k="?" desc="All shortcuts" />
      </div>
    </div>
  );
}

function KbHint({ k, desc }: { k: string; desc: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <kbd style={{
        padding: '4px 10px', fontSize: 11, fontWeight: 600,
        background: 'rgba(255,255,255,0.06)', color: '#fff',
        border: '1px solid rgba(255,255,255,0.1)', borderRadius: 5,
        fontFamily: '"JetBrains Mono", ui-monospace, monospace',
        minWidth: 60, textAlign: 'center',
      }}>{k}</kbd>
      <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)' }}>{desc}</span>
    </div>
  );
}
