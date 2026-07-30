# Word of the day

Fetches a single entry from the Free Dictionary API
(`https://api.dictionaryapi.dev/api/v2/entries/en/<word>`), the same
key-less endpoint `state/wordOfDay.ts`'s `fetchWordEntry` calls.

## Known, significant gaps vs. the built-in `WordOfDayTile` — read before installing

This tile does **not** reproduce the built-in's behavior. Two limitations in
the declarative grammar (`view.json`/`select`/`{{path}}`, all dot-path only,
no array indexing, no expressions, no config in this tile's scope) make a
faithful migration impossible as designed:

1. **No daily rotation.** The built-in picks a word deterministically from a
   local 70-word list, seeded by today's date (`wordForToday()` in
   `state/wordOfDay.ts`), so the word changes every day. A declarative
   `http` source has a fixed URL — there is no scripting to compute "today's"
   word, and this tile deliberately declares no `config` (out of scope for
   this migration per the task brief), so there is no way to parameterize
   the URL per-instance either. **This bundle's URL is hardcoded to
   `.../en/serendipity` and will show the same word every day**, indefinitely.
   A real fix needs either a per-instance `config` entry for the word (a
   config-bearing follow-up, explicitly out of scope here) or a hosted
   "word of the day" endpoint that itself rotates server-side.

2. **No definition, part of speech, or example.** The real response is
   `[{ "word": "...", "phonetic": "...", "meanings": [{ "partOfSpeech": "...",
   "definitions": [{ "definition": "...", "example": "..." }] }] }]` —
   confirmed live 2026-07-29. `definition`/`partOfSpeech`/`example` sit two
   array levels below the response root (`meanings[0].definitions[0]`), and
   both `select` and `{{path}}` reject any dot-path segment that doesn't
   start with a letter or underscore — there is no way to index element `0`
   of an array anywhere in this grammar (see `viewSpec.ts`'s `DOT_PATH` and
   `template.ts`'s `PLACEHOLDER` regex, and their tests). Only `word` and
   `phonetic` — both direct, scalar properties of the array's first (and
   almost always only) entry — are reachable, so this tile shows only those,
   via `list` with `select` omitted (the response is already the array
   `list` expects).

In short: this bundle proves the renderer and the `net:` fetch path work
end to end, but it is **not** a like-for-like replacement for the built-in
`WordOfDayTile`, which still needs to stay built-in (or wait for a
config-bearing / scripted follow-up) until these two gaps are addressed.

No secrets.
