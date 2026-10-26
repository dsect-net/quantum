# hive-queue-audit

Read-only pre-import verifier for the Hive write queue — the local SQLite
queue (`~/workspace/hive-queue/queue.db`) that stages Quantum Memory
("The Hive") writes while the Hive's embedder is down.

## Why

`ingest.py` (in the hive-queue folder) folds staged payload files into
`queue.db`: it dedupes per payload file and refuses credential-shaped
entries. But nothing checked the queued rows against the contract
`memory_add_memory` actually enforces — the contract that has already
failed twice in production use:

- **tier** must be `transient` / `project` / `durable` (2026-10-09:
  `high`/`medium`/`low` rejected by validation).
- **importance** must be a number (2026-10-11: the string `"high"` failed
  float parsing).

And nothing checked the queue-level hazards an import would hit all at
once: the same memory staged in two different payload files (ingest
dedupes per file, not across files — the Hive would get it twice),
payload-code sequence gaps, drift between a queued row and its source
payload, or import-state inconsistencies (a row marked `imported` with
no Hive id).

This tool is the import gate. The Hive import procedure's step 1 is
"confirm the Hive is healthy"; step 1.5 is now "run hive-queue-audit
and get CLEAN."

## Checks

FAIL (blocks import): schema columns, tier validity, importance type
and 0..1 range, empty content, duplicate normalized content across
queued rows, credential-shaped content, drift vs the source payload
entry, missing source payload file, import-state consistency, tags not
a JSON list, content_summary mismatch.

WARN (review by hand): unknown/missing kind, missing agent, payload-code
sequence gaps, missing staged_at.

## Usage

```sh
python3 src/hive_queue_audit.py                 # real queue + payloads
python3 src/hive_queue_audit.py --format json   # machine-readable
python3 src/hive_queue_audit.py --strict        # WARNs also fail
python3 src/hive_queue_audit.py --db PATH --payload-dir ''  # DB only
```

Exit codes: `0` clean, `1` defects, `2` audit could not run (missing or
unreadable DB, no `queue` table). The DB is opened read-only
(`mode=ro`); the tool never writes to the queue.

## Tests

```sh
python3 -m unittest discover -s tests -v   # 22 tests
```

First live run (2026-10-24, against the real queue): see the PR /
Tracker TRK-0418 for the findings of the day.
