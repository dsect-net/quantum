#!/usr/bin/env python3
"""skill-audit-diff — compare two skill-audit JSON reports, surface NEW rot.

skill_audit.py answers "what is dead right now?" A scheduled watcher needs
a different question: "what BROKE since last time?" Re-alerting on the same
known dead references every week trains everyone to ignore the alert, so
this tool diffs a baseline report against a current report and classifies
every dead reference as new, still-dead, or fixed.

Identity of a dead reference (deliberately NOT the raw record):
    (skill name, kind, value, basename of source_file)

`line` is excluded: editing a SKILL.md shifts line numbers, and a moved
reference is not a new breakage. `detail` is excluded: it embeds resolved
absolute paths that differ between machines (~/ vs /home/scott/), so the
same rot reported from two hosts must still match. `status` is not part of
identity either — a reference only enters the comparison at all when its
status is "dead" in that report.

Usage:
    python3 skill_audit_diff.py BASELINE.json CURRENT.json [--json]

Exit code: 0 = no new dead references, 1 = new dead references found,
2 = usage / IO / malformed-report error (kept distinct so a watcher never
mistakes a broken run for a clean one, or for new rot).

Stdlib only. No network access.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

DEAD = "dead"


class ReportError(ValueError):
    """A report file is missing, unparseable, or not a skill-audit report."""


def _identity(skill_name: str, ref: dict) -> tuple:
    return (
        skill_name,
        str(ref.get("kind", "")),
        str(ref.get("value", "")),
        Path(str(ref.get("source_file", ""))).name,
    )


def dead_index(report: dict) -> dict:
    """Map identity -> representative record for every dead reference.

    Duplicate occurrences of the same reference in one report (a path cited
    on three lines) collapse to one entry; the lowest line number wins so
    the representative is stable.
    """
    if not isinstance(report, dict) or not isinstance(report.get("skills"), list):
        raise ReportError("report has no 'skills' list — not a skill-audit report")
    index: dict[tuple, dict] = {}
    for skill in report["skills"]:
        if not isinstance(skill, dict):
            raise ReportError("report 'skills' contains a non-object entry")
        name = str(skill.get("name", ""))
        for ref in skill.get("references") or []:
            if not isinstance(ref, dict) or ref.get("status") != DEAD:
                continue
            ident = _identity(name, ref)
            record = {
                "skill": name,
                "kind": ident[1],
                "value": ident[2],
                "source_file": ident[3],
                "line": ref.get("line"),
            }
            existing = index.get(ident)
            if existing is None or (record["line"] or 0) < (existing["line"] or 0):
                index[ident] = record
    return index


def diff_reports(baseline: dict, current: dict) -> dict:
    """Classify dead references between two reports."""
    base = dead_index(baseline)
    cur = dead_index(current)
    new_dead = [cur[k] for k in sorted(cur.keys() - base.keys())]
    fixed = [base[k] for k in sorted(base.keys() - cur.keys())]
    still_dead = [cur[k] for k in sorted(cur.keys() & base.keys())]
    return {
        "new_dead": new_dead,
        "fixed": fixed,
        "still_dead": still_dead,
        "counts": {
            "new_dead": len(new_dead),
            "fixed": len(fixed),
            "still_dead": len(still_dead),
            "baseline_dead": len(base),
            "current_dead": len(cur),
        },
    }


def load_report(path: str | Path) -> dict:
    p = Path(path)
    try:
        text = p.read_text(encoding="utf-8")
    except OSError as exc:
        raise ReportError(f"cannot read {p}: {exc}") from exc
    try:
        data = json.loads(text)
    except json.JSONDecodeError as exc:
        raise ReportError(f"{p} is not valid JSON: {exc}") from exc
    dead_index(data)  # validate shape up front
    return data


def format_text(diff: dict) -> str:
    lines: list[str] = []
    c = diff["counts"]
    if diff["new_dead"]:
        lines.append(f"NEW dead references ({c['new_dead']}):")
        for r in diff["new_dead"]:
            lines.append(f"  [{r['skill']}] {r['kind']}: {r['value']} ({r['source_file']})")
    if diff["fixed"]:
        lines.append(f"Fixed since baseline ({c['fixed']}):")
        for r in diff["fixed"]:
            lines.append(f"  [{r['skill']}] {r['kind']}: {r['value']} ({r['source_file']})")
    lines.append(
        f"Still dead: {c['still_dead']} · baseline dead: {c['baseline_dead']} "
        f"· current dead: {c['current_dead']}"
    )
    if not diff["new_dead"]:
        lines.insert(0, "No new dead references.")
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="skill-audit-diff", description=__doc__.splitlines()[0]
    )
    parser.add_argument("baseline", help="Earlier skill-audit JSON report")
    parser.add_argument("current", help="Current skill-audit JSON report")
    parser.add_argument("--json", action="store_true", help="Emit the diff as JSON")
    args = parser.parse_args(argv)

    try:
        baseline = load_report(args.baseline)
        current = load_report(args.current)
        diff = diff_reports(baseline, current)
    except ReportError as exc:
        print(f"skill-audit-diff: {exc}", file=sys.stderr)
        return 2

    if args.json:
        print(json.dumps(diff, indent=1, sort_keys=True))
    else:
        print(format_text(diff))
    return 1 if diff["new_dead"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
