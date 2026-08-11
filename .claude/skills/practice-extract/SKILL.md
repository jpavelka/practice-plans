---
name: practice-extract
description: Extract the club director's weekly practice email and its drill PDF attachments into structured JSON under data/. Use when the user drops a new week into inbox/, says "extract this week", "process the new email", or runs /practice-extract.
---

# Extract a weekly practice plan

Turn one weekly email plus its PDF attachments into `data/weeks/<id>.json` and any
new `data/drills/<id>.json` records, with diagrams extracted as images.

## Input

```
inbox/
  body.txt          the email body, pasted verbatim
  *.pdf             the drill attachments
```

If `inbox/` is empty or missing `body.txt`, stop and say so — don't hunt for files elsewhere.

## Output

```
data/drills/<drill-id>.json     one per drill, reused across weeks
data/weeks/<week-id>.json       the plan; references drills by id
data/diagrams/<drill-id>.jpg    field diagram carved out of the PDF
archive/<week-id>/              raw body.txt + PDFs, moved from inbox/
```

## Steps

1. **Read `inbox/body.txt`.** Identify the week, theme, session groups and their
   ordered drill lists, plus the prose sections (technical points, coaching points,
   logistics, season focus).

2. **Read every PDF in `inbox/` with the Read tool.** These are image-based layouts —
   read them as documents and transcribe. Do not try to parse the PDF bytes for text.

3. **Write one drill record per drill.** Reuse an existing `data/drills/<id>.json`
   if the drill already exists; only create a new file for genuinely new drills.
   Leave `diagram` as `null` for now — the next step fills it in.

4. **Extract diagrams.** Write a map of PDF filename → drill id, then run the
   extractor with it so outputs are named by id (IDs must already exist, which is
   why this follows step 3):

   ```bash
   cat > /tmp/ids.json <<'JSON'
   { "Shooting Variation 4 - Shooting Off The Layoff.pdf":
     "shooting-variation-4-shooting-off-the-layoff" }
   JSON
   python3 tools/extract_diagrams.py inbox data/diagrams --map /tmp/ids.json
   ```

   Then set each drill's `diagram` block from the result. If the script reports a
   miss, see *Fallback* below.

5. **Write the week record**, resolving each listed drill name to a drill id.

6. **Move `inbox/*` to `archive/<week-id>/`** and update each new drill's
   `source.file` to the archived path.

7. **Run `python3 tools/validate.py`.** Fix anything it reports. Do not finish on a
   non-zero exit.

8. **Report** what you extracted: new drills vs reused, any unmatched references, and
   every `extractionFlags` entry you raised.

## Drill records

```jsonc
{
  "id": "shooting-variation-4-shooting-off-the-layoff",
  "title": "Shooting Variation 4 - Shooting Off The Layoff",  // verbatim from the PDF
  "source": { "type": "pdf", "file": "archive/<week-id>/<original>.pdf",
              "originalFilename": "...", "firstSeenWeek": "<week-id>" },
  "diagram": { "path": "data/diagrams/<id>.jpg", "width": 3508, "height": 2480,
               "bytes": 299348, "extractedFrom": "page-1 DCTDecode XObject",
               "needsDownscale": true },
  "setup": "...",                  // string — prose describing the configuration
  "instructions": ["...", "..."],  // list — one step per entry
  "coachingPoints": ["...", "..."],// list — one point per entry
  "derived": { "equipment": [], "ageNotes": null, "areaSize": null,
               "formation": null, "tags": [] }
}
```

**`id`** is a slug of the PDF *title*, never the filename. Attachment filenames arrive
mangled (`,` → `^J`, `&` → `^0`) and get renamed by hand; titles are stable.

**Splitting into lists.** One step or one coaching point per entry. Split on sentence
boundaries, but keep a multi-clause thought together — `"Shooting: step side by side
with the ball, not too far, not too close."` is one point, not three. Never drop or
paraphrase text; every word in the source must land somewhere.

**Transcribe verbatim, including errors.** The source contains typos (`"Swing the
kicking let up"`, `"opposide side"`, a `2v1` labelled `2V1`). Keep them. Silent
correction makes it impossible to tell extraction mistakes from source mistakes.

**`setup` stays a string.** It describes a configuration, not a sequence.

**`derived` is your inference, everything above it is transcription.** Field
dimensions, equipment and age notes are embedded in the prose — infer them into
`derived` if useful, but never promote a guess into a transcribed field. If you
can't tell, use `null`.

## Week records

```jsonc
{
  "id": "2026-09-14", "weekOf": "2026-09-14", "weekOfRaw": "September 14-17",
  "theme": "...", "goal": "...", "seasonFocus": "...",
  "sourceEmail": { "file": "archive/<id>/body.txt", "from": "Mauro",
                   "subject": null, "receivedAt": null, "attachmentCount": 7 },
  "sessions": [{ "label": "Monday/Tuesday", "days": ["Monday", "Tuesday"],
                 "items": [{ "drillId": "...", "asWritten": "...", "note": null }] }],
  "logistics": ["..."],
  "coachingNotes": [{ "title": "...", "scope": "week|evergreen", "points": ["..."] }],
  "unmatchedReferences": [],
  "extractionFlags": [{ "level": "info|warn|error", "field": "...", "message": "..." }]
}
```

**Sessions are usually day-*pairs*** (`MONDAY/TUESDAY`), not single days. Put every day
in `days[]` and keep the director's own wording in `label`.

**Never reorder `items`.** The list order is the practice progression and it is not
numeric — a real week ran Variation 2, then 1, then 3. Sorting it silently corrupts
the plan.

**`asWritten`** holds the director's exact phrasing for that line, including any
parenthetical. It is how a bad match gets spotted later, so it is required on every
item. Pull a trailing parenthetical into `note` as well when it carries an
instruction (`"Shooting Variation 4 (You can repeat variations 2, 1 and 3)"` →
`note: "You can repeat variations 2, 1 and 3"`).

**`coachingNotes` are separate from drills.** Tag `scope: "week"` for notes tied to
this week's theme, `"evergreen"` for permanent reference material.

## Matching drill names to PDFs

The email names drills loosely; the PDF titles are longer and punctuated differently.
Exact string comparison fails on roughly a third of real lines. Match by:

1. Normalizing both sides — casefold, collapse whitespace, and fold `–`/`—` → `-`,
   `…` → `...`, curly quotes → straight.
2. Prefix match: `"Shooting Variation 2"` matches
   `"Shooting Variation 2 - Dribble-Touch To The Side-Shoot Side-On"`.
3. Ignoring any trailing parenthetical before matching.

If a listed drill has no PDF, check whether it is defined **inline in the email body**
— warmups often are. If so, create a drill record with `source.type: "email"`,
`source.sectionHeading` set to the heading it came from, and `diagram: null`.

Only if it appears nowhere does it go in `unmatchedReferences`. A PDF that arrives but
is never referenced still gets a drill record; flag it as `info`.

## Flags

Raise an `extractionFlags` entry for anything a human should look at: an unresolvable
date, a drill you matched with low confidence, a session structure that differs from
previous weeks, a PDF whose layout didn't parse cleanly.

Dates are the recurring one. Emails give a range with no year (`"week of April 20-23"`)
and the body can contradict itself (one sample says `"this fall season"` *and*
`"Last spring..."` above an April date — recycled boilerplate). Put the raw string in
`weekOfRaw` always. Set `weekOf` only from a real received-date or an explicit
statement; otherwise leave it `null` **and** flag it — the validator enforces that
pairing.

## Fallback: diagram extraction fails

`tools/extract_diagrams.py` pulls the embedded JPEG from page 1. Every PDF seen so far
has exactly one. If it reports a miss, the diagram is probably vector art or a
non-JPEG bitmap, which needs a real renderer (`pymupdf` or `pdfjs-dist`) to rasterize
page 1 wholesale. That path is **not implemented**. Set `diagram: null`, raise a
`warn` flag naming the file, and tell the user — do not fabricate a path.
