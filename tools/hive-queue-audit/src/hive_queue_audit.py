#!/usr/bin/env python3
"""hive-queue-audit — read-only pre-import verifier for the Hive write queue.

While Quantum Memory's ("The Hive") embedder is down, Hive-bound memory
writes are staged in a local SQLite queue (``queue.db``, built by the
hive-queue ingest). ``ingest.py`` dedupes per payload file and refuses
credential-shaped entries at ingest time, but nothing checks the queued
rows against the contract ``memory_add_memory`` actually enforces — the
contract that has already bitten twice:

* ``tier`` must be one of ``transient`` / ``project`` / ``durable``
  (a ``high``/``medium``/``low`` tier fails validation server-side).
* ``importance`` must be a NUMBER (the string ``"high"`` fails with a
  float-parsing error).

Nor does anything check cross-payload duplicate content (the same memory
staged in two different payload files would be filed into the Hive
twice), payload-code sequence gaps, drift between a queued row and its
source payload file, or import-state consistency (a row marked
``imported`` without a Hive id).

This auditor is the import gate: run it before the backfill import (and
any time, read-only) to learn whether the queue is safe to file.

Checks (FAIL = blocks import; WARN = review by hand):

  FAIL  schema            queue table missing a required column
  FAIL  tier              tier not in {transient, project, durable}
  FAIL  importance        importance not numeric or outside 0..1
  FAIL  content-empty     content missing/blank
  FAIL  duplicate-content identical normalized content on 2+ queued rows
  FAIL  secret-shaped     credential-shaped material in queued content
                          (ingest should have refused it; belt + braces)
  FAIL  drift             queued content != source payload entry content
                          (only when --payload-dir is given and the file
                          still exists; a missing file is its own FAIL)
  FAIL  payload-missing   source payload file not found in --payload-dir
  FAIL  import-state      status not in {queued, imported}; imported row
                          without hive_id/imported_at; queued row WITH a
                          hive_id
  FAIL  tags-json         tags column present but not a JSON list
  FAIL  summary           content_summary != content[:120]
  WARN  kind-unknown      kind outside the known set (may be a new kind)
  WARN  kind-missing      kind empty/null
  WARN  agent-missing     agent empty/null (import signs rows by agent)
  WARN  code-gap          payload-code sequence has gaps in queue scope
  WARN  staged-at         staged_at missing or unparseable

Exit codes: 0 = no FAILs (WARNs allowed unless --strict), 1 = defects,
2 = audit could not run (missing/unreadable DB, no queue table).

The DB is opened read-only (SQLite URI ``mode=ro``); this tool never
writes to the queue.

Usage:
    python3 hive_queue_audit.py [--db PATH] [--payload-dir PATH]
                                [--format text|json] [--strict]
"""

import argparse
import hashlib
import json
import os
import re
import sqlite3
import sys
from collections import defaultdict

VALID_TIERS = {"transient", "project", "durable"}
KNOWN_KINDS = {"event", "fact", "correction", "decision", "preference",
               "reflection", "note", "goal", "task"}
VALID_STATUSES = {"queued", "imported"}
REQUIRED_COLUMNS = {
    "id", "staged_at", "payload_file", "payload_code", "entry_index",
    "content_summary", "content", "kind", "tier", "importance", "tags",
    "agent", "status", "hive_id", "imported_at",
}

# Same narrow credential shapes the ingest guard uses (kept in sync by
# intent; prose *about* tokens must not trip it).
SECRET_PATTERNS = [
    re.compile(r"(?i)(password|passwd|api[_-]?key|client[_-]?secret|access[_-]?token|auth[_-]?token|bearer)\s*[:=]\s*[\"']?\S{6,}"),
    re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----"),
    re.compile(r"\b(ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|sk-[A-Za-z0-9]{20,}|AKIA[A-Z0-9]{16}|xox[baprs]-[A-Za-z0-9-]{10,})\b"),
]

DEFAULT_DB = os.path.expanduser("~/workspace/hive-queue/queue.db")
DEFAULT_PAYLOAD_DIR = os.path.expanduser(
    "~/workspace/goals/quantum-memory-hygiene-during-hourly-sessions/hidden_files"
)


def code_index(code):
    return (ord(code[0]) - 97) * 26 + (ord(code[1]) - 97)


def code_name(idx):
    return chr(97 + idx // 26) + chr(97 + idx % 26)


def normalize_content(content):
    return re.sub(r"\s+", " ", (content or "").strip().lower())


def content_hash(content):
    return hashlib.sha256(normalize_content(content).encode()).hexdigest()


def find_secret(content):
    return any(p.search(content or "") for p in SECRET_PATTERNS)


class Finding:
    def __init__(self, level, check, message, row_id=None, code=None):
        self.level = level          # "FAIL" | "WARN"
        self.check = check
        self.message = message
        self.row_id = row_id
        self.code = code

    def as_dict(self):
        return {"level": self.level, "check": self.check,
                "message": self.message, "row_id": self.row_id,
                "code": self.code}


def audit(db_path, payload_dir=None):
    """Return (findings, stats) or raise AuditCannotRun."""
    if not os.path.isfile(db_path):
        raise AuditCannotRun(f"queue DB not found: {db_path}")
    try:
        conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    except sqlite3.Error as e:
        raise AuditCannotRun(f"cannot open queue DB read-only: {e}")
    conn.row_factory = sqlite3.Row
    try:
        tables = {r[0] for r in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table'")}
        if "queue" not in tables:
            raise AuditCannotRun("queue DB has no 'queue' table")
        cols = {r[1] for r in conn.execute("PRAGMA table_info(queue)")}
        findings = []
        missing_cols = REQUIRED_COLUMNS - cols
        if missing_cols:
            findings.append(Finding(
                "FAIL", "schema",
                f"queue table missing columns: {sorted(missing_cols)}"))
            return findings, {"rows": 0}
        rows = [dict(r) for r in conn.execute("SELECT * FROM queue ORDER BY id")]
    finally:
        conn.close()

    stats = {"rows": len(rows),
             "by_status": {}, "by_tier": {}, "by_kind": {}}
    for r in rows:
        stats["by_status"][r["status"]] = stats["by_status"].get(r["status"], 0) + 1
        stats["by_tier"][str(r["tier"])] = stats["by_tier"].get(str(r["tier"]), 0) + 1
        stats["by_kind"][str(r["kind"])] = stats["by_kind"].get(str(r["kind"]), 0) + 1

    # --- per-row contract checks -------------------------------------
    for r in rows:
        rid, code = r["id"], r["payload_code"]
        content = r["content"]
        if content is None or not str(content).strip():
            findings.append(Finding("FAIL", "content-empty",
                                    "content is empty", rid, code))
            content = ""
        if r["tier"] not in VALID_TIERS:
            findings.append(Finding(
                "FAIL", "tier",
                f"tier={r['tier']!r} not in {sorted(VALID_TIERS)} "
                "(memory_add_memory rejects it)", rid, code))
        imp = r["importance"]
        if imp is not None:
            if isinstance(imp, str) or not isinstance(imp, (int, float)):
                findings.append(Finding(
                    "FAIL", "importance",
                    f"importance={imp!r} is not a number "
                    "(memory_add_memory fails float parsing)", rid, code))
            elif not (0.0 <= float(imp) <= 1.0):
                findings.append(Finding(
                    "FAIL", "importance",
                    f"importance={imp} outside 0..1", rid, code))
        if r["kind"] is None or not str(r["kind"]).strip():
            findings.append(Finding("WARN", "kind-missing",
                                    "kind is empty", rid, code))
        elif r["kind"] not in KNOWN_KINDS:
            findings.append(Finding("WARN", "kind-unknown",
                                    f"kind={r['kind']!r} not in known set",
                                    rid, code))
        if r["agent"] is None or not str(r["agent"]).strip():
            findings.append(Finding("WARN", "agent-missing",
                                    "agent is empty; import signs by agent",
                                    rid, code))
        if find_secret(content):
            findings.append(Finding(
                "FAIL", "secret-shaped",
                "content matches a credential pattern; review by hand, "
                "never import as-is", rid, code))
        if r["status"] not in VALID_STATUSES:
            findings.append(Finding("FAIL", "import-state",
                                    f"status={r['status']!r} invalid",
                                    rid, code))
        elif r["status"] == "imported" and (r["hive_id"] is None
                                            or not r["imported_at"]):
            findings.append(Finding(
                "FAIL", "import-state",
                "status=imported but hive_id/imported_at missing",
                rid, code))
        elif r["status"] == "queued" and r["hive_id"] is not None:
            findings.append(Finding(
                "FAIL", "import-state",
                "status=queued but hive_id is set", rid, code))
        if r["tags"] is not None:
            try:
                tags = json.loads(r["tags"])
                if not isinstance(tags, list):
                    raise ValueError("not a list")
            except (ValueError, TypeError):
                findings.append(Finding("FAIL", "tags-json",
                                        "tags is not a JSON list",
                                        rid, code))
        if r["content_summary"] is not None and content:
            if r["content_summary"] != content[:120]:
                findings.append(Finding(
                    "FAIL", "summary",
                    "content_summary != content[:120]", rid, code))
        if not r["staged_at"]:
            findings.append(Finding("WARN", "staged-at",
                                    "staged_at missing", rid, code))

    # --- cross-row: duplicate content among queued rows ---------------
    by_hash = defaultdict(list)
    for r in rows:
        if r["status"] == "queued" and r["content"]:
            by_hash[content_hash(r["content"])].append(r)
    for h, group in by_hash.items():
        if len(group) > 1:
            ids = [g["id"] for g in group]
            codes = [g["payload_code"] for g in group]
            findings.append(Finding(
                "FAIL", "duplicate-content",
                f"identical normalized content on queued rows {ids} "
                f"(codes {codes}); importing would file it "
                f"{len(group)} times into the Hive",
                row_id=ids[0], code=codes[0]))

    # --- code sequence gaps -------------------------------------------
    codes = sorted({r["payload_code"] for r in rows
                    if r["payload_code"] and
                    re.fullmatch(r"[a-z]{2}", str(r["payload_code"]))})
    if codes:
        present = {code_index(c) for c in codes}
        gaps = [code_name(i) for i in range(min(present), max(present) + 1)
                if i not in present]
        if gaps:
            findings.append(Finding(
                "WARN", "code-gap",
                f"payload-code sequence {codes[0]}..{codes[-1]} is missing "
                f"codes: {gaps} (a skipped code may be a naming skip — "
                "the Oct 21 'aj' precedent — or a lost payload)"))

    # --- drift vs source payloads --------------------------------------
    if payload_dir:
        for r in rows:
            path = os.path.join(payload_dir, r["payload_file"] or "")
            if not os.path.isfile(path):
                findings.append(Finding(
                    "FAIL", "payload-missing",
                    f"source payload file not found: {r['payload_file']}",
                    r["id"], r["payload_code"]))
                continue
            try:
                with open(path) as fh:
                    obj = json.load(fh)
            except Exception as e:
                findings.append(Finding(
                    "FAIL", "drift",
                    f"source payload unparseable: {e}",
                    r["id"], r["payload_code"]))
                continue
            entries = obj if isinstance(obj, list) else [obj]
            idx = r["entry_index"] or 0
            if idx >= len(entries) or not isinstance(entries[idx], dict) \
                    or entries[idx].get("content") != r["content"]:
                findings.append(Finding(
                    "FAIL", "drift",
                    "queued content differs from source payload entry "
                    f"{r['payload_file']}[{idx}]; re-run ingest before "
                    "import or the Hive gets stale content",
                    r["id"], r["payload_code"]))

    stats["fails"] = sum(1 for f in findings if f.level == "FAIL")
    stats["warns"] = sum(1 for f in findings if f.level == "WARN")
    return findings, stats


class AuditCannotRun(Exception):
    pass


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--db", default=DEFAULT_DB, help="queue.db path")
    ap.add_argument("--payload-dir", default=DEFAULT_PAYLOAD_DIR,
                    help="staged payload dir for drift checks "
                         "(pass '' to skip)")
    ap.add_argument("--format", choices=["text", "json"], default="text")
    ap.add_argument("--strict", action="store_true",
                    help="WARNs also fail the audit")
    args = ap.parse_args(argv)

    payload_dir = args.payload_dir or None
    try:
        findings, stats = audit(args.db, payload_dir)
    except AuditCannotRun as e:
        if args.format == "json":
            print(json.dumps({"error": str(e)}))
        else:
            print(f"AUDIT COULD NOT RUN: {e}")
        return 2

    fails = [f for f in findings if f.level == "FAIL"]
    warns = [f for f in findings if f.level == "WARN"]
    verdict = "CLEAN" if not fails and not (args.strict and warns) else "DEFECTS"
    if args.format == "json":
        print(json.dumps({
            "db": args.db, "verdict": verdict, "stats": stats,
            "findings": [f.as_dict() for f in findings],
        }, indent=2))
    else:
        print(f"hive-queue-audit: {args.db}")
        print(f"rows: {stats['rows']}  by_status: {stats.get('by_status')}  "
              f"by_tier: {stats.get('by_tier')}")
        for f in findings:
            loc = f"row {f.row_id}" if f.row_id is not None else "queue"
            print(f"{f.level} [{f.check}] {loc} ({f.code}): {f.message}")
        print(f"verdict: {verdict} — {len(fails)} FAIL, {len(warns)} WARN")
    if fails or (args.strict and warns):
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
