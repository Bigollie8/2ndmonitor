import React, { useEffect, useRef, useState } from 'react';

const STYLE = `
.twk-panel{position:fixed;right:16px;bottom:16px;z-index:2147483646;width:280px;
  max-height:calc(100vh - 32px);display:flex;flex-direction:column;
  background:rgba(250,249,247,.78);color:#29261b;
  -webkit-backdrop-filter:blur(24px) saturate(160%);backdrop-filter:blur(24px) saturate(160%);
  border:.5px solid rgba(255,255,255,.6);border-radius:14px;
  box-shadow:0 1px 0 rgba(255,255,255,.5) inset,0 12px 40px rgba(0,0,0,.18);
  font:11.5px/1.4 ui-sans-serif,system-ui,-apple-system,sans-serif;overflow:hidden}
.twk-hd{display:flex;align-items:center;justify-content:space-between;
  padding:10px 8px 10px 14px;cursor:move;user-select:none}
.twk-hd b{font-size:12px;font-weight:600;letter-spacing:.01em}
.twk-x{appearance:none;border:0;background:transparent;color:rgba(41,38,27,.55);
  width:22px;height:22px;border-radius:6px;cursor:pointer;font-size:13px;line-height:1}
.twk-x:hover{background:rgba(0,0,0,.06);color:#29261b}
.twk-body{padding:2px 14px 14px;display:flex;flex-direction:column;gap:10px;
  overflow-y:auto;overflow-x:hidden;min-height:0}
.twk-row{display:flex;flex-direction:column;gap:5px}
.twk-lbl{display:flex;justify-content:space-between;align-items:baseline;color:rgba(41,38,27,.72)}
.twk-lbl>span:first-child{font-weight:500}
.twk-sect{font-size:10px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;
  color:rgba(41,38,27,.45);padding:10px 0 0}
.twk-sect:first-child{padding-top:0}
.twk-field{appearance:none;width:100%;height:26px;padding:0 8px;
  border:.5px solid rgba(0,0,0,.1);border-radius:7px;
  background:rgba(255,255,255,.6);color:inherit;font:inherit;outline:none}
select.twk-field{padding-right:22px;
  background-image:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'><path fill='rgba(0,0,0,.5)' d='M0 0h10L5 6z'/></svg>");
  background-repeat:no-repeat;background-position:right 8px center}
.twk-seg{position:relative;display:flex;padding:2px;border-radius:8px;background:rgba(0,0,0,.06);user-select:none}
.twk-seg-thumb{position:absolute;top:2px;bottom:2px;border-radius:6px;background:rgba(255,255,255,.9);
  box-shadow:0 1px 2px rgba(0,0,0,.12);transition:left .15s cubic-bezier(.3,.7,.4,1),width .15s}
.twk-seg button{appearance:none;position:relative;z-index:1;flex:1;border:0;background:transparent;
  color:inherit;font:inherit;font-weight:500;min-height:22px;border-radius:6px;cursor:pointer;
  padding:4px 6px;line-height:1.2}
.twk-btn{appearance:none;height:26px;padding:0 12px;border:0;border-radius:7px;
  background:rgba(0,0,0,.78);color:#fff;font:inherit;font-weight:500;cursor:pointer}
.twk-btn:hover{background:rgba(0,0,0,.88)}
.twk-toggle-open{position:fixed;right:16px;bottom:16px;z-index:2147483645;
  appearance:none;border:0;height:34px;padding:0 14px;border-radius:10px;
  background:rgba(250,249,247,.85);color:#29261b;
  -webkit-backdrop-filter:blur(20px) saturate(160%);backdrop-filter:blur(20px) saturate(160%);
  border:.5px solid rgba(255,255,255,.6);
  box-shadow:0 8px 24px rgba(0,0,0,.18);
  font:12px/1 ui-sans-serif,system-ui,-apple-system,sans-serif;font-weight:600;cursor:pointer}
.twk-toggle-open:hover{background:rgba(255,255,255,.95)}
`;

export function TweaksPanel({ title = 'Tweaks', children, defaultOpen = true }: { title?: string; children?: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const offsetRef = useRef({ x: 16, y: 16 });

  const clamp = () => {
    const panel = panelRef.current;
    if (!panel) return;
    const w = panel.offsetWidth, h = panel.offsetHeight;
    const PAD = 16;
    const maxRight = Math.max(PAD, window.innerWidth - w - PAD);
    const maxBottom = Math.max(PAD, window.innerHeight - h - PAD);
    offsetRef.current = {
      x: Math.min(maxRight, Math.max(PAD, offsetRef.current.x)),
      y: Math.min(maxBottom, Math.max(PAD, offsetRef.current.y)),
    };
    panel.style.right = offsetRef.current.x + 'px';
    panel.style.bottom = offsetRef.current.y + 'px';
  };

  useEffect(() => {
    if (!open) return;
    clamp();
    const ro = new ResizeObserver(clamp);
    ro.observe(document.documentElement);
    return () => ro.disconnect();
  }, [open]);

  const onDragStart = (e: React.MouseEvent) => {
    const panel = panelRef.current;
    if (!panel) return;
    const r = panel.getBoundingClientRect();
    const sx = e.clientX, sy = e.clientY;
    const startRight = window.innerWidth - r.right;
    const startBottom = window.innerHeight - r.bottom;
    const move = (ev: MouseEvent) => {
      offsetRef.current = {
        x: startRight - (ev.clientX - sx),
        y: startBottom - (ev.clientY - sy),
      };
      clamp();
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  return (
    <>
      <style>{STYLE}</style>
      {!open && <button className="twk-toggle-open" onClick={() => setOpen(true)}>⚙ Tweaks</button>}
      {open && (
        <div ref={panelRef} className="twk-panel" style={{ right: offsetRef.current.x, bottom: offsetRef.current.y }}>
          <div className="twk-hd" onMouseDown={onDragStart}>
            <b>{title}</b>
            <button className="twk-x" onMouseDown={(e) => e.stopPropagation()} onClick={() => setOpen(false)}>✕</button>
          </div>
          <div className="twk-body">{children}</div>
        </div>
      )}
    </>
  );
}

export function TweakSection({ label }: { label: string }) {
  return <div className="twk-sect">{label}</div>;
}

export function TweakRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="twk-row">
      <div className="twk-lbl"><span>{label}</span></div>
      {children}
    </div>
  );
}

export function TweakRadio<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: T[]; onChange: (v: T) => void }) {
  const idx = Math.max(0, options.indexOf(value));
  const n = options.length;
  return (
    <TweakRow label={label}>
      <div className="twk-seg">
        <div className="twk-seg-thumb" style={{ left: `calc(2px + ${idx} * (100% - 4px) / ${n})`, width: `calc((100% - 4px) / ${n})` }} />
        {options.map((o) => (
          <button key={o} type="button" onClick={() => onChange(o)}>{o}</button>
        ))}
      </div>
    </TweakRow>
  );
}

export function TweakSelect<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <TweakRow label={label}>
      <select className="twk-field" value={value} onChange={(e) => onChange(e.target.value as T)}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </TweakRow>
  );
}

export function TweakButton({ label, onClick }: { label: string; onClick: () => void }) {
  return <button type="button" className="twk-btn" onClick={onClick}>{label}</button>;
}
