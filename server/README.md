# Hub Marketplace Server

The marketplace backend for Second-Monitor Hub: author accounts, bundle submissions (presets / visualizers / tiles), an AI-assisted human review queue, and an ed25519-signed index the app verifies before trusting anything.

## Run it locally

```sh
cd server
ADMIN_TOKEN=pick-something cargo run
# → hub-marketplace listening on http://0.0.0.0:8787
# → index signing pubkey: <hex>   ← paste this into the app's Settings later
```

That's a fully working marketplace: registration returns verification links in the response (dev mode), submissions queue, and `http://localhost:8787/admin` is your review UI.

## Environment variables

| Var | Required | Effect when unset |
|---|---|---|
| `PORT` | no (8787) | — |
| `SERVER_DATA_DIR` | no (`./data`) | Holds `marketplace.db` + `signing.key` |
| `ADMIN_TOKEN` | for reviewing | Admin endpoints return 403 — nothing can be approved |
| `ANTHROPIC_API_KEY` | no | AI review skipped; queue is human-only |
| `SMTP_URL` | no | **Dev mode**: verify/reset tokens are returned in API responses and logged. Fine for a friends-scale service; do not expose public registration like this. |

## Endpoints

- **Public**: `GET /health`, `GET /index.json` (signed), `GET /bundle/{id}/{version}` (zip, counts downloads)
- **Authors**: `POST /auth/register|login|request-reset|reset`, `GET /auth/verify`, `GET /auth/whoami`, `POST /submissions`, `GET /submissions/mine`
- **Admin** (Bearer `ADMIN_TOKEN`): `GET /admin` (review UI), `GET /admin/queue`, `POST /admin/decide`

Submission body: `{kind: "preset"|"visualizer"|"tile", manifest: "<json string>", code?: "<main.js>", preset_json?: "<preset>"}`. Presets auto-approve after validation; visualizers and tiles wait for you. Static gates: manifest schema, 256 KB code cap, no `eval`/`new Function`, permission grammar (`net:<bare-host>`, `tauri:<command>`, tiles only).

## Deploying to the home server

1. **Build & run as a service** (Linux example):

   ```ini
   # /etc/systemd/system/hub-marketplace.service
   [Unit]
   Description=Hub Marketplace
   After=network.target
   [Service]
   ExecStart=/opt/hub-marketplace/hub-marketplace
   Environment=SERVER_DATA_DIR=/var/lib/hub-marketplace
   Environment=ADMIN_TOKEN=<long random string>
   Environment=ANTHROPIC_API_KEY=<optional>
   Restart=on-failure
   [Install]
   WantedBy=multi-user.target
   ```

   Build with `cargo build --release` (cross-compile or build on the box).

2. **HTTPS without exposing your home IP — Cloudflare Tunnel**:

   ```sh
   cloudflared tunnel login
   cloudflared tunnel create hub-market
   # ~/.cloudflared/config.yml:
   #   tunnel: <tunnel-id>
   #   credentials-file: /home/you/.cloudflared/<tunnel-id>.json
   #   ingress:
   #     - hostname: market.yourdomain.com
   #       service: http://localhost:8787
   #     - service: http_status:404
   cloudflared tunnel route dns hub-market market.yourdomain.com
   cloudflared tunnel run hub-market   # (or install as a service)
   ```

   Alternative: a Caddy reverse proxy + port forward (`market.yourdomain.com { reverse_proxy localhost:8787 }`) — Caddy handles certificates automatically, but your IP is public.

3. **Email (when you want real signups)**: home IPs can't deliver SMTP directly. Use a transactional relay (Resend, Postmark, Mailgun free tiers). Until then, dev mode is intentional: create accounts for friends yourself and hand them the verification link from the server log.

4. **Back up two files**: `SERVER_DATA_DIR/marketplace.db` (everything) and `SERVER_DATA_DIR/signing.key` (**critical** — the app pins the matching public key; lose the seed and every install must re-pin a new key).

5. **Wire the app**: in Second-Monitor Hub → Settings → Marketplace, set the server URL (`https://market.yourdomain.com`) and paste the pubkey the server printed at startup. The app refuses any index whose signature doesn't verify, and any bundle whose SHA-256 doesn't match the signed index.

## Trust model (what protects users)

- **Curated**: nothing but validated presets publishes without a human clicking Approve in `/admin`.
- **AI review is advisory**: with `ANTHROPIC_API_KEY` set, each submission gets a Claude report — "do the permissions match the code, anything obfuscated?" — shown in the queue. It never approves anything.
- **Diff on updates**: version updates show the previously approved code as a diff base (the benign-v1 / malicious-v1.1 pattern is the classic attack).
- **Supply-chain**: the index is ed25519-signed and carries per-bundle SHA-256; the app verifies both, so a compromised server or CDN can't silently swap payloads.
- **Runtime**: tiles run in the app's sandboxed iframe; the broker grants exactly the manifest's `net:`/`tauri:` permissions, displayed to the user at install time.
