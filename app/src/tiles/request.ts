// Builds the outgoing request for a declarative tile. Pure and node-testable:
// the secret values are injected HERE, host-side, and never travel to the
// bundle — a bundle only ever names a secret in its view spec.
import type { TileSource } from './viewSpec';
import { substitute, type TemplateScope } from './template';

export function buildRequest(
  source: Extract<TileSource, { kind: 'http' }>,
  scope: TemplateScope,
): { url: string; headers: Record<string, string> } {
  const url = substitute(source.url, scope);
  // Re-check after substitution: a config or secret value could otherwise
  // change the scheme or host of a URL that validated as https at rest.
  if (!/^https:\/\/[^/?#]+/.test(url) || url.includes('..')) {
    throw new Error(`tile url did not stay a plain https URL after substitution: ${url}`);
  }
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(source.headers ?? {})) {
    headers[k] = substitute(v, scope);
  }
  return { url, headers };
}
