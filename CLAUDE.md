# CLAUDE.md

Weekly soccer practice emails → structured JSON → a static site read on a phone at
the field. See `README.md` for the overview and `.claude/skills/practice-extract/`
for the weekly extraction job.

## After changing anything under `data/`

```bash
python3 tools/build_site_data.py   # regenerate the bundle the site fetches
python3 tools/validate.py          # structure, references, bundle freshness
```

`validate.py` must exit 0 before you finish. It catches a skipped rebuild, so run
both — not just the validator.

## Invariants

**`data/site.json` is generated. Never hand-edit it.** `data/drills/*.json` and
`data/weeks/*.json` are the source of truth; the bundle exists because static
hosting can't enumerate a directory.

**Drill ids come from the PDF *title*, never the filename.** Attachment filenames
arrive with punctuation mangled (`,` → `^J`, `&` → `^0`) and get renamed by hand.

**Never reorder a session's `items[]`.** The order is the practice progression and
it is not numeric — one real week runs Variation 2, then 1, then 3.

**Transcribed fields are verbatim, typos included** (`"Swing the kicking let up"`,
`"opposide side"`). Inferred values live in `derived` so the two are never confused.
Correcting the source silently makes extraction bugs indistinguishable from the
director's own errors.

**Match drill names by normalizing, not comparing.** The email uses en-dashes and
`…` where PDF titles use `-` and `...`; exact comparison fails on real input. Fold
punctuation, casefold, then prefix-match.

## The site

Static files at the repo root, served by GitHub Pages. **No framework, no build
step, no dependencies** — keep it that way unless there's a concrete reason.

- **Hash routing** (`#/drill/...`) is deliberate: Pages has no rewrite rules, so a
  path route would 404 on refresh or a shared link.
- **Never use `innerHTML` for drill content.** It is transcribed from third-party
  PDFs and is not trusted markup; build nodes with the `el()` helper.
- Serve over HTTP to test (`python3 -m http.server 8888`); `file://` breaks `fetch`.

## Verification

Jeff checks front-end changes in his own browser. After a UI change, syntax-check,
confirm the file is served, and say what to look at — don't stand up headless DOM
harnesses. Automated checks are for the data pipeline, where `validate.py` earns
its keep.
