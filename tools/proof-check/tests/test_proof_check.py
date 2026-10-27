"""Tests for proof-check.

Writes real manifest JSON files to temp dirs and runs the tool as
a subprocess, so exit codes and --json output are exercised
exactly as in the field.
"""

import json
import subprocess
import sys
from pathlib import Path

import pytest

TOOL_DIR = Path(__file__).resolve().parents[1]
SCRIPT = TOOL_DIR / "src" / "proof_check.py"
EXAMPLE = TOOL_DIR / "proof-check.example.json"


# ---------------------------------------------------------------- helpers

def write_manifest(tmp_path: Path, data, name="manifest.json") -> Path:
    p = tmp_path / name
    if isinstance(data, str):
        p.write_text(data, encoding="utf-8")
    else:
        p.write_text(json.dumps(data), encoding="utf-8")
    return p


def claim(cid, ctype, evidence, statement="a claim"):
    return {"id": cid, "type": ctype, "statement": statement, "evidence": evidence}


def ev(kind, detail="some evidence", **extra):
    item = {"kind": kind, "detail": detail}
    item.update(extra)
    return item


def run_tool(manifest: Path, use_json=True):
    cmd = [sys.executable, str(SCRIPT), str(manifest)]
    if use_json:
        cmd.append("--json")
    result = subprocess.run(cmd, capture_output=True, text=True)
    data = None
    if use_json and result.stdout.strip():
        try:
            data = json.loads(result.stdout.strip().splitlines()[-1])
        except Exception:
            data = None
    return result, data


def single(tmp_path, ctype, evidence):
    manifest = write_manifest(tmp_path, {"claims": [claim("c1", ctype, evidence)]})
    return run_tool(manifest)


# ------------------------------------------------- supported at exact level

@pytest.mark.parametrize("ctype,kind,level", [
    ("received", "receipt", 1),
    ("exists", "existence", 2),
    ("complete", "content_read", 3),
    ("copied", "delta_compare", 3),
    ("absent", "source_search", 3),
    ("identity", "hard_identifier", 3),
    ("works", "real_session", 4),
    ("fixed", "public_path", 4),
    ("healthy", "endtoend_run", 4),
])
def test_supported_at_exact_level(tmp_path, ctype, kind, level):
    proc, data = single(tmp_path, ctype, [ev(kind)])
    assert data is not None, proc.stdout + proc.stderr
    assert proc.returncode == 0
    assert data["verdict"] == "SUPPORTED"
    assert data["exit_code"] == 0
    got = data["claims"][0]
    assert got["verdict"] == "SUPPORTED"
    assert got["required_level"] == level
    assert got["best_level"] == level


def test_complete_also_supported_by_delta_compare(tmp_path):
    proc, data = single(tmp_path, "complete", [ev("delta_compare")])
    assert proc.returncode == 0
    assert data["claims"][0]["verdict"] == "SUPPORTED"


def test_copied_also_supported_by_content_read(tmp_path):
    proc, data = single(tmp_path, "copied", [ev("content_read")])
    assert proc.returncode == 0
    assert data["claims"][0]["verdict"] == "SUPPORTED"


def test_stronger_evidence_than_required_supports(tmp_path):
    # a level-4 real session more than covers an exists claim
    proc, data = single(tmp_path, "exists", [ev("real_session")])
    assert proc.returncode == 0
    assert data["claims"][0]["verdict"] == "SUPPORTED"
    assert data["claims"][0]["best_level"] == 4


# ------------------------------------------------------- the origin failures

def test_receipt_does_not_prove_complete(tmp_path):
    proc, data = single(tmp_path, "complete", [ev("receipt"), ev("status_report")])
    assert proc.returncode == 1
    got = data["claims"][0]
    assert got["verdict"] == "OVERCLAIMED"
    assert got["best_level"] == 1
    assert got["required_level"] == 3


def test_probe_does_not_prove_works(tmp_path):
    proc, data = single(tmp_path, "works", [ev("probe")])
    assert proc.returncode == 1
    got = data["claims"][0]
    assert got["verdict"] == "OVERCLAIMED"
    assert got["best_level"] == 2
    assert got["required_level"] == 4


def test_progress_does_not_prove_copied(tmp_path):
    proc, data = single(tmp_path, "copied", [ev("progress_output")])
    assert proc.returncode == 1
    got = data["claims"][0]
    assert got["verdict"] == "OVERCLAIMED"
    assert got["best_level"] == 1


def test_agent_report_capped_at_receipt_even_for_works(tmp_path):
    # an agent's say-so is level 1 no matter how strong the claim is
    proc, data = single(tmp_path, "works", [ev("agent_report")])
    assert proc.returncode == 1
    got = data["claims"][0]
    assert got["verdict"] == "OVERCLAIMED"
    assert got["best_level"] == 1
    assert got["best_level_name"] == "receipt"


def test_absent_with_surface_evidence_but_no_source_search_overclaimed(tmp_path):
    proc, data = single(tmp_path, "absent", [ev("search_snippet")])
    assert proc.returncode == 1
    got = data["claims"][0]
    assert got["verdict"] == "OVERCLAIMED"
    assert "source_search" in got["reason"]


def test_absent_kind_rule_beats_level(tmp_path):
    # content_read meets the level (3) but a negative still needs a
    # source search — the kind requirement decides on its own
    proc, data = single(tmp_path, "absent", [ev("content_read")])
    assert proc.returncode == 1
    got = data["claims"][0]
    assert got["verdict"] == "OVERCLAIMED"
    assert got["best_level"] == 3
    assert got["required_level"] == 3
    assert "source_search" in got["reason"]


def test_identity_with_content_read_but_no_hard_identifier_overclaimed(tmp_path):
    proc, data = single(tmp_path, "identity", [ev("content_read")])
    assert proc.returncode == 1
    got = data["claims"][0]
    assert got["verdict"] == "OVERCLAIMED"
    assert got["best_level"] == 3
    assert got["required_level"] == 3
    assert "hard_identifier" in got["reason"]


def test_complete_with_level_but_wrong_kind_overclaimed(tmp_path):
    # output_file_read is level 3, but complete names content_read
    # or delta_compare specifically
    proc, data = single(tmp_path, "complete", [ev("output_file_read")])
    assert proc.returncode == 1
    got = data["claims"][0]
    assert got["verdict"] == "OVERCLAIMED"
    assert got["best_level"] == 3


def test_works_with_content_but_no_endtoend_kind_overclaimed(tmp_path):
    proc, data = single(tmp_path, "healthy", [ev("content_read"), ev("delta_compare")])
    assert proc.returncode == 1
    got = data["claims"][0]
    assert got["verdict"] == "OVERCLAIMED"
    assert got["best_level"] == 3
    assert got["required_level"] == 4


# ------------------------------------------------------------- unsupported

def test_discounted_evidence_ignored_gives_unsupported(tmp_path):
    proc, data = single(tmp_path, "works", [
        ev("real_session", discounted=True, discount_reason="foreign session id"),
    ])
    assert proc.returncode == 1
    got = data["claims"][0]
    assert got["verdict"] == "UNSUPPORTED"
    assert got["best_level"] == 0
    # the discounted item is still reported, marked as not counted
    assert got["evidence"][0]["discounted"] is True
    assert got["evidence"][0]["counted"] is False


def test_discounted_plus_countable_still_counts_the_countable(tmp_path):
    proc, data = single(tmp_path, "received", [
        ev("real_session", discounted=True, discount_reason="untrusted delivery"),
        ev("receipt"),
    ])
    assert proc.returncode == 0
    got = data["claims"][0]
    assert got["verdict"] == "SUPPORTED"
    assert got["best_level"] == 1


def test_no_evidence_unsupported(tmp_path):
    proc, data = single(tmp_path, "exists", [])
    assert proc.returncode == 1
    got = data["claims"][0]
    assert got["verdict"] == "UNSUPPORTED"
    assert got["best_level"] == 0
    assert got["best_level_name"] == "none"


# -------------------------------------------------------------- incomplete

def test_invalid_json_incomplete(tmp_path):
    manifest = write_manifest(tmp_path, "{not valid json")
    proc, data = run_tool(manifest)
    assert proc.returncode == 2
    assert data["verdict"] == "INCOMPLETE"
    assert data["exit_code"] == 2
    assert data["claims"] == []
    assert data["errors"]


def test_empty_claims_incomplete(tmp_path):
    manifest = write_manifest(tmp_path, {"claims": []})
    proc, data = run_tool(manifest)
    assert proc.returncode == 2
    assert data["verdict"] == "INCOMPLETE"
    assert data["claims"] == []


def test_missing_claims_key_incomplete(tmp_path):
    manifest = write_manifest(tmp_path, {"something_else": True})
    proc, data = run_tool(manifest)
    assert proc.returncode == 2
    assert data["verdict"] == "INCOMPLETE"


def test_unknown_claim_type_incomplete(tmp_path):
    manifest = write_manifest(tmp_path, {"claims": [claim("c1", "proven", [ev("receipt")])]})
    proc, data = run_tool(manifest)
    assert proc.returncode == 2
    assert data["verdict"] == "INCOMPLETE"
    assert data["claims"] == []
    assert any("unknown claim type" in e for e in data["errors"])


def test_unknown_evidence_kind_incomplete(tmp_path):
    manifest = write_manifest(tmp_path, {"claims": [claim("c1", "received", [ev("vibes")])]})
    proc, data = run_tool(manifest)
    assert proc.returncode == 2
    assert data["verdict"] == "INCOMPLETE"
    assert data["claims"] == []
    assert any("unknown evidence kind" in e for e in data["errors"])


def test_missing_fields_incomplete(tmp_path):
    # claim missing 'statement'
    bad_claim = {"id": "c1", "type": "received", "evidence": [ev("receipt")]}
    manifest = write_manifest(tmp_path, {"claims": [bad_claim]})
    proc, data = run_tool(manifest)
    assert proc.returncode == 2
    assert data["verdict"] == "INCOMPLETE"

    # evidence missing 'detail'
    bad_ev = {"id": "c2", "type": "received", "statement": "s",
              "evidence": [{"kind": "receipt"}]}
    manifest2 = write_manifest(tmp_path, {"claims": [bad_ev]}, name="m2.json")
    proc2, data2 = run_tool(manifest2)
    assert proc2.returncode == 2
    assert data2["verdict"] == "INCOMPLETE"


def test_missing_manifest_file_incomplete(tmp_path):
    proc, data = run_tool(tmp_path / "does-not-exist.json")
    assert proc.returncode == 2
    assert data["verdict"] == "INCOMPLETE"
    assert data["claims"] == []


# ------------------------------------------------------- output and overall

def test_json_output_shape(tmp_path):
    proc, data = single(tmp_path, "complete", [ev("content_read")])
    assert proc.returncode == 0
    assert data is not None
    for key in ("verdict", "exit_code", "manifest", "claims", "errors"):
        assert key in data
    got = data["claims"][0]
    for key in ("id", "type", "statement", "verdict", "required_level",
                "required_level_name", "best_level", "best_level_name",
                "reason", "evidence"):
        assert key in got
    ev0 = got["evidence"][0]
    for key in ("kind", "level", "level_name", "detail", "discounted", "counted"):
        assert key in ev0
    assert isinstance(data["errors"], list)


def test_mixed_manifest_overall_exit_1(tmp_path):
    manifest = write_manifest(tmp_path, {"claims": [
        claim("good", "received", [ev("receipt")]),
        claim("bad", "works", [ev("probe")]),
        claim("ugly", "exists", []),
    ]})
    proc, data = run_tool(manifest)
    assert proc.returncode == 1
    assert data["exit_code"] == 1
    verdicts = {c["id"]: c["verdict"] for c in data["claims"]}
    assert verdicts == {"good": "SUPPORTED", "bad": "OVERCLAIMED", "ugly": "UNSUPPORTED"}
    # overall verdict is the weakest claim's verdict
    assert data["verdict"] == "UNSUPPORTED"


def test_all_supported_exit_0(tmp_path):
    manifest = write_manifest(tmp_path, {"claims": [
        claim("a", "received", [ev("status_report")]),
        claim("b", "identity", [ev("hard_identifier")]),
        claim("c", "fixed", [ev("public_path")]),
    ]})
    proc, data = run_tool(manifest)
    assert proc.returncode == 0
    assert data["verdict"] == "SUPPORTED"
    assert all(c["verdict"] == "SUPPORTED" for c in data["claims"])


def test_human_output_lines(tmp_path):
    manifest = write_manifest(tmp_path, {"claims": [
        claim("ok-one", "received", [ev("receipt")]),
        claim("weak-one", "works", [ev("probe")]),
    ]})
    proc, data = run_tool(manifest, use_json=False)
    assert proc.returncode == 1
    out = proc.stdout
    assert "proof-check:" in out
    assert "ok-one: SUPPORTED" in out
    assert "weak-one: OVERCLAIMED" in out
    assert "required level 4 (endtoend)" in out
    assert "best evidence level 2 (surface)" in out
    assert "exit: 1" in out


def test_example_manifest_all_weak(tmp_path):
    # the shipped example encodes the six Oct 26-27 incidents in
    # their original weak-evidence form: none may come out SUPPORTED
    proc, data = run_tool(EXAMPLE)
    assert proc.returncode == 1
    assert len(data["claims"]) == 6
    for c in data["claims"]:
        assert c["verdict"] in ("OVERCLAIMED", "UNSUPPORTED"), c
    by_id = {c["id"]: c["verdict"] for c in data["claims"]}
    assert by_id["aflac-employer-verification-complete"] == "OVERCLAIMED"
    assert by_id["sunshine-streaming-works"] == "OVERCLAIMED"
    assert by_id["downloads-trash-copy-complete"] == "OVERCLAIMED"
    assert by_id["hive-entries-filed"] == "UNSUPPORTED"
    assert by_id["sweetser-never-admitted"] == "OVERCLAIMED"
    assert by_id["dp4-display-identity"] == "OVERCLAIMED"
