#!/usr/bin/env python3
"""skill-audit-watch — scheduled watcher: alert ONLY on new skill rot.

Runs skill_audit.py, diffs its JSON report against a stored baseline
(skill_audit_diff), and:

  * first run: stores the report as the baseline, exits 0 — known rot is
    recorded, not alerted;
  * later runs: prints an alert block only when NEW dead references appear,
    otherwise a one-line quiet summary. Either way the baseline advances to
    the current report (atomically), so each breakage alerts exactly once;
  * scanner failure / unparseable output / malformed report: exits 2 and
    leaves the baseline untouched — a broken run never masquerades as a
    clean one and never swallows the next real alert.

State in --state-dir:
    baseline.json   last accepted report (the diff reference point)
    last-diff.json  the most recent diff result (for inspection)
    last-report.json the most recent raw scanner report

Usage:
    python3 skill_audit_watch.py --state-dir DIR [--scanner PATH]
                                 [SKILL_ROOT ...] [--check-repos]

--scanner defaults to skill_audit.py sitting next to this file.
Roots default to the scanner's own defaults when omitted.
Exit code: 0 = no new dead, 1 = new dead found, 2 = run failed.

Stdlib only. The only subprocess is the scanner itself.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from skill_audit_diff import ReportError, diff_reports, format_text, load_report  # noqa: E402


def _atomic_write_json(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=str(path.parent), suffix=".tmp")
    try:
        with open(fd, "w", encoding="utf-8") as fh:
            json.dump(data, fh, indent=1, sort_keys=True)
        Path(tmp).replace(path)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise


def run_scanner(scanner: Path, roots: list[str], check_repos: bool) -> dict:
    cmd = [sys.executable, str(scanner), *roots, "--json"]
    if check_repos:
        cmd.append("--check-repos")
    proc = subprocess.run(cmd, capture_output=True, text=True)
    # The scanner exits 1 when it merely FINDS dead references — that is a
    # successful scan, not a failure. Exit 2 (usage error) or missing /
    # unparseable stdout is the failure case.
    if proc.returncode not in (0, 1) or not proc.stdout.strip():
        detail = (proc.stderr or proc.stdout or "").strip()[:400]
        raise ReportError(
            f"scanner failed (exit {proc.returncode})" + (f": {detail}" if detail else "")
        )
    try:
        data = json.loads(proc.stdout)
    except json.JSONDecodeError as exc:
        raise ReportError(f"scanner output is not valid JSON: {exc}") from exc
    from skill_audit_diff import dead_index

    dead_index(data)  # validate shape
    return data


def watch(state_dir: Path, scanner: Path, roots: list[str], check_repos: bool) -> tuple[int, str]:
    """One watch cycle. Returns (exit_code, message)."""
    current = run_scanner(scanner, roots, check_repos)
    baseline_path = state_dir / "baseline.json"

    if not baseline_path.exists():
        _atomic_write_json(baseline_path, current)
        _atomic_write_json(state_dir / "last-report.json", current)
        from skill_audit_diff import dead_index

        n = len(dead_index(current))
        return 0, f"Baseline established: {n} known dead reference(s) recorded, none alerted."

    baseline = load_report(baseline_path)
    diff = diff_reports(baseline, current)
    _atomic_write_json(state_dir / "last-diff.json", diff)
    _atomic_write_json(state_dir / "last-report.json", current)
    _atomic_write_json(baseline_path, current)  # advance: each breakage alerts once

    if diff["new_dead"]:
        return 1, "⚠ NEW skill rot detected\n" + format_text(diff)
    c = diff["counts"]
    return 0, (
        f"No new dead references. Still dead: {c['still_dead']} · fixed: {c['fixed']}."
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="skill-audit-watch", description=__doc__.splitlines()[0]
    )
    parser.add_argument("--state-dir", required=True, help="Dir holding baseline/diff state")
    parser.add_argument("--scanner", help="Path to skill_audit.py (default: alongside this file)")
    parser.add_argument("--check-repos", action="store_true", help="Pass --check-repos to the scanner")
    parser.add_argument("roots", nargs="*", help="Skill root dirs for the scanner")
    args = parser.parse_args(argv)

    scanner = (
        Path(args.scanner)
        if args.scanner
        else Path(__file__).resolve().parent / "skill_audit.py"
    )
    if not scanner.is_file():
        print(f"skill-audit-watch: scanner not found: {scanner}", file=sys.stderr)
        return 2
    try:
        code, message = watch(Path(args.state_dir), scanner, args.roots, args.check_repos)
    except ReportError as exc:
        print(f"skill-audit-watch: {exc}", file=sys.stderr)
        return 2
    print(message)
    return code


if __name__ == "__main__":
    raise SystemExit(main())
