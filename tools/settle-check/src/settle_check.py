#!/usr/bin/env python3
"""settle-check — verify a delegated-work claim against its settled artifacts.

Born from the Oct 22, 2026 reflection pass (AGENTS.md: "Settle-window
verification for delegated work"). Nineteen reflected failures were one
family: a verdict taken from an interim preview — a summary read before the
worker's writes flushed, a total counted by eye instead of parsed, a
replacement uploaded while the old version was trashed on an unverified ID.

This tool makes that rule executable. Given a JSON manifest describing a
claim (files that must exist, hashes/sizes they must match, and counts that
must be *derived by parsing the source*), it:

  1. Snapshots every named artifact (exists, size, mtime, sha256).
  2. Waits the manifest's settle window and snapshots again. Any change —
     or a file appearing mid-window — means the work is still
     flushing: verdict UNSETTLED, no judgment on the claim itself.
  3. Only on a stable snapshot does it judge: hashes, minimum sizes,
     required substrings, and counts parsed programmatically from JSON /
     CSV / JSONL / plain-text sources (never copied from a summary).

Exit codes (a watcher must never confuse them):
  0  VERIFIED   — settled artifacts match the claim.
  1  FAILED     — settled artifacts contradict the claim.
  2  NO VERDICT — unsettled (still changing / too young) or a bad
                  manifest / unreadable source. Re-run later; do not
                  record a verdict from this run.

Stdlib only, Python 3.10+.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path

VERIFIED, FAILED, NO_VERDICT = 0, 1, 2


# --------------------------------------------------------------------------
# Snapshots
# --------------------------------------------------------------------------

@dataclass
class FileSnap:
    path: str
    exists: bool
    size: int = 0
    mtime: float = 0.0
    sha256: str = ""

    def signature(self) -> tuple:
        return (self.exists, self.size, self.mtime, self.sha256)


class Snapshotter:
    """Real filesystem snapshotter. Tests inject a fake with the same API."""

    def snapshot(self, path: str) -> FileSnap:
        p = Path(path)
        try:
            st = p.stat()
        except OSError:
            return FileSnap(path=path, exists=False)
        h = hashlib.sha256()
        with p.open("rb") as fh:
            for chunk in iter(lambda: fh.read(65536), b""):
                h.update(chunk)
        return FileSnap(path=path, exists=True, size=st.st_size,
                        mtime=st.st_mtime, sha256=h.hexdigest())

    def read_text(self, path: str) -> str:
        return Path(path).read_text(encoding="utf-8", errors="replace")


# --------------------------------------------------------------------------
# Count derivation — always by parsing, never by eye
# --------------------------------------------------------------------------

def derive_count(text: str, fmt: str, pointer: str | None) -> int:
    """Return the record count of a source document, parsed programmatically."""
    if fmt == "json":
        data = json.loads(text)
        node = data
        if pointer:
            for part in pointer.split("."):
                if isinstance(node, dict) and part in node:
                    node = node[part]
                else:
                    raise ValueError(f"pointer {pointer!r} not found at {part!r}")
        if isinstance(node, (list, dict)):
            return len(node)
        raise ValueError(f"pointer {pointer!r} does not resolve to a list/dict")
    if fmt == "jsonl":
        return sum(1 for line in text.splitlines() if line.strip())
    if fmt == "csv":
        rows = [r for r in csv.reader(io.StringIO(text)) if r]
        return max(0, len(rows) - 1)  # minus header
    if fmt == "lines":
        return sum(1 for line in text.splitlines() if line.strip())
    raise ValueError(f"unknown count format: {fmt!r}")


def infer_format(path: str, explicit: str | None) -> str:
    if explicit:
        return explicit
    suffix = Path(path).suffix.lower()
    return {".json": "json", ".jsonl": "jsonl", ".ndjson": "jsonl",
            ".csv": "csv"}.get(suffix, "lines")


# --------------------------------------------------------------------------
# Checking
# --------------------------------------------------------------------------

@dataclass
class CheckResult:
    status: str = "verified"          # verified | failed | unsettled | error
    problems: list[str] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)

    @property
    def exit_code(self) -> int:
        return {"verified": VERIFIED, "failed": FAILED}.get(self.status, NO_VERDICT)


def load_manifest(text: str) -> dict:
    manifest = json.loads(text)
    if not isinstance(manifest, dict):
        raise ValueError("manifest must be a JSON object")
    files = manifest.get("files", [])
    counts = manifest.get("counts", [])
    if not files and not counts:
        raise ValueError("manifest names no files and no counts — nothing to verify")
    for entry in files:
        if "path" not in entry:
            raise ValueError(f"file entry missing 'path': {entry!r}")
    for entry in counts:
        if "path" not in entry or "expect" not in entry:
            raise ValueError(f"count entry needs 'path' and 'expect': {entry!r}")
    return manifest


def check(manifest: dict, snap: Snapshotter, *,
          now: float, wait=lambda s: None) -> CheckResult:
    """Two-pass settle check. `wait` is injected so tests never sleep."""
    result = CheckResult()
    settle = float(manifest.get("settle_seconds", 0))
    files = manifest.get("files", [])
    counts = manifest.get("counts", [])
    paths = [e["path"] for e in files] + [e["path"] for e in counts]

    first = {p: snap.snapshot(p) for p in paths}

    # Missing artifacts fail fast — absence is a verdict, not unsettledness,
    # unless the file appears during the window (handled by pass 2 compare).
    if settle > 0:
        wait(settle)
        second = {p: snap.snapshot(p) for p in paths}
    else:
        second = first

    # Settled means: identical across one full window. A young file that
    # survives the whole window unchanged IS settled; a file still being
    # written changes signature (size/mtime/sha) between the passes.
    for p in paths:
        a, b = first[p], second[p]
        if a.signature() != b.signature():
            result.status = "unsettled"
            result.problems.append(f"{p}: changed during the settle window "
                                   f"(size {a.size} -> {b.size}) — still flushing")
    if result.status == "unsettled":
        return result
    if settle <= 0:
        result.notes.append("no settle window requested — verdict is "
                            "point-in-time, not settle-verified")

    settled = second
    for entry in files:
        p = entry["path"]
        s = settled[p]
        if not s.exists:
            result.problems.append(f"{p}: does not exist")
            continue
        if "min_size" in entry and s.size < int(entry["min_size"]):
            result.problems.append(f"{p}: size {s.size} < min_size {entry['min_size']}")
        if "sha256" in entry and s.sha256 != entry["sha256"]:
            result.problems.append(f"{p}: sha256 mismatch "
                                   f"(got {s.sha256[:12]}…, want {str(entry['sha256'])[:12]}…)")
        if "contains" in entry:
            if entry["contains"] not in snap.read_text(p):
                result.problems.append(f"{p}: does not contain {entry['contains']!r}")
        else:
            result.notes.append(f"{p}: exists, {s.size} bytes, sha256 {s.sha256[:12]}…")

    for entry in counts:
        p = entry["path"]
        if not settled[p].exists:
            result.problems.append(f"{p}: count source does not exist")
            continue
        fmt = infer_format(p, entry.get("format"))
        try:
            actual = derive_count(snap.read_text(p), fmt, entry.get("pointer"))
        except (ValueError, json.JSONDecodeError) as exc:
            result.status = "error"
            result.problems.append(f"{p}: cannot derive count: {exc}")
            continue
        if actual != int(entry["expect"]):
            result.problems.append(f"{p}: parsed count {actual} != claimed {entry['expect']} "
                                   f"(format {fmt})")
        else:
            result.notes.append(f"{p}: parsed count {actual} matches claim (format {fmt})")

    if result.status != "error":
        result.status = "failed" if result.problems else "verified"
    return result


# --------------------------------------------------------------------------
# CLI
# --------------------------------------------------------------------------

def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("manifest", help="path to the claim manifest JSON")
    ap.add_argument("--json", action="store_true", help="emit JSON report")
    args = ap.parse_args(argv)

    try:
        manifest = load_manifest(Path(args.manifest).read_text(encoding="utf-8"))
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        print(f"settle-check: bad manifest: {exc}", file=sys.stderr)
        return NO_VERDICT

    settle = float(manifest.get("settle_seconds", 0))
    result = check(manifest, Snapshotter(), now=time.time(),
                   wait=lambda s: time.sleep(s) if s > 0 else None)

    report = {"claim": manifest.get("claim", ""), "status": result.status,
              "problems": result.problems, "notes": result.notes}
    if args.json:
        print(json.dumps(report, indent=2))
    else:
        print(f"Claim: {report['claim'] or '(unnamed)'}")
        print(f"Verdict: {result.status.upper()}")
        for n in result.notes:
            print(f"  ok      {n}")
        for p in result.problems:
            print(f"  PROBLEM {p}")
    return result.exit_code


if __name__ == "__main__":
    raise SystemExit(main())
