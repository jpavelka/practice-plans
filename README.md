# soccer-practice

Turns the club director's weekly practice email (plus its drill PDF attachments)
into structured JSON, so the week's plan can be read on a phone at the field
instead of by scrolling an email and opening attachments one at a time.

## Layout

```
index.html        the web app (static, no build step)
assets/           app.js + app.css
inbox/            drop zone for a new week (gitignored)
archive/<week>/   raw email + PDFs, kept as provenance
data/drills/      one record per drill, reused across weeks
data/weeks/       one record per week, references drills by id
data/diagrams/    field diagram carved out of each drill PDF
data/site.json    generated bundle the web app fetches -- do not hand-edit
tools/            extraction, bundling + validation scripts
.claude/skills/   the /practice-extract skill
```

## Weekly workflow

1. Paste the email body into `inbox/body.txt` and save the attachments into `inbox/`.
2. Run `/practice-extract` in Claude Code.
3. Review the reported `extractionFlags`, then `git diff` and commit.

The skill reads the email and every PDF, writes drill and week records, extracts
diagrams, rebuilds `data/site.json`, archives the raw input, and validates.

## Running the site

It is plain static files — no build, no dependencies. Serve the repo root:

```bash
python3 -m http.server 8888
```

Then open <http://localhost:8888>. It must be served over HTTP: opening
`index.html` from disk fails, because browsers block `fetch()` on `file://`.

Deployed via GitHub Pages from the repo root. `.github/workflows/deploy.yml` pushes
every update to `main` live automatically — no separate build, since there isn't one.
Routing is hash-based (`#/drill/...`) precisely because Pages has no rewrite rules —
a path-based route would 404 on refresh or on a shared link.

The app fetches `data/site.json` once and renders everything client-side: a home
list of every practice date, that date's plan with each drill and its diagram, a
searchable drill library, and the coaching notes.

Viewing a drill from a plan gets a sticky footer with previous/next for that
session; on a touchscreen, swiping left and right does the same thing. The swipe
is an enhancement layered on those buttons — it reads its targets from them, and
is inactive anywhere the footer isn't shown.

## Data model

**Drills are reusable; weeks reference them.** A drill record is written once and
reused every week the director assigns it, so the drill library accumulates over the
season while each week stays a thin plan.

A week contains ordered `sessions[]` (usually day *pairs* — `MONDAY/TUESDAY` — since
the email's headers are club-wide slot names shared across teams with different
schedules), each with ordered `items[]` pointing at drill ids. Prose from the email
that isn't a drill lands in `logistics[]` and `coachingNotes[]`, the latter tagged
`scope: "week"` or `"evergreen"`.

This team's practices are always Monday and Wednesday, so every session also carries
a `date` (`YYYY-MM-DD`, inferred from `weekOf` — never transcribed) which the home
screen uses to list and link to each practice.

Four conventions worth knowing before editing anything by hand:

- **Drill ids come from the PDF title, never the filename.** Attachment filenames
  arrive with punctuation mangled (`,` → `^J`, `&` → `^0`).
- **`items[]` order is the practice progression and is not numeric.** One real week
  ran Variation 2, then 1, then 3. Never sort it.
- **Transcribed fields are verbatim, including source typos.** Inferred values live
  in `derived` so the two are never confused.
- **A session's `label`/`days` stay the email's club-wide slot name, even though this
  team only practices one of those days.** `date` is the actual calendar date used.

## Tools

```bash
# extract diagrams; --map names outputs by drill id
python3 tools/extract_diagrams.py <pdf-dir> <out-dir> --map ids.json

# regenerate data/site.json from data/{drills,weeks}
python3 tools/build_site_data.py

# structure, referential integrity, and site.json freshness; exit 1 on any error
python3 tools/validate.py
```

All three are pure Python with **no third-party dependencies** —
`extract_diagrams.py` carves the embedded JPEG straight out of each PDF rather than
rasterizing it.

`validate.py` fails if `data/site.json` has drifted from the per-drill files, so a
forgotten rebuild can't ship silently.

## Known gaps

- **Diagrams are full-size** (3508×2480, ~280 KB each). Each record carries
  `needsDownscale: true`; downscale at site-build time rather than in the repo.
- **Render fallback covers two non-JPEG shapes, not arbitrary vector art.**
  `extract_diagrams.py` also decodes a plain FlateDecode `/Image` XObject and, if the
  diagram is drawn as a mosaic of inline images in the content stream, replays
  `q`/`cm`/`Q` and composites the strips into a PNG. A PDF with no raster content at
  all (genuine bezier vector art) still isn't handled and reports a miss.
- **Extraction fidelity is unverified end-to-end.** The pipeline has been dry-run, but
  the sample data was produced in the same session it was designed in. To test
  properly: move `archive/<week>/*` back to `inbox/`, run `/practice-extract` in a
  fresh session, and `git diff data/`.
- **`archive/` grows linearly** (~2 MB of PDFs per week). Drill and diagram counts
  grow only when the director introduces a new drill.
