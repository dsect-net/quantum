# codex-fetch

**Fetch a Quantum Codex file and *prove* you got the file.**

`quantum_codex_read` serves Codex files in line-paged chunks and, helpfully,
reports the file's true `sha256` and byte count next to the text. The catch,
found the hard way on 2026-10-18: reassembling those chunks naively is not
byte-safe. A 13,179-byte script (`Skills/codex-bookkeeper/scripts/codex_lint.py`)
came back as 13,177 bytes with a mismatched sha — the text looked right and
was wrong, which is the worst kind of wrong for code you are about to run,
restore, or diff.

Root-causing it live on 2026-10-19 (against a byte-exact base64 ground
truth) found the full picture:

* Chunk contents are their lines joined with `\n`, **no trailing newline**
  — plain concatenation loses one byte per chunk boundary (the 13,177).
* Worse, the server's paging **offset dialect is not stable across
  sessions**: in some sessions the request offset behaves as a 0-based
  split-line index, in others as a 1-based line number (0 clamped to
  line 1), and the `next` hint follows the response offset rather than
  the slice. Naive paging therefore duplicates or drops a whole line at
  every boundary (~13,071 bytes in one observed run).

`codex_fetch.py` treats the server-reported sha256 as an **oracle**:

1. Fetch chunk by chunk — sequentially, because parallel bridge calls
   supersede each other's session.
2. Run **each offset dialect as a whole sequence** (start at 0, then
   start at 1; advance by lines actually returned, never by the `next`
   hint) and try a small deterministic set of reassembly strategies per
   sequence (join-with-newline, join + trailing newline, raw
   concatenation, concatenation + trailing newline).
3. Accept only a candidate whose **sha256 and byte count both match** the
   oracle. The output file is written atomically, and only on a match.
4. If paging can't verify, fall back to a **byte-exact base64 transport**
   (`dev_shell` running `base64 -w0` on Tritium, where the vault lives at
   `/home/scott/codex`) and verify that against the same oracle.
5. If nothing verifies, fail loudly with per-candidate diagnostics and
   **write nothing**. A corrupt copy never reaches disk.

It also refuses a mid-fetch oracle change (a file edited while being read
would otherwise mix two versions into one plausible file), rejects path
traversal (`..`, absolute paths), and is stdlib-only: the verification core
is transport-injectable and fully unit-tested without a live bridge.

## Usage

```bash
# Fetch with automatic fallback, write only if verified
python3 src/codex_fetch.py Skills/codex-bookkeeper/scripts/codex_lint.py \
    -o /tmp/codex_lint.py

# Force small chunks (stress the pager), machine-readable report
python3 src/codex_fetch.py Skills/codex-bookkeeper/SKILL.md \
    -o /tmp/SKILL.md --chunk-lines 25 --json

# Verify-only: fetch and prove, write nothing
python3 src/codex_fetch.py Skills/codex-bookkeeper/scripts/codex_lint.py \
    --verify-only

# Use only the byte-exact transport
python3 src/codex_fetch.py <codex-path> -o out --transport base64
```

Exit codes: `0` fetched and verified · `1` verification failed on every
transport · `2` usage/transport error.

## Tests

```bash
python3 -m unittest discover -s tests -v
```

17 tests: single/multi-chunk reassembly (trailing newline present/absent,
chunk size 1, exact chunk multiples, unicode + blank lines, empty file,
exact-slice transports, **both offset dialects**), corruption detection,
mid-fetch oracle change, paged→base64 fallback, all-transports-fail
diagnostics, path validation, atomic write.

## Live verification (2026-10-19)

Verified against the real Codex via the Tritium bridge. Canonical file —
the one that exposed the problem —
`Skills/codex-bookkeeper/scripts/codex_lint.py`, 13,179 bytes, sha256
`f8b5cd34f88346408e9df4a62d14e05e0bb8a0c80c922b918a159c061e19c6f7`:

| Run | Result |
| --- | --- |
| `auto`, `--chunk-lines 100` (pre-dialect-fix build, 1-based session) | paged sequence failed verification as expected → base64 fallback `exact-bytes`, **byte-identical** to ground truth (`cmp` clean) — the fallback doing its job |
| `base64` only | `exact-bytes`, byte-identical |
| `paged`, `--chunk-lines 200` | initially failed in the 1-based session dialect; after the two-dialect fix: `join-newline (start-offset 1)`, 2 chunks, verified |
| `paged`, `SKILL.md` `--chunk-lines 50` | `join-newline (start-offset 1)`, 5 chunks, 12,682 bytes, sha `d94c5303…` verified; output identical to the base64 copy |
| missing file | exit 1, both transports report the 404, **no output file written** |

The server-side paging inconsistency itself is a hub bug; this tool is
the client-side armour until it is fixed.

## Limits

- Text files only in practice: the oracle comes from `quantum_codex_read`,
  which serves text. (The base64 transport moves bytes, but its oracle is
  still a codex_read probe.)
- The base64 transport inherits the bridge's output-size limits; very large
  files will fail that transport loudly (`stdoutTruncated` is checked)
  rather than silently.
- Bridge calls are sequential by design; fetching a huge file in small
  chunks is deliberately slow-but-correct.
