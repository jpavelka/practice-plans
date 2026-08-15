#!/usr/bin/env python3
"""Bundle data/{drills,weeks} into a single data/site.json for the web app.

Static hosting can't list a directory, so the app can't discover the per-drill
files on its own. It could fetch an index and then each drill lazily, but the
whole corpus is small (tens of KB) and the app is used on a phone at a field on
flaky signal -- one request that returns everything beats N requests that each
might fail halfway through.

data/drills/*.json stays the source of truth: one file per drill keeps diffs
readable. site.json is generated and should never be hand-edited.

    python3 tools/build_site_data.py
"""
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
OUT = DATA / "site.json"


def main() -> int:
    drills = {}
    for f in sorted((DATA / "drills").glob("*.json")):
        d = json.loads(f.read_text(encoding="utf-8"))
        drills[d["id"]] = d

    weeks = []
    for f in sorted((DATA / "weeks").glob("*.json")):
        weeks.append(json.loads(f.read_text(encoding="utf-8")))

    if not weeks:
        print("no weeks found -- nothing to build", file=sys.stderr)
        return 1

    # newest first; weeks with an unresolved date sort last but keep their order
    weeks.sort(key=lambda w: (w.get("weekOf") is not None, w.get("weekOf") or ""),
               reverse=True)

    # fail loudly rather than shipping a bundle the app will choke on
    dangling = {i["drillId"] for w in weeks for s in w["sessions"] for i in s["items"]
                if i["drillId"] not in drills}
    if dangling:
        print(f"dangling drillIds: {sorted(dangling)}", file=sys.stderr)
        return 1

    bundle = {
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "weeks": weeks,
        "drills": drills,
    }
    OUT.write_text(json.dumps(bundle, ensure_ascii=False, separators=(",", ":")) + "\n",
                   encoding="utf-8")

    kb = OUT.stat().st_size / 1024
    print(f"{OUT.relative_to(ROOT)}: {len(weeks)} week(s), {len(drills)} drills, {kb:.1f} KB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
