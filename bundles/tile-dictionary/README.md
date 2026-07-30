# Dictionary lookup

Looks up a word you choose in the Free Dictionary API
(`https://api.dictionaryapi.dev/api/v2/entries/en/<word>`, public, key-less
— the same endpoint `state/wordOfDay.ts`'s `fetchWordEntry` calls) and
shows its first definition.

## Renamed from "word of the day" — read why

This was originally attempted as a migration of the built-in
`WordOfDayTile`, which picks a *different* word every day, deterministically,
from a local 70-word list seeded by today's date (`wordForToday()`). A
declarative tile has no scripting, so it cannot compute "today's word" —
its `http` source has a fixed URL (templated only from `config`/`secret`,
neither of which can express date arithmetic). There is no way to build a
tile that rotates daily without either a hosted endpoint that itself
rotates server-side, or a phase-3 scripted tile. So this is shipped
honestly as what it actually is: **a dictionary lookup for one word you
configure**, not a rotating word-of-the-day. Install it once per word you
want pinned, the same way you'd pin a stock symbol or a city.

`config: [{ "key": "word", ... }]` is substituted into `source.url` via
`{{config.word}}` (wired since Task 7's `request.ts`/`buildRequest`). On
first install, `config.word` is unset — `DeclarativeTile.tsx`'s
`needsSetup` now checks unfilled `config` entries as well as missing
secrets (previously it only checked secrets, which meant a tile with
config but zero secrets could never open its own setup panel — a real gap,
fixed alongside this bundle since it's the first config-only tile to ship),
so the tile prompts for a word before ever making a request instead of
firing a broken lookup against an empty path segment.

## Fields

Real response, fetched live 2026-07-30 for `word=serendipity` (abbreviated):

```json
[{"word":"serendipity","phonetic":"/ˌsɛ.ɹən.ˈdɪ.pɪ.ti/",
  "meanings":[{"partOfSpeech":"noun","definitions":[
    {"definition":"A combination of events which have come together by chance to make a surprisingly good or wonderful outcome.","synonyms":[],"antonyms":["Murphy's law","perfect storm"]},
    {"definition":"An unsought, unintended, and/or unexpected, but fortunate, discovery and/or learning experience that happens by accident.","synonyms":["chance","luck"],"antonyms":[]}
  ]}],
  "sourceUrls":["https://en.wiktionary.org/wiki/serendipity"]}]
```

`body` is `{{data.0.meanings.0.definitions.0.definition}}` — the first
definition of the first meaning of the first (and typically only) returned
entry, now reachable now that `select`/`{{path}}` accept a literal integer
segment (`viewSpec.ts`'s `DOT_PATH`, `template.ts`'s `PLACEHOLDER`).
`attribution` is `{{data.0.word}}`.

## Known limitations

- Only the first definition of the first meaning shows — a word with
  several senses (e.g. "bass" the fish vs. the instrument) only shows one.
  `text`'s `body`/`attribution` are single slots; a fuller listing would
  need `rows` or `list`, at the cost of losing the running-prose feel a
  definition reads best in.
- `config.word` is substituted into the URL path raw (no encoding) — enter
  a single URL-safe word (letters only; the dictionary doesn't have
  multi-word entries anyway). A word not in the dictionary renders
  `TileError` (HTTP 404), same as the built-in's null-safe fallback would
  show "Couldn't load today's word."

No secrets.
