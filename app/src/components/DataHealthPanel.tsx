import { useEffect, useState, useSyncExternalStore } from 'react';
import { freshness, pollHealth } from '../state/pollHealth';

export function DataHealthPanel() {
  const rows = useSyncExternalStore(pollHealth.subscribe, pollHealth.getSnapshot);
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 10_000); return () => clearInterval(timer); }, []);
  return <div className="feature-controls" style={{ width: '100%', fontSize: 12 }}>
    <p>Active polling tiles on this profile. Last success measures when Hub received data; a provider may return cached data. Hidden windows pause checks.</p>
    {rows.length === 0 && <p>No polling data sources are active on this profile.</p>}
    {rows.map(row => <div key={row.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: '1px solid #ffffff15' }}>
      <div style={{ flex: 1 }}><strong>{row.label}</strong><div role="status">{freshness(row, Math.max(now, Date.now()))} · {row.updatedAt === null ? 'No successful check yet' : `Last success ${new Date(row.updatedAt).toLocaleTimeString()}`}</div></div>
      <button disabled={row.pending} onClick={row.retry}>Retry now</button>
    </div>)}
    <p>If a connection needs setup, open its tile to configure it. Failed checks retry automatically with backoff; existing data stays visible.</p>
  </div>;
}
