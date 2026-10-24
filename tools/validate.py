#!/usr/bin/env python3
"""Validate the extracted practice data.

Checks structure, types, and referential integrity across data/drills,
data/weeks and data/diagrams. Run after every extraction:

    python3 tools/validate.py

Exit code 0 = clean, 1 = errors found. Warnings alone do not fail the run.
"""
import json
import re
import sys
import unicodedata
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DRILLS, WEEKS, DIAGRAMS = ROOT / "data/drills", ROOT / "data/weeks", ROOT / "data/diagrams"

errors: list[str] = []
warnings: list[str] = []


def err(m: str) -> None:
    errors.append(m)


def warn(m: str) -> None:
    warnings.append(m)


def norm(s: str) -> str:
    """Fold the punctuation the source is inconsistent about, so the email's
    en-dash/ellipsis forms compare equal to the PDF's ASCII forms."""
    s = unicodedata.normalize("NFKD", s)
    for a, b in (("–", "-"), ("—", "-"), ("…", "..."),
                 ("’", "'"), ("“", '"'), ("”", '"')):
        s = s.replace(a, b)
    return " ".join(s.lower().split())


def load(p: Path):
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception as exc:
        err(f"{p.relative_to(ROOT)}: unreadable JSON - {exc}")
        return None


# ---------- drills ----------
drills: dict[str, dict] = {}
for f in sorted(DRILLS.glob("*.json")):
    d = load(f)
    if d is None:
        continue
    rel = f.relative_to(ROOT)

    for field in ("id", "title", "source", "setup", "instructions", "coachingPoints"):
        if field not in d:
            err(f"{rel}: missing required field '{field}'")
    if "id" not in d:
        continue

    if d["id"] != f.stem:
        err(f"{rel}: id '{d['id']}' does not match filename")
    if d["id"] in drills:
        err(f"{rel}: duplicate drill id '{d['id']}'")
    drills[d["id"]] = d

    for field in ("instructions", "coachingPoints"):
        v = d.get(field)
        if not isinstance(v, list):
            err(f"{rel}: '{field}' must be a list, got {type(v).__name__}")
        elif not v:
            err(f"{rel}: '{field}' is empty")
        elif any(not isinstance(x, str) or not x.strip() for x in v):
            err(f"{rel}: '{field}' has a non-string or blank entry")

    if not isinstance(d.get("setup"), str) or not d["setup"].strip():
        err(f"{rel}: 'setup' must be a non-empty string")

    src = d.get("source") or {}
    if src.get("type") not in ("pdf", "email"):
        err(f"{rel}: source.type must be 'pdf' or 'email', got {src.get('type')!r}")
    if src.get("file") and not (ROOT / src["file"]).exists():
        warn(f"{rel}: source file missing on disk - {src['file']}")

    vid = d.get("video")
    if vid is not None:
        if not re.fullmatch(r"[\w-]{11}", str(vid.get("id", ""))):
            err(f"{rel}: video.id is not an 11-character YouTube id")
        start, end = vid.get("start"), vid.get("end")
        for k, x in (("start", start), ("end", end)):
            if x is not None and (not isinstance(x, int) or x < 0):
                err(f"{rel}: video.{k} must be whole seconds >= 0")
        if isinstance(start, int) and isinstance(end, int) and end <= start:
            err(f"{rel}: video.end must be after video.start")

    dia = d.get("diagram")
    if dia is None:
        if src.get("type") == "pdf":
            warn(f"{rel}: PDF-sourced drill has no diagram")
    else:
        if not (ROOT / dia["path"]).exists():
            err(f"{rel}: diagram path does not exist - {dia['path']}")
        elif Path(dia["path"]).stem != d["id"]:
            err(f"{rel}: diagram filename must match drill id")

# orphan diagrams (.jpg for a DCTDecode source, .png for a rendered fallback)
for img in sorted(list(DIAGRAMS.glob("*.jpg")) + list(DIAGRAMS.glob("*.png"))):
    if img.stem not in drills:
        err(f"data/diagrams/{img.name}: orphan, no drill with that id")

# ---------- weeks ----------
weeks_on_disk: dict[str, dict] = {}
for f in sorted(WEEKS.glob("*.json")):
    w = load(f)
    if w is None:
        continue
    if w.get("id"):
        weeks_on_disk[w["id"]] = w
    rel = f.relative_to(ROOT)

    for field in ("id", "sessions", "sourceEmail", "extractionFlags"):
        if field not in w:
            err(f"{rel}: missing required field '{field}'")
    if w.get("id") and w["id"] != f.stem:
        err(f"{rel}: id '{w['id']}' does not match filename")

    if w.get("weekOf") is None and not w.get("weekOfRaw"):
        err(f"{rel}: both weekOf and weekOfRaw are empty - the week is unidentifiable")
    if w.get("weekOf") is None:
        if not any(fl.get("field") == "weekOf" for fl in w.get("extractionFlags") or []):
            err(f"{rel}: weekOf is null but no extractionFlag explains why")

    seen_labels = set()
    for si, s in enumerate(w.get("sessions") or []):
        where = f"{rel} sessions[{si}]"
        if not s.get("label"):
            err(f"{where}: missing label")
        elif s["label"] in seen_labels:
            err(f"{where}: duplicate session label '{s['label']}'")
        else:
            seen_labels.add(s["label"])
        if not s.get("days"):
            err(f"{where}: 'days' is empty")
        if not s.get("date"):
            err(f"{where}: missing 'date' - the home screen needs it to list this practice")
        else:
            try:
                d = date.fromisoformat(s["date"])
                weekday = d.strftime("%A")
                if s.get("days") and weekday != s["days"][0]:
                    warn(f"{where}: date {s['date']} is a {weekday}, "
                         f"but days[0] is '{s['days'][0]}' - verify by hand")
            except ValueError:
                err(f"{where}: 'date' is not a valid YYYY-MM-DD date - {s['date']!r}")
        if not s.get("items"):
            err(f"{where}: session has no items")

        for ii, item in enumerate(s.get("items") or []):
            iw = f"{where}.items[{ii}]"
            if "asWritten" not in item or not item["asWritten"]:
                err(f"{iw}: missing 'asWritten' - needed to audit the match")
            did = item.get("drillId")
            if not did:
                err(f"{iw}: missing drillId")
            elif did not in drills:
                err(f"{iw}: dangling drillId '{did}'")
            elif item.get("asWritten"):
                # sanity-check the fuzzy match actually looks plausible
                aw, title = norm(item["asWritten"]), norm(drills[did]["title"])
                if not (aw.startswith(title) or title.startswith(aw)
                        or aw.split("(")[0].strip() and title.startswith(aw.split("(")[0].strip())):
                    warn(f"{iw}: '{item['asWritten']}' -> '{drills[did]['title']}' "
                         f"is not a prefix match; verify by hand")

    for fl in w.get("extractionFlags") or []:
        if fl.get("level") not in ("info", "warn", "error"):
            err(f"{rel}: extractionFlag level must be info|warn|error, got {fl.get('level')!r}")
    for u in w.get("unmatchedReferences") or []:
        warn(f"{rel}: unmatched reference in email - {u!r}")

# ---------- generated bundle is in sync ----------
# data/site.json is what the web app actually fetches. It is generated, so it can
# silently drift from data/{drills,weeks} -- edit a drill, forget to rebuild, and
# the site keeps serving the old text with no visible error. Catch it here.
site = ROOT / "data/site.json"
if not site.exists():
    err("data/site.json missing — run: python3 tools/build_site_data.py")
else:
    bundle = load(site)
    if bundle is not None:
        bundled_weeks = {w.get("id"): w for w in bundle.get("weeks") or []}
        if bundle.get("drills") != drills or bundled_weeks != weeks_on_disk:
            err("data/site.json is stale — run: python3 tools/build_site_data.py")

# ---------- report ----------
for m in warnings:
    print(f"WARN  {m}")
for m in errors:
    print(f"ERROR {m}", file=sys.stderr)

diagram_count = len(list(DIAGRAMS.glob("*.jpg"))) + len(list(DIAGRAMS.glob("*.png")))
print(f"\n{len(drills)} drills, {len(weeks_on_disk)} week(s), {diagram_count} diagrams")
print(f"{len(errors)} error(s), {len(warnings)} warning(s)")
sys.exit(1 if errors else 0)
