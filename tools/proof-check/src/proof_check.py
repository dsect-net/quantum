#!/usr/bin/env python3
"""proof-check — check that proof level matches claim level.

Implements the fleet rules (AGENTS.md, Oct 27, 2026):

> Proof level must match claim level — every check proves exactly
> the level it exercised, and the claim may not outrun it.

> A receipt is not a reading; a negative needs a source — a portal
> status (Received / In Review / submitted / signed-by-X) proves a
> thing arrived, never that its fields are complete; and a factual
> negative about Scotty's own history is never answered from
> plausibility — it gets a source search first or is labelled
> unverified on the spot.

Born from the Oct 26-27, 2026 incidents: an Aflac Employer
Verification called complete off a portal "Received" status, a
Sunshine stream called working off an encoder probe that captured
zero real frames, a copy called complete off rsync progress, Hive
entries claimed from a background delivery under a foreign session
id, a Sweetser "never admitted" negative asserted with no source
search, and a display's GPU identity asserted from its connector
name instead of the driver link.

The tool owns the evidence-level table: a manifest lists claims
and the evidence offered for each, but a manifest cannot inflate
what a kind of evidence proves. Each claim gets exactly one
verdict — SUPPORTED, OVERCLAIMED, or UNSUPPORTED — from the level
of its best countable evidence and, for the claim types that name
one, a required evidence kind. Discounted evidence (reported, but
known-untrustworthy — e.g. a delivery under a foreign session id)
is listed in the report and never counts.

Stdlib only, Python 3.10+. Read-only: it reads one manifest file
and writes nothing.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

VERDICT_SUPPORTED = "SUPPORTED"
VERDICT_OVERCLAIMED = "OVERCLAIMED"
VERDICT_UNSUPPORTED = "UNSUPPORTED"
VERDICT_INCOMPLETE = "INCOMPLETE"

EXIT_SUPPORTED = 0
EXIT_REJECTED = 1
EXIT_INCOMPLETE = 2

# Evidence kinds -> the level of proof they actually provide.
# The tool owns this table; manifests cannot inflate a kind.
EVIDENCE_LEVELS: dict[str, int] = {
    # level 1 — receipt: something arrived / was reported / progressed
    "receipt": 1,
    "status_report": 1,
    "agent_report": 1,
    "progress_output": 1,
    # level 2 — surface: something exists / is up / responded to a probe
    "existence": 2,
    "list_count": 2,
    "port_open": 2,
    "process_up": 2,
    "probe": 2,
    "search_snippet": 2,
    # level 3 — content: the actual contents / delta / source were read
    "content_read": 3,
    "delta_compare": 3,
    "source_search": 3,
    "hard_identifier": 3,
    "output_file_read": 3,
    # level 4 — end-to-end: the real path was exercised for real
    "endtoend_run": 4,
    "public_path": 4,
    "real_session": 4,
}

LEVEL_NAMES: dict[int, str] = {
    0: "none",
    1: "receipt",
    2: "surface",
    3: "content",
    4: "endtoend",
}

# Claim types -> minimum evidence level the claim requires.
CLAIM_REQUIRED_LEVEL: dict[str, int] = {
    "received": 1,
    "exists": 2,
    "complete": 3,
    "copied": 3,
    "absent": 3,
    "identity": 3,
    "works": 4,
    "fixed": 4,
    "healthy": 4,
}

# Claim types where level alone is not enough: at least one piece
# of countable evidence must be of one of these kinds (and, per the
# level check, at the required level — with the fixed table above
# these kinds sit exactly at their claims' required levels).
KIND_REQUIREMENTS: dict[str, frozenset[str]] = {
    "complete": frozenset({"content_read", "delta_compare"}),
    "copied": frozenset({"content_read", "delta_compare"}),
    "absent": frozenset({"source_search"}),
    "identity": frozenset({"hard_identifier"}),
    "works": frozenset({"endtoend_run", "public_path", "real_session"}),
    "fixed": frozenset({"endtoend_run", "public_path", "real_session"}),
    "healthy": frozenset({"endtoend_run", "public_path", "real_session"}),
}

# Severity ranking for the overall verdict: the manifest's verdict
# is its weakest claim's verdict.
_SEVERITY = {VERDICT_SUPPORTED: 0, VERDICT_OVERCLAIMED: 1, VERDICT_UNSUPPORTED: 2}


def _level_label(level: int) -> str:
    return f"{level} ({LEVEL_NAMES[level]})"


def _validate_manifest(data) -> list[str]:
    """Return a list of validation errors (empty = manifest is usable)."""
    errors: list[str] = []

    if not isinstance(data, dict):
        return ["manifest must be a JSON object"]

    claims = data.get("claims")
    if not isinstance(claims, list) or len(claims) == 0:
        return ["manifest 'claims' list is missing or empty"]

    for idx, claim in enumerate(claims):
        where = f"claim #{idx}"
        if not isinstance(claim, dict):
            errors.append(f"{where} is not an object")
            continue
        cid = claim.get("id")
        if isinstance(cid, str) and cid:
            where = f"claim {cid!r}"
        else:
            errors.append(f"{where} missing non-empty string 'id'")

        ctype = claim.get("type")
        if not isinstance(ctype, str) or not ctype:
            errors.append(f"{where} missing string 'type'")
        elif ctype not in CLAIM_REQUIRED_LEVEL:
            errors.append(f"{where} unknown claim type: {ctype!r}")

        if not isinstance(claim.get("statement"), str):
            errors.append(f"{where} missing string 'statement'")

        evidence = claim.get("evidence")
        if not isinstance(evidence, list):
            errors.append(f"{where} missing list 'evidence'")
            continue
        for eidx, ev in enumerate(evidence):
            ewhere = f"{where} evidence #{eidx}"
            if not isinstance(ev, dict):
                errors.append(f"{ewhere} is not an object")
                continue
            kind = ev.get("kind")
            if not isinstance(kind, str) or not kind:
                errors.append(f"{ewhere} missing string 'kind'")
            elif kind not in EVIDENCE_LEVELS:
                errors.append(f"{ewhere} unknown evidence kind: {kind!r}")
            if not isinstance(ev.get("detail"), str):
                errors.append(f"{ewhere} missing string 'detail'")
            if "discounted" in ev and not isinstance(ev["discounted"], bool):
                errors.append(f"{ewhere} 'discounted' must be a boolean")
            if "discount_reason" in ev and not isinstance(ev["discount_reason"], str):
                errors.append(f"{ewhere} 'discount_reason' must be a string")

    return errors


def _evaluate_claim(claim: dict) -> dict:
    ctype = claim["type"]
    required_level = CLAIM_REQUIRED_LEVEL[ctype]

    evidence_out: list[dict] = []
    countable_levels: list[int] = []
    countable_kinds: list[str] = []

    for ev in claim["evidence"]:
        kind = ev["kind"]
        level = EVIDENCE_LEVELS[kind]
        discounted = bool(ev.get("discounted", False))
        evidence_out.append({
            "kind": kind,
            "level": level,
            "level_name": LEVEL_NAMES[level],
            "detail": ev["detail"],
            "discounted": discounted,
            "discount_reason": ev.get("discount_reason"),
            "counted": not discounted,
        })
        if not discounted:
            countable_levels.append(level)
            countable_kinds.append(kind)

    best_level = max(countable_levels) if countable_levels else 0

    reasons: list[str] = []
    if not countable_levels:
        verdict = VERDICT_UNSUPPORTED
        if claim["evidence"]:
            reasons.append(
                "no countable evidence: every item offered is discounted, "
                "and discounted evidence never counts"
            )
        else:
            reasons.append("no evidence offered")
    else:
        level_ok = best_level >= required_level
        if not level_ok:
            reasons.append(
                f"best evidence level is {_level_label(best_level)}, below the "
                f"required level {_level_label(required_level)} for a "
                f"'{ctype}' claim"
            )

        kind_ok = True
        required_kinds = KIND_REQUIREMENTS.get(ctype)
        if required_kinds is not None:
            kind_ok = any(
                kind in required_kinds and EVIDENCE_LEVELS[kind] >= required_level
                for kind in countable_kinds
            )
            if not kind_ok:
                kinds_txt = " or ".join(sorted(required_kinds))
                reasons.append(
                    f"a '{ctype}' claim requires evidence of kind {kinds_txt} "
                    f"at level {_level_label(required_level)}; none offered "
                    f"(offered kinds: {', '.join(sorted(set(countable_kinds))) or 'none'})"
                )

        verdict = VERDICT_SUPPORTED if (level_ok and kind_ok) else VERDICT_OVERCLAIMED

    return {
        "id": claim["id"],
        "type": ctype,
        "statement": claim["statement"],
        "verdict": verdict,
        "required_level": required_level,
        "required_level_name": LEVEL_NAMES[required_level],
        "best_level": best_level,
        "best_level_name": LEVEL_NAMES[best_level],
        "reason": "; ".join(reasons),
        "evidence": evidence_out,
    }


def run_check(manifest_arg: str) -> dict:
    errors: list[str] = []
    manifest_path = Path(manifest_arg).expanduser()
    manifest_label = str(manifest_path)

    data = None
    try:
        raw = manifest_path.read_text(encoding="utf-8")
    except FileNotFoundError:
        errors.append(f"manifest not found: {manifest_path}")
        raw = None
    except OSError as exc:
        errors.append(f"manifest cannot be read: {manifest_path}: {exc}")
        raw = None

    if raw is not None:
        try:
            manifest_label = str(manifest_path.resolve())
        except Exception:
            pass
        try:
            data = json.loads(raw)
        except Exception as exc:  # JSON parse error
            errors.append(f"manifest does not parse: {manifest_path}: {exc}")
            data = None

    if data is not None:
        errors.extend(_validate_manifest(data))

    if errors:
        # Invalid manifest: INCOMPLETE, and no per-claim verdict —
        # a verdict computed on a malformed claim set would be a lie.
        return _finish(
            verdict=VERDICT_INCOMPLETE,
            manifest=manifest_label,
            claims=[],
            errors=errors,
        )

    claims_out = [_evaluate_claim(claim) for claim in data["claims"]]
    overall = max((c["verdict"] for c in claims_out), key=lambda v: _SEVERITY[v])
    return _finish(
        verdict=overall,
        manifest=manifest_label,
        claims=claims_out,
        errors=[],
    )


def _finish(*, verdict, manifest, claims, errors) -> dict:
    exit_code = {
        VERDICT_SUPPORTED: EXIT_SUPPORTED,
        VERDICT_OVERCLAIMED: EXIT_REJECTED,
        VERDICT_UNSUPPORTED: EXIT_REJECTED,
        VERDICT_INCOMPLETE: EXIT_INCOMPLETE,
    }[verdict]
    return {
        "verdict": verdict,
        "exit_code": exit_code,
        "manifest": manifest,
        "claims": claims,
        "errors": errors,
    }


def _print_human(result: dict) -> None:
    print(f"proof-check: {result['verdict']}")
    print(f"  manifest: {result['manifest']}")
    if result["claims"]:
        print("  claims:")
        for claim in result["claims"]:
            line = (
                f"    - {claim['id']}: {claim['verdict']} "
                f"(type={claim['type']}, "
                f"required level {_level_label(claim['required_level'])}, "
                f"best evidence level {_level_label(claim['best_level'])})"
            )
            if claim["verdict"] != VERDICT_SUPPORTED and claim["reason"]:
                line += f" — {claim['reason']}"
            print(line)
            for ev in claim["evidence"]:
                if ev["discounted"]:
                    note = "discounted, does not count"
                    if ev.get("discount_reason"):
                        note += f": {ev['discount_reason']}"
                    print(
                        f"      evidence: {ev['kind']} "
                        f"(level {_level_label(ev['level'])}) — {note}"
                    )
    if result["errors"]:
        print("  errors:")
        for e in result["errors"]:
            print(f"    - {e}")
    print(f"  exit: {result['exit_code']}")


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(
        prog="proof-check",
        description="Check that each claim's evidence meets the level (and kind) the claim requires.",
    )
    parser.add_argument("manifest", help="Path to the claims manifest JSON")
    parser.add_argument("--json", action="store_true", help="Emit one JSON object")
    args = parser.parse_args(argv)

    result = run_check(manifest_arg=args.manifest)

    if args.json:
        print(json.dumps(result))
    else:
        _print_human(result)

    return result["exit_code"]


if __name__ == "__main__":
    sys.exit(main())
