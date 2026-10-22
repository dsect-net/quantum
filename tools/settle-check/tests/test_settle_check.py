"""Tests for settle_check — every test is a reflected Oct 2026 failure shape."""
import hashlib
import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))
from settle_check import FileSnap, check, derive_count, load_manifest  # noqa: E402


class FakeSnap:
    """Deterministic snapshotter: serves queued snapshots per path."""

    def __init__(self, rounds, texts=None):
        # rounds: list of dicts path -> FileSnap, one per snapshot pass
        self.rounds = list(rounds)
        self.texts = texts or {}
        self.calls = 0

    def snapshot(self, path):
        idx = min(self.calls, len(self.rounds) - 1)
        snap = self.rounds[idx].get(path, FileSnap(path=path, exists=False))
        return snap

    def advance(self):
        self.calls += 1

    def read_text(self, path):
        return self.texts[path]


def snap_of(path, content: bytes, mtime=1000.0):
    return FileSnap(path=path, exists=True, size=len(content), mtime=mtime,
                    sha256=hashlib.sha256(content).hexdigest())


def run(manifest, fake, now=2000.0):
    """check() with wait() advancing the fake to its next round."""
    return check(manifest, fake, now=now, wait=lambda s: fake.advance())


class TestDeriveCount(unittest.TestCase):
    def test_json_top_level_list(self):
        self.assertEqual(derive_count("[1,2,3]", "json", None), 3)

    def test_json_pointer_to_list(self):
        doc = json.dumps({"summary": {"items": [1, 2], "other": 9}})
        self.assertEqual(derive_count(doc, "json", "summary.items"), 2)

    def test_json_pointer_missing_raises(self):
        with self.assertRaises(ValueError):
            derive_count('{"a": 1}', "json", "a.b")

    def test_csv_excludes_header(self):
        self.assertEqual(derive_count("a,b\n1,2\n3,4\n", "csv", None), 2)

    def test_jsonl_skips_blank_lines(self):
        self.assertEqual(derive_count('{"a":1}\n\n{"a":2}\n', "jsonl", None), 2)

    def test_lines_skips_blanks(self):
        self.assertEqual(derive_count("one\n\ntwo\nthree\n", "lines", None), 3)


class TestManifest(unittest.TestCase):
    def test_empty_manifest_rejected(self):
        with self.assertRaises(ValueError):
            load_manifest('{"files": [], "counts": []}')

    def test_count_entry_needs_expect(self):
        with self.assertRaises(ValueError):
            load_manifest('{"counts": [{"path": "x.json"}]}')


class TestCheck(unittest.TestCase):
    def test_verified_when_settled_and_matching(self):
        body = b"hello world"
        fake = FakeSnap([{"/a.txt": snap_of("/a.txt", body)}] * 2,
                        texts={"/a.txt": "hello world"})
        m = {"files": [{"path": "/a.txt", "min_size": 5,
                        "sha256": hashlib.sha256(body).hexdigest(),
                        "contains": "world"}]}
        r = run(m, fake)
        self.assertEqual(r.status, "verified")
        self.assertEqual(r.exit_code, 0)

    def test_missing_file_fails(self):
        fake = FakeSnap([{}] * 2)
        r = run({"files": [{"path": "/nope.txt"}]}, fake)
        self.assertEqual(r.status, "failed")
        self.assertEqual(r.exit_code, 1)

    def test_sha_mismatch_fails(self):
        fake = FakeSnap([{"/a": snap_of("/a", b"actual")}] * 2)
        m = {"files": [{"path": "/a", "sha256": "0" * 64}]}
        r = run(m, fake)
        self.assertEqual(r.status, "failed")

    def test_changing_file_is_unsettled_not_failed(self):
        # The core reflection case: worker still flushing. A verdict now
        # would be premature closure — the tool must refuse to judge.
        fake = FakeSnap([{"/a": snap_of("/a", b"one")},
                         {"/a": snap_of("/a", b"one two three")}])
        m = {"settle_seconds": 5, "files": [{"path": "/a", "min_size": 3}]}
        r = run(m, fake)
        self.assertEqual(r.status, "unsettled")
        self.assertEqual(r.exit_code, 2)

    def test_young_but_stable_file_settles_after_full_window(self):
        # Written 1s before pass 1, unchanged through a full 30s window:
        # settled by definition — the window, not the birthday, is the test.
        fake = FakeSnap([{"/a": snap_of("/a", b"data", mtime=1999.0)}] * 2)
        m = {"settle_seconds": 30, "files": [{"path": "/a"}]}
        r = run(m, fake, now=2000.0)
        self.assertEqual(r.status, "verified")

    def test_zero_window_warns_point_in_time(self):
        fake = FakeSnap([{"/a": snap_of("/a", b"data")}] * 2)
        r = run({"files": [{"path": "/a"}]}, fake)
        self.assertEqual(r.status, "verified")
        self.assertTrue(any("point-in-time" in n for n in r.notes))

    def test_count_mismatch_uses_parsed_not_claimed(self):
        # TRK-0346 shape: header said 31, parsing says 30. Parsing wins.
        doc = json.dumps({"items": list(range(30))})
        body = doc.encode()
        fake = FakeSnap([{"/r.json": snap_of("/r.json", body)}] * 2,
                        texts={"/r.json": doc})
        m = {"counts": [{"path": "/r.json", "pointer": "items", "expect": 31}]}
        r = run(m, fake)
        self.assertEqual(r.status, "failed")
        self.assertIn("30", r.problems[0])

    def test_count_match_verifies(self):
        doc = json.dumps({"items": list(range(30))})
        body = doc.encode()
        fake = FakeSnap([{"/r.json": snap_of("/r.json", body)}] * 2,
                        texts={"/r.json": doc})
        m = {"counts": [{"path": "/r.json", "pointer": "items", "expect": 30}]}
        r = run(m, fake)
        self.assertEqual(r.status, "verified")

    def test_unparseable_count_source_is_error_not_failure(self):
        fake = FakeSnap([{"/r.json": snap_of("/r.json", b"not json")}] * 2,
                        texts={"/r.json": "not json"})
        m = {"counts": [{"path": "/r.json", "expect": 1}]}
        r = run(m, fake)
        self.assertEqual(r.status, "error")
        self.assertEqual(r.exit_code, 2)

    def test_file_appearing_mid_window_is_unsettled(self):
        fake = FakeSnap([{}, {"/a": snap_of("/a", b"late")}])
        m = {"settle_seconds": 5, "files": [{"path": "/a"}]}
        r = run(m, fake)
        self.assertEqual(r.status, "unsettled")


if __name__ == "__main__":
    unittest.main()
