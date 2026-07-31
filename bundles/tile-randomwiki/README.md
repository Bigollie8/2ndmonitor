# Random Wikipedia

Shows a random Wikipedia article's title and opening extract. Migrated from
the built-in `RandomWikiTile` — same idea (a random-article feed), different
endpoint, for a reason worth documenting.

## Not `page/random/summary` — read why

The built-in's endpoint, `https://en.wikipedia.org/api/rest_v1/page/random/summary`,
issues an HTTP **303** to the actual random article's summary URL (confirmed
live: `curl` without `-L` gets `303 See Other`, `Location:` pointing at
`page/summary/<title>`). `broker_fetch` (`marketplace.rs`) never follows
redirects on purpose — `AgentBuilder::new().redirects(0)`, so a host that
303s straight through an allowlisted-net-permission check to an arbitrary
`Location` can't be used for SSRF (see its doc comment, "I2"). A declarative
tile's `net.fetch` goes through exactly that path, so the built-in's
endpoint would fail every single fetch with "server responded with a
redirect (HTTP 303) — redirects are not followed", not render blank or
stale — this was caught by actually running the fetch un-redirected, not by
reading the endpoint name and assuming it behaves like the built-in's
browser `fetch()` (which follows redirects transparently).

Used instead: the MediaWiki action API's `generator=random`, which returns
a random article's extract, thumbnail, and canonical URL in **one** 200
response, no redirect —
```
https://en.wikipedia.org/w/api.php?action=query&format=json&formatversion=2&generator=random&grnnamespace=0&grnlimit=1&prop=extracts%7Cpageimages%7Cinfo&exintro=1&explaintext=1&exchars=600&piprop=thumbnail&pithumbsize=300&inprop=url
```
`formatversion=2` is load-bearing: without it, `query.pages` is a JSON
*object* keyed by an unpredictable numeric page ID (`query.pages.75998234`),
which a fixed dot-path can never reach two calls in a row. With it,
`query.pages` is an array — `query.pages.0` is fixed and always resolves,
confirmed against 5 separate live fetches, whichever random page landed
there.

## Fields

Real response, fetched live 2026-07-31 (`select: "query.pages.0"`):

```json
{
  "pageid": 56747397,
  "title": "Belapur Ki Dayan",
  "extract": "Belapur Ki Dayan (Urdu: بیلاپور کی ڈائن; transl. The Witch of Belapur) is a 2018 Pakistani supernatural horror drama series directed by Saife Hassan and written by Inam Hasan. ...",
  "fullurl": "https://en.wikipedia.org/wiki/Belapur_Ki_Dayan"
}
```

Resolved: `{{data.extract}}` → the sentence above, `{{data.title}}` →
`Belapur Ki Dayan`. Renders with the `text` primitive (body = extract,
attribution = title, right-aligned), matching `tile-quote`'s layout.

## Known limitations

- No thumbnail image and no click-through — `text` is body + attribution
  only; it has no image slot and (unlike `list`) no `openUrl`. The built-in
  shows a 96×96 thumbnail and opens the article on click; neither survives
  here. `fullurl` is fetched (in case a future view primitive gains a link)
  but currently unused.
- Not every random page has a `thumbnail` field (about 1 in 5 in a quick
  sample) — irrelevant here since nothing renders it, but noted in case a
  future revision adds an image view.
- `intervalMs` is 3600000 (1h), matching the built-in's `REFRESH_MS`. No
  manual "New article" refresh button — that's host chrome, not
  expressible in `view.json`.

No secrets, no config. `net:en.wikipedia.org` only (same host the built-in
used for its redirecting endpoint).
