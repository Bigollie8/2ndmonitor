import React, { useEffect, useState } from 'react';
import { ProfilePreview } from './profile';
import { geocode, type GeocodeResult } from '../state/weatherLocation';
import type { WeatherLocation } from '../types';

const STEPS = ['Welcome', 'Pick a profile', 'Your location', 'Ready'];

export interface OnboardingResult {
  audio?: string;          // legacy — no longer collected; kept optional so App.tsx compiles
  profileId?: string;      // id of profile chosen on the "Pick a profile" step
  hiddenForActive?: Partial<Record<string, boolean>>; // legacy — no longer collected; kept optional so App.tsx compiles
  /** Chosen on the "Your location" step (0.9.6) — undefined means the user
   *  skipped it, and the labelled default stays. */
  weatherLocation?: WeatherLocation;
}

export function Onboarding({ accent, profiles, onFinish }: {
  accent: string;
  profiles: { id: string; name: string }[];
  onFinish: (result?: OnboardingResult) => void;
}) {
  const [step, setStep] = useState(0);
  const [profile, setProfile] = useState<string | null>(null);
  const [location, setLocation] = useState<WeatherLocation | null>(null);

  const buildResult = (): OnboardingResult => ({
    profileId: profile ?? undefined,
    weatherLocation: location ?? undefined,
  });

  return (
    <div style={{
      position: 'absolute', inset: 0, zIndex: 90,
      background: 'var(--surface-canvas, #06070a)',
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
        <button onClick={() => onFinish()} style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', background: 'transparent', border: 'none', cursor: 'pointer' }}>Skip setup</button>
      </div>
      <div style={{ flex: 1, position: 'relative', zIndex: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40 }}>
        {step === 0 && <OnbWelcome accent={accent} />}
        {step === 1 && <OnbProfile accent={accent} profiles={profiles} value={profile} setValue={setProfile} />}
        {step === 2 && <OnbLocation accent={accent} value={location} setValue={setLocation} />}
        {step === 3 && <OnbReady accent={accent} profile={profile} profiles={profiles} />}
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
          <button onClick={() => onFinish(buildResult())} style={{
            padding: '10px 22px', fontSize: 13, fontWeight: 600,
            background: accent, color: '#000', border: 'none', borderRadius: 8,
            cursor: 'pointer', boxShadow: `0 8px 24px -6px ${accent}aa`,
          }}>Launch Hub →</button>
        )}
      </div>
    </div>
  );
}

/** "Your location" (0.9.6) — every fresh install used to start on the
 *  hardcoded Knoxville default with nothing ever asking. One search step:
 *  the same Open-Meteo geocoder Settings uses, skippable (the footer's
 *  Continue works with nothing chosen; the copy says what the default is). */
function OnbLocation({ accent, value, setValue }: {
  accent: string;
  value: WeatherLocation | null;
  setValue: (l: WeatherLocation | null) => void;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GeocodeResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setResults([]); setSearching(false); return; }
    setSearching(true);
    const id = window.setTimeout(() => {
      geocode(q)
        .then((r) => { setResults(r); setSearching(false); setError(null); })
        .catch(() => { setSearching(false); setError('Search failed — check your connection, or skip this step.'); });
    }, 350);
    return () => window.clearTimeout(id);
  }, [query]);

  const field: React.CSSProperties = {
    width: '100%', padding: '10px 14px', fontSize: 14, borderRadius: 8,
    background: 'rgba(0,0,0,0.3)', color: '#fff', outline: 'none',
    border: '1px solid rgba(255,255,255,0.1)', fontFamily: 'inherit',
  };
  return (
    <div style={{ maxWidth: 560, width: '100%', textAlign: 'center' }}>
      <h2 style={{ fontSize: 24, fontWeight: 700, margin: '0 0 10px' }}>Where are you?</h2>
      <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.55)', lineHeight: 1.6, margin: '0 0 24px' }}>
        Weather, radar, sun, air quality and pollen tiles all key off one place.
        Search your city — or skip and set it later in Settings (until then the
        tiles show Knoxville, TN as a placeholder).
      </p>
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search a city…"
        autoFocus
        spellCheck={false}
        style={field}
      />
      {error && (
        <div style={{ marginTop: 10, fontSize: 12, color: '#fca5a5' }}>{error}</div>
      )}
      <div style={{ marginTop: 10, textAlign: 'left', maxHeight: 220, overflowY: 'auto' }}>
        {searching && <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', padding: 8 }}>Searching…</div>}
        {!searching && results.map((r) => {
          const selected = value?.label === r.label;
          return (
            <button
              key={`${r.label}:${r.lat}`}
              onClick={() => setValue({ label: r.label, lat: r.lat, lon: r.lon })}
              style={{
                display: 'flex', alignItems: 'center', gap: 10, width: '100%',
                padding: '9px 12px', borderRadius: 8, cursor: 'pointer', textAlign: 'left',
                background: selected ? `${accent}18` : 'transparent',
                border: selected ? `1px solid ${accent}55` : '1px solid transparent',
                color: selected ? accent : 'rgba(255,255,255,0.8)', fontSize: 13,
              }}
            >
              <span style={{ fontSize: 14 }}>{selected ? '✓' : '📍'}</span>
              {r.label}
            </button>
          );
        })}
      </div>
      {value && (
        <div style={{ marginTop: 14, fontSize: 12.5, color: 'rgba(255,255,255,0.6)' }}>
          Using <span style={{ color: accent, fontWeight: 600 }}>{value.label}</span>
        </div>
      )}
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
        all themed to whatever's playing. Audio just works out of the box — and you can point the visualizer at a single app instead of the whole mix anytime in Settings.
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

function OnbProfile({ accent, profiles, value, setValue }: {
  accent: string;
  profiles: { id: string; name: string }[];
  value: string | null;
  setValue: (s: string) => void;
}) {
  // Render up to 3 cards mapped to the user's first 3 real profiles. Each
  // displayed card uses a hardcoded preview layout for visual variety, but its
  // underlying id is the real profile id so the App can apply the choice.
  const PREVIEWS: { layout: 'work' | 'gaming' | 'chill'; subtitle: string }[] = [
    { layout: 'work',   subtitle: 'Calendar, sysmon, notes — focus mode' },
    { layout: 'gaming', subtitle: 'Big viz hero with sysmon strip' },
    { layout: 'chill',  subtitle: 'Fullscreen ambient with glass overlays' },
  ];
  const cards = profiles.slice(0, 3).map((p, i) => ({
    id: p.id,
    name: p.name,
    subtitle: PREVIEWS[i]?.subtitle ?? '',
    layout: PREVIEWS[i]?.layout ?? 'work',
  }));
  return (
    <div style={{ maxWidth: 1200, width: '100%' }}>
      <h1 style={{ fontSize: 40, fontWeight: 700, margin: '0 0 8px 0', letterSpacing: '-0.02em', textAlign: 'center' }}>Pick a starter layout</h1>
      <p style={{ fontSize: 15, color: 'rgba(255,255,255,0.5)', margin: '0 0 36px 0', textAlign: 'center' }}>You can have multiple profiles and switch with ⌘1/2/3. Customize anytime.</p>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.max(1, cards.length)}, 1fr)`, gap: 18 }}>
        {cards.map((p) => (
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

function OnbReady({ accent, profile, profiles }: {
  accent: string;
  profile: string | null;
  profiles: { id: string; name: string }[];
}) {
  const profileName = profile ? (profiles.find((p) => p.id === profile)?.name ?? profiles[0]?.name ?? 'Work') : (profiles[0]?.name ?? 'Work');
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
        Hub will launch with your <b style={{ color: accent }}>{profileName}</b> profile.
      </p>
      <div style={{
        padding: 20, borderRadius: 12, background: 'rgba(255,255,255,0.02)',
        border: '1px solid rgba(255,255,255,0.06)', textAlign: 'left',
        display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12,
      }}>
        <KbHint k="⌘ E" desc="Toggle edit mode" />
        <KbHint k="⌘ 1/2/3" desc="Switch profiles" />
        <KbHint k="V" desc="Cycle viz mode" />
        <KbHint k="Esc" desc="Close any overlay" />
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
