# proof-check

Claim-level discipline. **Before recording a verdict — "complete",
"fixed", "healthy", "never happened" — run the claim through this:
the evidence offered must reach the level, and the kind, that the
claim itself requires.** A receipt proves arrival. It does not
prove contents, and it never proves the thing works.

Born from the Oct 26-27, 2026 run of overclaims, after which the
fleet rules were set (AGENTS.md, Oct 27, 2026):

> Proof level must match claim level — every check proves exactly
> the level it exercised, and the claim may not outrun it: an
> encoder/capture probe passing is not a working stream; copy
> progress is not a completed copy; a red test suite in a bare
> clone is not a regression until environment completeness is
> verified; a background delivery is not its on-disk output; a
> hardware name/index asserts nothing about which device it
> belongs to.

> A receipt is not a reading; a negative needs a source — a portal
> status proves a thing arrived, never that its fields are
> complete, and a factual negative is never answered from
> plausibility: it gets a source search first, or it is labelled
> unverified on the spot.

`proof-check` is those rules as a tool: you write down the claims
you are about to make and the evidence you actually have, and it
refuses to let the wording outrun the proof. The tool owns the
level table — a manifest cannot inflate what a kind of evidence
proves. An agent's report is level 1 even when the agent is
confident, and a probe is level 2 even when it passes.

## The six origin incidents

Each shipped in `proof-check.example.json` in its original
weak-evidence form. All six come out `OVERCLAIMED` or
`UNSUPPORTED` — that is the tool working.

| Incident (Oct 26-27, 2026) | Claim made | Evidence actually held | Verdict | Evidence that WOULD support it |
|---|---|---|---|---|
| Aflac Employer Verification | `complete` | Portal status Received / In Review (`status_report`) + employer's email saying she signed (`agent_report`) — the submitted fields were never read | OVERCLAIMED | `content_read` — read the actual submitted fields (here: only Andrea Herr or Aflac directly can produce them; until then the contents stay unverified) |
| Sunshine on vkms | `works` | Encoder/capture `probe` passed; 0 real frames, 12,585 GL errors on the first real session | OVERCLAIMED | `real_session` — a real client session streaming real frames with clean logs |
| downloads/.trash copy | `copied` | rsync `progress_output`: 269 of ~287 files, ~20 GB of ~37 GB | OVERCLAIMED | `delta_compare` — destination-vs-source file count / byte / delta verification |
| Hive entries from a background delivery | `exists` | `agent_report` delivery claiming health 2296 / entries 2463-2470, under a foreign session id — discounted, never counts | UNSUPPORTED | `output_file_read` — read the delivery's output file directly (foreground probes showed 2288 / 2462) |
| Sweetser admission history | `absent` ("never admitted") | Plausibility / snippet-level look (`search_snippet`); no source search — the answer was wrong (intake was Tuesday, April 23, 2024) | OVERCLAIMED | `source_search` — a systematic search of Scotty's own records before asserting the negative |
| Display DP-4 | `identity` | Connector `existence` in the display list; identity asserted from the name/index — DP-4 is the AMD iGPU, not NVIDIA | OVERCLAIMED | `hard_identifier` — the driver link (`/sys/class/drm/cardN/device/driver`) mapping connector to GPU |

## Evidence levels

Every evidence kind has one fixed level. Higher is stronger; a
kind never proves more than its level, whatever the manifest says.

| Level | Name | Kinds | What it actually proves |
|---|---|---|---|
| 1 | receipt | `receipt`, `status_report`, `agent_report`, `progress_output` | Something arrived, was reported, or made progress |
| 2 | surface | `existence`, `list_count`, `port_open`, `process_up`, `probe`, `search_snippet` | Something exists, is up, or responded to a probe |
| 3 | content | `content_read`, `delta_compare`, `source_search`, `hard_identifier`, `output_file_read` | The actual contents, delta, source, or hard identifier were read |
| 4 | endtoend | `endtoend_run`, `public_path`, `real_session` | The real path was exercised end to end, for real |

Discounted evidence (`"discounted": true`, with a
`discount_reason`) is printed in the report but never counts
toward any level or kind requirement. Use it for evidence you are
honestly reporting but know you cannot trust — a background
delivery under a foreign session id is the canonical case (zero
default trust until its output file is read).

## Claim requirements

| Claim type | Minimum level | Reading |
|---|---|---|
| `received` | 1 (receipt) | It arrived |
| `exists` | 2 (surface) | It is there |
| `complete` | 3 (content) | It is finished, contents and all |
| `copied` | 3 (content) | The copy matches the source |
| `absent` | 3 (content) | It is not there / never happened |
| `identity` | 3 (content) | This record/device IS that one |
| `works` | 4 (endtoend) | It works in real use |
| `fixed` | 4 (endtoend) | The user's real path now works |
| `healthy` | 4 (endtoend) | The service is healthy on the path that matters |

## Kind requirements

For these claim types, level alone is NOT enough — at least one
piece of countable evidence must be of a named kind (at the
required level; with the fixed table, these kinds sit exactly at
their claims' levels):

| Claim type | Required kind (any one) | Why |
|---|---|---|
| `complete` | `content_read` or `delta_compare` | "Complete" is a claim about contents; only reading contents or comparing the full delta proves it |
| `copied` | `content_read` or `delta_compare` | A copy is proven by comparing destination to source, never by progress |
| `absent` | `source_search` | A negative is proven by searching the source, never by not having noticed the thing |
| `identity` | `hard_identifier` | Sameness is proven by a hard identifier (serial, GUID, driver link), never by a name, label, or index |
| `works` | `endtoend_run`, `public_path`, or `real_session` | Working is proven by real use on the real path |
| `fixed` | `endtoend_run`, `public_path`, or `real_session` | Fixed is a claim about the user's experience, not the fixer's effort |
| `healthy` | `endtoend_run`, `public_path`, or `real_session` | A green check on the wrong surface is worse than no check |

So a level-3 `content_read` still leaves an `absent` claim
OVERCLAIMED (no `source_search`), and a level-3 `output_file_read`
still leaves a `complete` claim OVERCLAIMED (wrong kind). The kind
rule beats the level.

## Manifest

One JSON file: a `claims` list. Each claim names its `id`, its
`type`, the `statement` as it would be recorded, and the
`evidence` actually held for it.

```json
{
  "claims": [
    {
      "id": "aflac-employer-verification-complete",
      "type": "complete",
      "statement": "The Aflac Employer Verification is complete.",
      "evidence": [
        {"kind": "status_report", "detail": "Portal: Received, In Review"},
        {"kind": "agent_report", "detail": "Employer emailed that she signed it"}
      ]
    }
  ]
}
```

| Field | Meaning |
|---|---|
| `claims[].id` | Stable claim identifier, reported verbatim |
| `claims[].type` | One of the nine claim types above |
| `claims[].statement` | The claim as it would be written in the Tracker / morning note |
| `claims[].evidence[]` | Evidence actually held — may be an empty list (verdict: UNSUPPORTED) |
| `evidence[].kind` | One of the evidence kinds above |
| `evidence[].detail` | What the evidence is, concretely — surface probed, numbers seen, path taken |
| `evidence[].discounted` | Optional, default `false`. Reported but never counts |
| `evidence[].discount_reason` | Optional. Why the evidence is discounted |

See `proof-check.example.json` for the six origin incidents as a
full manifest.

## Verdicts & exit codes

Per claim:

- `SUPPORTED` — countable evidence meets both the required level
  and, where one is named, the required kind. The claim may be
  recorded as stated.
- `OVERCLAIMED` — some countable evidence exists, but it is below
  the required level or of the wrong kind. Weaken the wording to
  what the evidence proves (a level-1 claim: "received"), or go
  get the missing evidence.
- `UNSUPPORTED` — no countable evidence at all: none offered, or
  everything offered is discounted. The claim may not be recorded
  as fact.

Overall verdict is the weakest claim's verdict
(`UNSUPPORTED` outranks `OVERCLAIMED` outranks `SUPPORTED`):

- exit 0 — overall `SUPPORTED`: every claim supported.
- exit 1 — overall `OVERCLAIMED` or `UNSUPPORTED`: at least one
  claim outruns its evidence.
- exit 2 — `INCOMPLETE`: no verdict is possible because the
  manifest itself is invalid — bad JSON, missing/unreadable file,
  no claims or an empty claims list, a missing field, an unknown
  claim type, or an unknown evidence kind. No per-claim verdicts
  are emitted in this case; a verdict computed on a malformed
  claim set would be a lie.

## Usage

```sh
# human-readable: per-claim verdict, claim type, required level
# vs best evidence level, and the reason when not supported,
# then the overall line
python3 src/proof_check.py proof-check.example.json

# machine-readable: one JSON object
# {verdict, exit_code, manifest,
#  claims: [{id, type, statement, verdict, required_level,
#            required_level_name, best_level, best_level_name,
#            reason,
#            evidence: [{kind, level, level_name, detail,
#                        discounted, discount_reason, counted}]}],
#  errors: [...]}
python3 src/proof_check.py proof-check.example.json --json
```

Read-only. Stdlib only (Python 3.10+). It reads one manifest and
writes nothing.

## Adoption

Run `proof-check` before recording a verdict in the Tracker or
the morning note — any sentence of the form "X is complete /
fixed / healthy / works / never happened" gets a manifest entry
first, and only a `SUPPORTED` claim is written down as stated.
An `OVERCLAIMED` result is not a failure to hide: it is the
instruction to either weaken the sentence to the level actually
proven or go exercise the real path. It pairs with settle-check
(timing: settle-check proves artifacts stopped changing before
you read them) and merge-verify (merges: merge-verify proves the
merged tree runs). Settle-check guards against reading too early,
merge-verify guards against trusting a diff that never executed,
and proof-check guards against wording that outruns whatever the
other two actually proved.

## Tests

```sh
python3 -m pytest tests/ -q   # 36 tests: every claim type
                              # supported at its exact level,
                              # the origin failures (receipt does
                              # not prove complete, probe does not
                              # prove works, progress does not
                              # prove copied, agent_report capped
                              # at receipt), kind-beats-level
                              # (absent with content but no
                              # source_search, identity without
                              # hard_identifier), discounted
                              # evidence ignored -> UNSUPPORTED,
                              # no evidence -> UNSUPPORTED,
                              # invalid JSON / empty claims /
                              # unknown type / unknown kind /
                              # missing fields -> INCOMPLETE
                              # (exit 2), --json shape, mixed
                              # manifest exit 1, all-supported
                              # exit 0, human output, and the
                              # shipped example manifest coming
                              # out all-weak — all against real
                              # temp manifest files run through
                              # the real CLI
```
