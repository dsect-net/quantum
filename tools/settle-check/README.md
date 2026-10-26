# settle-check

**Verify a delegated-work claim against its settled artifacts — never against the worker's summary.**

Delegated work is eventually consistent: summaries and interim previews
arrive before the writes flush, and a preview formatted as a final handoff
is a stale read, not a verdict. On Oct 21–22, 2026, nineteen reflected
failures in this fleet were that one mistake — verdicts taken from interim
previews, totals counted by eye (a header said 31/15; parsing said
30 = 16/14), a replacement loop that trashed the old version when the new
upload returned no ID. AGENTS.md now carries the rule ("Settle-window
verification for delegated work"); this tool is the rule as code.

## What it does

Given a JSON **claim manifest**, settle-check:

1. **Snapshots** every named artifact (exists, size, mtime, sha256).
2. **Waits** the manifest's `settle_seconds` window and snapshots again.
   Anything that changed during the window is still
   flushing: verdict **UNSETTLED**. The tool refuses to judge a claim
   whose artifacts are still moving.
3. Only on a stable snapshot does it **judge**: minimum sizes, sha256
   hashes, required substrings, and **counts derived by parsing the
   source** (JSON list / pointer, JSONL, CSV data rows, non-empty lines)
   — never a number copied from a summary or counted by eye.

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | VERIFIED — settled artifacts match the claim |
| 1 | FAILED — settled artifacts contradict the claim |
| 2 | NO VERDICT — unsettled, bad manifest, or unparseable count source. Re-run later; record no verdict from this run |

The 1-vs-2 distinction is the point: a broken or still-flushing run must
never be recorded as a failure of the work (or absorbed silently as a
gap), and a still-flushing run must never be recorded as success.

## Manifest

```json
{
  "claim": "Night Loop cycle 5: 30 Codex notes filed",
  "settle_seconds": 60,
  "files": [
    {"path": "/path/to/report.md", "min_size": 500, "contains": "cycle 5"},
    {"path": "/path/to/payload.bin", "sha256": "<expected hex>"}
  ],
  "counts": [
    {"path": "/path/to/index.json", "pointer": "notes", "expect": 30},
    {"path": "/path/to/ledger.csv", "expect": 16}
  ]
}
```

`format` is inferred from the extension (`.json` / `.jsonl` / `.csv`,
otherwise non-empty lines) and can be set explicitly per count entry.

## Usage

```bash
python3 src/settle_check.py claim.json          # human report
python3 src/settle_check.py claim.json --json   # machine report
python3 -m unittest discover -s tests           # 18 tests
```

Stdlib only, Python 3.10+. No network, no credentials, read-only: the
tool never modifies the artifacts it verifies.
