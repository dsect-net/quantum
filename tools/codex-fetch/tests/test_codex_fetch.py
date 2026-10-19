#!/usr/bin/env python3
"""Tests for codex_fetch.py — stdlib unittest only.

The fakes emulate the real quantum_codex_read server semantics observed
live on 2026-10-19: the request offset is a 0-based index into the file's
split("\\n") lines, the response offset is that index + 1, each chunk's
content is its lines joined with "\\n" carrying NO trailing newline, the
response reports the whole file's sha256 / byte count / line count — and
the server's `next` hint is response-offset + lines, i.e. off by one
against its own slice semantics. Following the hint skips a line per
boundary; the client must advance by lines returned instead. The fake
reproduces the buggy hint faithfully so the tests prove the client
ignores it.
"""

import hashlib
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

import codex_fetch as cf


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


class FakePagedTransport(cf.PagedTransport):
    """Server-faithful fake: lines joined per chunk, no trailing newline."""

    name = "paged"

    def __init__(self, text: str, mode: str = "join"):
        self.text = text
        self.lines = text.split("\n")
        self.mode = mode  # "join" = server-faithful; "keepends" = exact slices
        self.calls = 0

    def fetch_chunk(self, path, offset, limit):
        self.calls += 1
        start = offset  # 0-based split-index, as the real slice behaves
        if self.mode == "keepends":
            kept = self.text.splitlines(keepends=True)
            part = kept[start: start + limit]
            content = "".join(part)
            data = self.text.encode()
            truncated = start + len(part) < len(kept)
            return cf.Chunk(
                content=content, offset=start + 1, lines=len(part),
                truncated=truncated,
                sha256=sha(data), total_bytes=len(data),
                total_lines=len(self.lines),
                # the server's hint: response offset + lines (off by one)
                next_offset=(start + 1 + len(part)) if truncated else None,
            )
        part = self.lines[start: start + limit]
        content = "\n".join(part)
        truncated = start + len(part) < len(self.lines)
        data = self.text.encode()
        return cf.Chunk(
            content=content,
            offset=start + 1,  # response offset is 1-based
            lines=len(part),
            truncated=truncated,
            sha256=sha(data),
            total_bytes=len(data),
            total_lines=len(self.lines),
            # the server's hint: response offset + lines (off by one)
            next_offset=(start + 1 + len(part)) if truncated else None,
        )


class OneBasedPagedTransport(FakePagedTransport):
    """The other live dialect: offset is a 1-based line number, 0 clamps
    to line 1; the slice starts at index offset-1."""

    def fetch_chunk(self, path, offset, limit):
        self.calls += 1
        start = max(offset, 1) - 1  # 0-based index of the first line
        part = self.lines[start: start + limit]
        content = "\n".join(part)
        truncated = start + len(part) < len(self.lines)
        data = self.text.encode()
        return cf.Chunk(
            content=content, offset=start + 1, lines=len(part),
            truncated=truncated, sha256=sha(data),
            total_bytes=len(data), total_lines=len(self.lines),
            next_offset=(start + 1 + len(part)) if truncated else None,
        )


class CorruptPagedTransport(FakePagedTransport):
    """Flips one character in the first chunk — sha must catch it."""

    def fetch_chunk(self, path, offset, limit):
        chunk = super().fetch_chunk(path, offset, limit)
        if chunk.content:
            chunk.content = "X" + chunk.content[1:]
        return chunk


class MutatingPagedTransport(FakePagedTransport):
    """Reports a different oracle sha from the second chunk onward."""

    def fetch_chunk(self, path, offset, limit):
        chunk = super().fetch_chunk(path, offset, limit)
        if self.calls > 1:
            chunk.sha256 = sha(b"some other file entirely")
        return chunk


class FakeBytesTransport(cf.BytesTransport):
    name = "base64"

    def __init__(self, data: bytes, oracle_text: str):
        self._data = data
        self._oracle = oracle_text.encode()

    def probe_oracle(self, path):
        return sha(self._oracle), len(self._oracle), self._oracle.count(b"\n")

    def fetch_bytes(self, path):
        return self._data


SAMPLE = "#!/usr/bin/env python3\n\"\"\"lint — with an em dash.\"\"\"\n\n\ndef main():\n    return 0\n"
SAMPLE_NO_TRAIL = "line one\nline two\nline three"


class ReassemblyTests(unittest.TestCase):
    def fetch(self, text, chunk_lines=200, **kw):
        t = FakePagedTransport(text, **kw)
        return t.fetch_verified("some/file.py", chunk_lines), t

    def test_single_chunk_with_trailing_newline(self):
        result, _ = self.fetch(SAMPLE)
        self.assertEqual(result.data, SAMPLE.encode())
        self.assertEqual(result.sha256, sha(SAMPLE.encode()))
        self.assertEqual(result.chunks, 1)

    def test_single_chunk_without_trailing_newline(self):
        result, _ = self.fetch(SAMPLE_NO_TRAIL)
        self.assertEqual(result.data, SAMPLE_NO_TRAIL.encode())

    def test_multi_chunk_repairs_missing_boundary_newlines(self):
        # 7 split-lines at 2 lines/chunk = 4 chunks, 3 boundaries that a
        # naive concatenation would silently lose.
        result, t = self.fetch(SAMPLE, chunk_lines=2)
        self.assertGreaterEqual(t.calls, 3)
        self.assertEqual(result.data, SAMPLE.encode())
        self.assertTrue(result.strategy.startswith("join-newline"))

    def test_chunk_size_one(self):
        result, _ = self.fetch(SAMPLE_NO_TRAIL, chunk_lines=1)
        self.assertEqual(result.data, SAMPLE_NO_TRAIL.encode())

    def test_exact_chunk_multiple(self):
        text = "a\nb\nc\nd"  # 4 lines, chunk 2 divides exactly
        result, _ = self.fetch(text, chunk_lines=2)
        self.assertEqual(result.data, text.encode())

    def test_unicode_and_blank_lines_preserved(self):
        text = "café — naïve\n\n\n—\nend\n"
        result, _ = self.fetch(text, chunk_lines=3)
        self.assertEqual(result.data, text.encode())

    def test_empty_file(self):
        result, _ = self.fetch("")
        self.assertEqual(result.data, b"")

    def test_one_based_dialect_sequence(self):
        # In the 1-based dialect the start-at-0 sequence duplicates a line
        # at every boundary and must fail; the start-at-1 sequence verifies.
        t = OneBasedPagedTransport(SAMPLE)
        result = t.fetch_verified("some/file.py", 2)
        self.assertEqual(result.data, SAMPLE.encode())
        self.assertIn("start-offset 1", result.strategy)

    def test_concat_strategy_when_chunks_are_exact_slices(self):
        result, _ = self.fetch(SAMPLE, chunk_lines=2, mode="keepends")
        self.assertEqual(result.data, SAMPLE.encode())
        self.assertTrue(result.strategy.startswith("concat"))


class VerificationTests(unittest.TestCase):
    def test_corruption_is_caught_not_written(self):
        t = CorruptPagedTransport(SAMPLE)
        with self.assertRaises(cf.VerificationError) as ctx:
            t.fetch_verified("some/file.py", 200)
        self.assertTrue(ctx.exception.diagnostics)
        self.assertFalse(any(d["match"] for d in ctx.exception.diagnostics))

    def test_oracle_change_mid_fetch_is_caught(self):
        t = MutatingPagedTransport(SAMPLE)
        with self.assertRaises(cf.VerificationError):
            t.fetch_verified("some/file.py", 2)

    def test_fallback_to_bytes_transport(self):
        bad = CorruptPagedTransport(SAMPLE)
        good = FakeBytesTransport(SAMPLE.encode(), SAMPLE)
        result = cf.fetch_with_fallback([bad, good], "some/file.py", 200)
        self.assertEqual(result.data, SAMPLE.encode())
        self.assertEqual(result.transport, "base64")
        self.assertEqual(result.strategy, "exact-bytes")

    def test_all_transports_failing_raises_with_both_reports(self):
        bad = CorruptPagedTransport(SAMPLE)
        worse = FakeBytesTransport(b"tampered bytes", SAMPLE)
        with self.assertRaises(cf.VerificationError) as ctx:
            cf.fetch_with_fallback([bad, worse], "some/file.py", 200)
        self.assertIn("[paged]", str(ctx.exception))
        self.assertIn("[base64]", str(ctx.exception))

    def test_bytes_transport_mismatch_is_caught(self):
        t = FakeBytesTransport(b"not the file", SAMPLE)
        with self.assertRaises(cf.VerificationError):
            t.fetch_verified("some/file.py")


class PathValidationTests(unittest.TestCase):
    def test_rejects_traversal_and_absolute(self):
        for bad in ("../secret.md", "/etc/passwd", "a/../../b", "", "~/x.md",
                    "a//b.md", "./a.md"):
            with self.assertRaises(cf.FetchError, msg=bad):
                cf.validate_codex_path(bad)

    def test_accepts_normal_paths(self):
        self.assertEqual(
            cf.validate_codex_path("Skills/codex-bookkeeper/scripts/codex_lint.py"),
            "Skills/codex-bookkeeper/scripts/codex_lint.py",
        )


class WriteAtomicTests(unittest.TestCase):
    def test_write_atomic_roundtrip(self):
        import tempfile
        with tempfile.TemporaryDirectory() as d:
            dest = os.path.join(d, "sub", "out.py")
            cf.write_atomic(dest, SAMPLE.encode())
            with open(dest, "rb") as fh:
                self.assertEqual(fh.read(), SAMPLE.encode())
            leftovers = [f for f in os.listdir(os.path.dirname(dest))
                         if f.startswith(".codex-fetch-")]
            self.assertEqual(leftovers, [])


if __name__ == "__main__":
    unittest.main()
