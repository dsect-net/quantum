#!/usr/bin/env python3
"""Tests for hive_queue_audit. Fixture DBs are built fresh per test."""
import json
import os
import sqlite3
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))
import hive_queue_audit as hqa

SCHEMA = """
CREATE TABLE queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    staged_at TEXT, payload_file TEXT NOT NULL, payload_code TEXT,
    entry_index INTEGER NOT NULL DEFAULT 0, content_summary TEXT,
    content TEXT NOT NULL, kind TEXT, tier TEXT, importance REAL,
    tags TEXT, agent TEXT, status TEXT NOT NULL DEFAULT 'queued',
    hive_id INTEGER, imported_at TEXT,
    UNIQUE (payload_file, entry_index)
);
"""

BASE = dict(staged_at="2026-10-21T11:47:00-04:00", payload_file="p-dh.json",
            payload_code="dh", entry_index=0, kind="event", tier="project",
            importance=0.5, tags='["hive"]', agent="cooper",
            status="queued", hive_id=None, imported_at=None)


def make_db(rows):
    fd, path = tempfile.mkstemp(suffix=".db")
    os.close(fd)
    conn = sqlite3.connect(path)
    conn.execute(SCHEMA)
    for r in rows:
        row = dict(BASE)
        row.update(r)
        if "content_summary" not in r and row.get("content") is not None:
            row["content_summary"] = row["content"][:120]
        conn.execute(
            "INSERT INTO queue (staged_at,payload_file,payload_code,"
            "entry_index,content_summary,content,kind,tier,importance,"
            "tags,agent,status,hive_id,imported_at) VALUES "
            "(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (row["staged_at"], row["payload_file"], row["payload_code"],
             row["entry_index"], row["content_summary"], row["content"],
             row["kind"], row["tier"], row["importance"], row["tags"],
             row["agent"], row["status"], row["hive_id"],
             row["imported_at"]))
    conn.commit()
    conn.close()
    return path


def checks(findings, level=None):
    return {f.check for f in findings if level is None or f.level == level}


class AuditTests(unittest.TestCase):
    def audit(self, rows, payload_dir=None):
        path = make_db(rows)
        self.addCleanup(os.unlink, path)
        return hqa.audit(path, payload_dir)

    def test_clean_queue_no_findings(self):
        findings, stats = self.audit([{"content": "a fine memory"}])
        self.assertEqual(findings, [])
        self.assertEqual(stats["rows"], 1)

    def test_bad_tier_fails(self):
        findings, _ = self.audit([{"content": "x", "tier": "high"}])
        self.assertIn("tier", checks(findings, "FAIL"))

    def test_string_importance_fails(self):
        findings, _ = self.audit([{"content": "x", "importance": "high"}])
        self.assertIn("importance", checks(findings, "FAIL"))

    def test_importance_out_of_range_fails(self):
        findings, _ = self.audit([{"content": "x", "importance": 1.5}])
        self.assertIn("importance", checks(findings, "FAIL"))

    def test_importance_none_is_ok(self):
        findings, _ = self.audit([{"content": "x", "importance": None}])
        self.assertNotIn("importance", checks(findings))

    def test_duplicate_content_across_payloads_fails(self):
        findings, _ = self.audit([
            {"content": "Same  memory\n text", "payload_file": "p-dh.json",
             "payload_code": "dh"},
            {"content": "same memory text", "payload_file": "p-di.json",
             "payload_code": "di"},
        ])
        self.assertIn("duplicate-content", checks(findings, "FAIL"))

    def test_duplicate_of_imported_row_is_not_a_fail(self):
        findings, _ = self.audit([
            {"content": "dup text", "payload_file": "p-dh.json"},
            {"content": "dup text", "payload_file": "p-di.json",
             "payload_code": "di", "status": "imported", "hive_id": 2141,
             "imported_at": "2026-10-25T00:00:00-04:00"},
        ])
        self.assertNotIn("duplicate-content", checks(findings, "FAIL"))

    def test_secret_shaped_content_fails(self):
        findings, _ = self.audit(
            [{"content": "note: api_key = abcdef1234567890 here"}])
        self.assertIn("secret-shaped", checks(findings, "FAIL"))

    def test_prose_about_tokens_does_not_trip_secret(self):
        findings, _ = self.audit(
            [{"content": "token watch: weekly 87% used, all good"}])
        self.assertNotIn("secret-shaped", checks(findings))

    def test_imported_without_hive_id_fails(self):
        findings, _ = self.audit(
            [{"content": "x", "status": "imported"}])
        self.assertIn("import-state", checks(findings, "FAIL"))

    def test_queued_with_hive_id_fails(self):
        findings, _ = self.audit([{"content": "x", "hive_id": 99}])
        self.assertIn("import-state", checks(findings, "FAIL"))

    def test_bad_status_fails(self):
        findings, _ = self.audit([{"content": "x", "status": "filed"}])
        self.assertIn("import-state", checks(findings, "FAIL"))

    def test_tags_not_json_list_fails(self):
        findings, _ = self.audit([{"content": "x", "tags": "not-json"}])
        self.assertIn("tags-json", checks(findings, "FAIL"))

    def test_summary_mismatch_fails(self):
        findings, _ = self.audit(
            [{"content": "real content", "content_summary": "wrong"}])
        self.assertIn("summary", checks(findings, "FAIL"))

    def test_unknown_kind_warns_not_fails(self):
        findings, _ = self.audit([{"content": "x", "kind": "dream"}])
        self.assertIn("kind-unknown", checks(findings, "WARN"))
        self.assertNotIn("kind-unknown", checks(findings, "FAIL"))

    def test_code_gap_warns_with_missing_codes(self):
        findings, _ = self.audit([
            {"content": "one", "payload_file": "p-dh.json",
             "payload_code": "dh"},
            {"content": "two", "payload_file": "p-dj.json",
             "payload_code": "dj"},
        ])
        self.assertIn("code-gap", checks(findings, "WARN"))
        gap = [f for f in findings if f.check == "code-gap"][0]
        self.assertIn("di", gap.message)

    def test_missing_db_cannot_run(self):
        with self.assertRaises(hqa.AuditCannotRun):
            hqa.audit("/nonexistent/queue.db")

    def test_db_without_queue_table_cannot_run(self):
        fd, path = tempfile.mkstemp(suffix=".db")
        os.close(fd)
        self.addCleanup(os.unlink, path)
        sqlite3.connect(path).execute("CREATE TABLE other (x)")
        with self.assertRaises(hqa.AuditCannotRun):
            hqa.audit(path)

    def test_drift_and_missing_payload(self):
        with tempfile.TemporaryDirectory() as d:
            with open(os.path.join(d, "p-dh.json"), "w") as fh:
                json.dump({"content": "payload version"}, fh)
            findings, _ = self.audit(
                [{"content": "queued version", "payload_file": "p-dh.json"},
                 {"content": "orphan", "payload_file": "p-dj.json",
                  "payload_code": "dj"}],
                payload_dir=d)
            self.assertIn("drift", checks(findings, "FAIL"))
            self.assertIn("payload-missing", checks(findings, "FAIL"))

    def test_no_drift_when_payload_matches(self):
        with tempfile.TemporaryDirectory() as d:
            with open(os.path.join(d, "p-dh.json"), "w") as fh:
                json.dump([{"content": "same"}], fh)
            findings, _ = self.audit(
                [{"content": "same", "payload_file": "p-dh.json"}],
                payload_dir=d)
            self.assertNotIn("drift", checks(findings))
            self.assertNotIn("payload-missing", checks(findings))

    def test_exit_codes(self):
        clean = make_db([{"content": "ok"}])
        dirty = make_db([{"content": "x", "tier": "high"}])
        self.addCleanup(os.unlink, clean)
        self.addCleanup(os.unlink, dirty)
        self.assertEqual(hqa.main(["--db", clean, "--payload-dir", ""]), 0)
        self.assertEqual(hqa.main(["--db", dirty, "--payload-dir", ""]), 1)
        self.assertEqual(hqa.main(["--db", "/nope.db"]), 2)

    def test_strict_makes_warns_fail(self):
        path = make_db([{"content": "x", "kind": "dream"}])
        self.addCleanup(os.unlink, path)
        self.assertEqual(hqa.main(["--db", path, "--payload-dir", ""]), 0)
        self.assertEqual(
            hqa.main(["--db", path, "--payload-dir", "", "--strict"]), 1)


if __name__ == "__main__":
    unittest.main()
