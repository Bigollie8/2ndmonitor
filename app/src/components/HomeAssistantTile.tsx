import React, { useState } from 'react';
import { HFTile } from './tiles';
import {
  type HaState,
  fetchAllStates,
  getStoredEntities,
  getStoredUrl,
  isActionable,
  pressEntity,
  setStoredEntities,
  setStoredUrl,
} from '../state/homeAssistant';
import { useSecret } from '../state/secrets';
import { usePoll } from '../state/usePoll';
import { TileEmpty, TileNeedsSetup } from './tileStates';
import type { Density } from '../types';

const REFRESH_MS = 10 * 1000;

export interface HomeAssistantTileProps {
  density: Density;
  accent: string;
  editing: boolean;
}

export function HomeAssistantTile({ density, accent, editing }: HomeAssistantTileProps) {
  const [url, setUrl] = useState<string>(getStoredUrl);
  const { value: token, loaded, save: saveToken, clear: clearToken } =
    useSecret('ha_token', { legacyLocalStorageKey: '2mh.ha.token' });
  const [entities, setEntities] = useState<string[]>(getStoredEntities);
  const [setupOpen, setSetupOpen] = useState(false);

  const configured = !!url && !!token;

  const { data, refresh } = usePoll(
    async () => {
      // Unconfigured tiles poll an empty list instead of not polling at all —
      // no network is involved, and the dep change on connect kicks off a real
      // fetch immediately.
      if (!url || !token || entities.length === 0) return [];
      return fetchAllStates(url, token, entities);
    },
    REFRESH_MS,
    [url, token, entities.join(',')],
  );
  const states = data ?? [];

  const handlePress = async (state: HaState) => {
    if (!token) return;
    const ok = await pressEntity(url, token, state);
    if (ok) {
      // Optimistic refresh.
      refresh();
    }
  };

  const headRight = (
    <span style={{
      fontSize: 10, color: 'rgba(255,255,255,0.45)',
      fontFamily: '"JetBrains Mono", ui-monospace, monospace',
    }}>{configured ? `${entities.length} entities` : 'not connected'}</span>
  );

  const [showEntityEditor, setShowEntityEditor] = useState<boolean>(false);

  return (
    <HFTile title="Smart home" headRight={headRight} accent={accent} density={density} style={{ height: '100%' }}>
      <div style={{
        position: 'absolute', inset: 0, padding: 10,
        display: 'flex', flexDirection: 'column', gap: 6,
        overflow: 'hidden',
      }}>
        {loaded && !configured && !(editing || setupOpen) && (
          <TileNeedsSetup
            accent={accent}
            line={
              <>
                Connect to Home Assistant with a long-lived access token. Create one in HA at{' '}
                <span style={{ color: accent, fontFamily: 'monospace' }}>Profile → Security</span>.
              </>
            }
            onSetup={() => setSetupOpen(true)}
          />
        )}
        {loaded && !configured && (editing || setupOpen) && (
          <ConnectPanel
            accent={accent}
            initialUrl={url}
            onSave={(u, t) => { setStoredUrl(u); void saveToken(t); setUrl(u); }}
          />
        )}
        {configured && entities.length === 0 && (
          <TileEmpty
            icon="⌂"
            line={
              <>
                Add some entity IDs to monitor (e.g. <span style={{ fontFamily: 'monospace', color: accent }}>light.kitchen</span>).
                <br />
                {editing ? 'Use the editor below.' : 'Enter edit mode to configure.'}
              </>
            }
          />
        )}
        {configured && states.length > 0 && (
          <div style={{
            flex: 1, minHeight: 0, overflowY: 'auto',
            display: 'flex', flexDirection: 'column', gap: 4,
          }}>
            {states.map((s) => (
              <EntityRow key={s.entity_id} state={s} accent={accent} onPress={() => void handlePress(s)} />
            ))}
          </div>
        )}
        {configured && editing && (
          <div style={{ display: 'flex', gap: 6, flexShrink: 0, paddingTop: 4 }}>
            <button
              onClick={() => setShowEntityEditor((v) => !v)}
              style={{
                padding: '4px 10px', fontSize: 10, fontWeight: 600, borderRadius: 4,
                background: showEntityEditor ? `${accent}22` : 'rgba(255,255,255,0.05)',
                color: showEntityEditor ? accent : 'rgba(255,255,255,0.7)',
                border: showEntityEditor ? `1px solid ${accent}55` : '1px solid rgba(255,255,255,0.08)',
                cursor: 'pointer',
              }}
            >{showEntityEditor ? 'done' : 'entities'}</button>
            <button
              onClick={() => { setStoredUrl(''); void clearToken(); setUrl(''); }}
              style={{
                padding: '4px 10px', fontSize: 10, fontWeight: 600, borderRadius: 4,
                background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.7)',
                border: '1px solid rgba(255,255,255,0.08)', cursor: 'pointer',
              }}
            >disconnect</button>
          </div>
        )}
        {configured && editing && showEntityEditor && (
          <EntityEditor
            entities={entities}
            accent={accent}
            onChange={(next) => { setStoredEntities(next); setEntities(next); }}
          />
        )}
      </div>
    </HFTile>
  );
}

function EntityRow({
  state, accent, onPress,
}: { state: HaState; accent: string; onPress: () => void }) {
  const friendly = (state.attributes['friendly_name'] as string | undefined) ?? state.entity_id;
  const isOn = state.state === 'on';
  const actionable = isActionable(state.entity_id);
  const indicator = isOn ? accent
    : (state.state === 'unavailable' || state.state === 'unknown' ? '#ef4444' : 'rgba(255,255,255,0.35)');

  return (
    <button
      onClick={actionable ? onPress : undefined}
      disabled={!actionable}
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '6px 8px', fontSize: 11.5,
        background: isOn ? `${accent}10` : 'rgba(255,255,255,0.02)',
        border: isOn ? `1px solid ${accent}55` : '1px solid rgba(255,255,255,0.06)',
        borderRadius: 5,
        cursor: actionable ? 'pointer' : 'default',
        textAlign: 'left',
        color: 'rgba(255,255,255,0.85)',
      }}
    >
      <span style={{
        width: 8, height: 8, borderRadius: 999, background: indicator,
        boxShadow: isOn ? `0 0 6px ${indicator}` : 'none',
        flexShrink: 0,
      }} />
      <span style={{
        flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>{friendly}</span>
      <span style={{
        fontSize: 10, color: 'rgba(255,255,255,0.55)',
        fontFamily: '"JetBrains Mono", ui-monospace, monospace',
        flexShrink: 0,
      }}>{state.state}</span>
    </button>
  );
}

function EntityEditor({
  entities, accent, onChange,
}: { entities: string[]; accent: string; onChange: (next: string[]) => void }) {
  const [draft, setDraft] = useState('');
  const add = () => {
    const t = draft.trim();
    if (!t || !t.includes('.')) return;
    if (entities.includes(t)) { setDraft(''); return; }
    onChange([...entities, t]);
    setDraft('');
  };
  const remove = (id: string) => onChange(entities.filter((e) => e !== id));
  return (
    <div style={{
      flexShrink: 0, padding: 8, borderTop: '1px solid rgba(255,255,255,0.06)',
      display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 140, overflowY: 'auto',
    }}>
      {entities.map((id) => (
        <div key={id} style={{
          display: 'flex', alignItems: 'center', gap: 6, fontSize: 11,
          fontFamily: '"JetBrains Mono", ui-monospace, monospace',
        }}>
          <span style={{ flex: 1, color: 'rgba(255,255,255,0.7)' }}>{id}</span>
          <button onClick={() => remove(id)} style={{
            background: 'transparent', border: 'none', cursor: 'pointer',
            color: 'rgba(255,255,255,0.5)', fontSize: 13, lineHeight: 1, padding: '0 4px',
          }}>×</button>
        </div>
      ))}
      <div style={{ display: 'flex', gap: 6 }}>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value.toLowerCase())}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
          placeholder="entity_id (e.g. light.kitchen)"
          style={{
            flex: 1, fontSize: 11, padding: '5px 8px', borderRadius: 4,
            background: 'rgba(255,255,255,0.04)', color: '#fff',
            border: '1px solid rgba(255,255,255,0.1)',
            fontFamily: '"JetBrains Mono", ui-monospace, monospace', outline: 'none',
          }}
        />
        <button
          onClick={add}
          disabled={!draft.trim() || !draft.includes('.')}
          style={{
            padding: '5px 10px', fontSize: 11, fontWeight: 600, borderRadius: 4,
            background: draft.trim() && draft.includes('.') ? accent : 'rgba(255,255,255,0.06)',
            color: draft.trim() && draft.includes('.') ? '#000' : 'rgba(255,255,255,0.4)',
            border: 'none', cursor: draft.trim() && draft.includes('.') ? 'pointer' : 'not-allowed',
          }}
        >Add</button>
      </div>
    </div>
  );
}

function ConnectPanel({
  accent, initialUrl, onSave,
}: { accent: string; initialUrl: string; onSave: (url: string, token: string) => void }) {
  const [u, setU] = useState(initialUrl || 'http://homeassistant.local:8123');
  const [tok, setTok] = useState('');
  return (
    <div style={{
      flex: 1, minHeight: 0, padding: 10,
      display: 'flex', flexDirection: 'column', gap: 8, justifyContent: 'center',
    }}>
      <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.7)', lineHeight: 1.5 }}>
        Connect to Home Assistant with a long-lived access token. Create one in HA at{' '}
        <span style={{ color: accent, fontFamily: 'monospace' }}>Profile → Security</span>.
      </div>
      <input
        value={u}
        onChange={(e) => setU(e.target.value)}
        placeholder="http://homeassistant.local:8123"
        style={inputStyle}
      />
      <input
        type="password"
        value={tok}
        onChange={(e) => setTok(e.target.value)}
        placeholder="Long-lived access token"
        style={inputStyle}
      />
      <button
        onClick={() => { if (u.trim() && tok.trim()) onSave(u.trim(), tok.trim()); }}
        disabled={!u.trim() || !tok.trim()}
        style={{
          padding: '7px 12px', fontSize: 11, fontWeight: 700,
          background: u.trim() && tok.trim() ? accent : 'rgba(255,255,255,0.06)',
          color: u.trim() && tok.trim() ? '#000' : 'rgba(255,255,255,0.4)',
          border: 'none', borderRadius: 5,
          cursor: u.trim() && tok.trim() ? 'pointer' : 'not-allowed',
        }}
      >Connect</button>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  fontSize: 11, padding: '6px 10px', borderRadius: 4,
  background: 'rgba(255,255,255,0.04)', color: '#fff',
  border: '1px solid rgba(255,255,255,0.1)',
  fontFamily: '"JetBrains Mono", ui-monospace, monospace', outline: 'none',
};
