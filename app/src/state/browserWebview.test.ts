import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

test('browser webview serializes late create/close and keeps overlay sessions alive', async () => {
  const calls: string[] = [];
  let finishCreate!: () => void;
  let finishClose!: () => void;
  let failCreate = false;
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    __TAURI_INTERNALS__: {
      metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
      invoke(command: string) {
        calls.push(command);
        if (command.endsWith('create_webview')) return failCreate ? Promise.reject('create failed')
          : new Promise<void>(resolve => { finishCreate = resolve; });
        if (command.endsWith('close')) return new Promise<void>(resolve => { finishClose = resolve; });
        return Promise.resolve();
      },
    },
  } });
  Object.assign(globalThis, { requestAnimationFrame: () => 1, cancelAnimationFrame: () => {} });
  const { useBrowserWebview } = await import('./browserWebview');
  let url = 'https://example.com', hidden = false;
  let error: string | null = null;
  const bounds = { left: 0, top: 0, width: 800, height: 600 } as DOMRect;
  function Probe() { error = useBrowserWebview({ enabled: true, url, hidden, bounds }).error; return null; }
  const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(createElement(Probe)); await settle(); });
  url = 'https://example.org';
  await act(async () => { tree.update(createElement(Probe)); await settle(); });
  assert.equal(calls.filter(c => c.endsWith('create_webview')).length, 1);
  await act(async () => { finishCreate(); await settle(); });
  assert.equal(calls.filter(c => c.endsWith('create_webview')).length, 1, 'wait for old close');
  await act(async () => { finishClose(); await settle(); });
  assert.equal(calls.filter(c => c.endsWith('create_webview')).length, 2);
  await act(async () => { finishCreate(); await settle(); });
  const closeCount = calls.filter(c => c.endsWith('close')).length;
  hidden = true;
  await act(async () => { tree.update(createElement(Probe)); await settle(); });
  hidden = false;
  await act(async () => { tree.update(createElement(Probe)); await settle(); });
  assert.equal(calls.filter(c => c.endsWith('close')).length, closeCount);
  assert.ok(calls.some(c => c.includes('hide')));
  assert.ok(calls.some(c => c.includes('show')));
  failCreate = true; url = 'https://example.net';
  await act(async () => { tree.update(createElement(Probe)); await settle(); finishClose(); await settle(); });
  assert.equal(error, 'create failed');
  await act(async () => { tree.unmount(); await settle(); finishClose(); await settle(); });
  Reflect.deleteProperty(globalThis, 'window');
});
