# soccer-practice

Turns the club director's weekly practice email (plus its drill PDF attachments)
into structured JSON, so the week's plan can be read on a phone at the field
instead of by scrolling an email and opening attachments one at a time.

## Layout

```
inbox/            drop zone for a new week (gitignored)
archive/<week>/   raw email + PDFs, kept as provenance
data/drills/      one record per drill, reused across weeks
data/weeks/       one record per week, references drills by id
data/diagrams/    field diagram carved out of each drill PDF
tools/            extraction + validation scripts
.claude/skills/   the /practice-extract skill
```

## Weekly workflow

1. Paste the email body into `inbox/body.txt` and save the attachments into `inbox/`.
2. Run `/practice-extract` in Claude Code.
3. Review the reported `extractionFlags`, then `git diff` and commit.

The skill reads the email and every PDF, writes drill and week records, extracts
diagrams, archives the raw input, and validates the result.

## Data model

**Drills are reusable; weeks reference them.** A drill record is written once and
reused every week the director assigns it, so the drill library accumulates over the
season while each week stays a thin plan.

A week contains ordered `sessions[]` (usually day *pairs* — `MONDAY/TUESDAY`), each
with ordered `items[]` pointing at drill ids. Prose from the email that isn't a drill
lands in `logistics[]` and `coachingNotes[]`, the latter tagged `scope: "week"` or
`"evergreen"`.

Three conventions worth knowing before editing anything by hand:

- **Drill ids come from the PDF title, never the filename.** Attachment filenames
  arrive with punctuation mangled (`,` → `^J`, `&` → `^0`).
- **`items[]` order is the practice progression and is not numeric.** One real week
  ran Variation 2, then 1, then 3. Never sort it.
- **Transcribed fields are verbatim, including source typos.** Inferred values live
  in `derived` so the two are never confused.

## Tools

```bash
# extract diagrams; --map names outputs by drill id
python3 tools/extract_diagrams.py <pdf-dir> <out-dir> --map ids.json

# structure + referential integrity; exit 1 on any error
python3 tools/validate.py
```

`extract_diagrams.py` carves the embedded JPEG straight out of each PDF and has **no
third-party dependencies**.

## Known gaps

- **Diagrams are full-size** (3508×2480, ~280 KB each). Each record carries
  `needsDownscale: true`; downscale at site-build time rather than in the repo.
- **No render fallback.** If a future PDF stores its diagram as vector art instead of
  a JPEG, extraction reports a miss and exits non-zero. Rasterizing page 1 wholesale
  needs a real PDF renderer, which isn't wired up. Every PDF seen so far succeeds.
- **Extraction fidelity is unverified end-to-end.** The pipeline has been dry-run, but
  the sample data was produced in the same session it was designed in. To test
  properly: move `archive/<week>/*` back to `inbox/`, run `/practice-extract` in a
  fresh session, and `git diff data/`.
- **`archive/` grows linearly** (~2 MB of PDFs per week). Drill and diagram counts
  grow only when the director introduces a new drill.
