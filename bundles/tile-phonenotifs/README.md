# Phone notifs

Polls ntfy.sh's public `/json?poll=1` endpoint for the single most recent
message on a topic. Migrated from the built-in `PhoneNotifsTile`, with two
real losses versus the built-in: single message instead of a scrolling
history, and an empty topic renders as an error, not an empty state — read
on before installing.

## Fixed to ntfy.sh — no self-hosted server

The built-in reads a user-configurable `server` (`state/ntfy.ts`'s
`getStoredServer`, default `https://ntfy.sh`, not a secret) so a
self-hosted ntfy instance works too. A declarative tile's `net:<host>`
permission is a single literal hostname fixed at bundle-authoring time
(`sandbox/manifest.ts`'s `parsePermission`: `HOST_LABEL_RE` accepts only
plain hostname characters, no `{{…}}` placeholder, and `brokerDecide` in
`sandbox/broker.ts` does an exact string match against the resolved
request host) — there is no way for a `config`-supplied host to satisfy a
permission declared at review time. This is the same wall documented for
`homeAssistant`/`energy` in `task-2-report.md`, just for a narrower,
optional field rather than a required one. So this bundle hardcodes
`net:ntfy.sh` and drops self-hosted server support entirely; the public
`ntfy.sh` (the built-in's own default) is the only server this bundle can
reach.

## The streaming API doesn't fit a single-shot JSON fetch — verified live

The built-in opens a persistent `fetch` + `ReadableStream` connection to
`/{topic}/json` and reads newline-delimited JSON forever
(`subscribeNtfy` in `state/ntfy.ts`). A declarative tile has no streaming
primitive — every poll is one `broker_fetch` call whose entire body is
parsed with a single `JSON.parse` (`DeclarativeTile.tsx`: `JSON.parse(res.
body)`, throwing "response body was not valid JSON" on failure). ntfy's
non-streaming poll mode (`?poll=1`) returns the SAME wire format,
newline-delimited JSON — confirmed live 2026-07-31 against a real topic:

```
$ curl -s "https://ntfy.sh/<topic>/json?poll=1&since=all"
{"id":"9KuA5KvqCmyM","time":1785519593,...,"message":"hello world",...}
{"id":"DUy5XCoNwYJw","time":1785519597,...,"message":"second message",...}
```

Two messages queued → two JSON lines → `JSON.parse` on the concatenated
body throws (`Unexpected non-whitespace character after JSON at position
…`) — verified directly with Node's `JSON.parse` against this exact
response. So this bundle can only ever request the single latest message.
ntfy documents `since=latest` for exactly this ("grab the most recent
message from the cache for a particular topic" — docs.ntfy.sh), also
confirmed live: `?poll=1&since=latest` returned exactly one line, the most
recent of the two test messages. `view.json` uses that.

## Known limitation: an empty/expired topic shows an error, not "no notifications yet"

Also confirmed live: a topic with no messages yet (or whose most recent
message expired — ntfy.sh default retention is 12h) returns HTTP 200 with
an **empty body** for both `?poll=1` and `?poll=1&since=latest`. Empty
string fails `JSON.parse` the same way malformed JSON does, so
`DeclarativeTile` renders `TileError: response body was not valid JSON` —
not `TileEmpty`/"no notifications yet" like the built-in's disconnected/
empty states. The `list` view's `emptyText` doesn't help here: it only
fires when `select` resolves to an empty *array*, and this response is
never an array (it's either one object or nothing at all) — there's no
view-spec primitive for "empty body means empty state." This is a real,
permanent rough edge for what is likely the *most common* state (waiting
for the next notification), not just a rare corner case; anyone installing
this bundle will see it regularly.

## Other losses versus the built-in

- One message, not up to 50 (`MAX_NOTIFICATIONS`) — see above, structural,
  not a config choice.
- No live connection-status dot (`connecting`/`connected`/`disconnected`)
  — poll-based, so there's no persistent connection to reflect status of.
- No tags (`🔔` etc.) rendered — the `text` view has no per-tag chip
  primitive; `tags` isn't referenced.
- No click-to-open (`notif.click`) — the `text` view has no `openUrl`-style
  affordance (only `list.row` does), so a notification's `click` URL, if
  set, is not actionable from this bundle.
- The credential (topic name) is embedded directly in `source.url`, not a
  header — ntfy has no header-based topic selector; the topic name is
  simultaneously the resource identifier and (per the built-in's own
  design, see `state/ntfy.ts`'s header comment: "the topic IS the
  credential") the secret. This is the documented exception in the task
  brief ("only fall back to `source.url` if the API genuinely has no
  header auth"). Unlike the built-in, the topic is **not**
  `encodeURIComponent`-escaped before insertion (the template grammar does
  plain string substitution, no encoding) — pick a topic using only
  letters, digits, `-`, and `_` (the built-in's own suggested pattern,
  e.g. `xj91k_phone`) and this is a non-issue.
- `intervalMs` is 30000 (30s) — the built-in has no fixed interval (an open
  stream reconnects on a 5s retry timer instead); 30s is a compromise
  between the 15s floor and not hammering `ntfy.sh` from every install.

`net:ntfy.sh` only. Secret: `ntfy_topic`. No config.
