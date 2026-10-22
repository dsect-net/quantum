import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))
import skill_audit_diff as diff_mod
import skill_audit_watch as watch_mod


def report(skills):
    return {"skills": skills, "total_dead": sum(s.get("dead", 0) for s in skills)}


def skill(name, refs):
    dead = sum(1 for r in refs if r["status"] == "dead")
    return {"name": name, "root": f"/x/{name}", "files_scanned": 1,
            "references": refs, "dead": dead, "ok": len(refs) - dead}


def ref(value, status="dead", line=10, kind="path", source="SKILL.md", detail=""):
    return {"kind": kind, "value": value, "source_file": f"/skills/s/{source}",
            "line": line, "status": status, "detail": detail}


class DiffTests(unittest.TestCase):
    def test_identical_reports_no_new(self):
        r = report([skill("a", [ref("~/gone.md")])])
        d = diff_mod.diff_reports(r, r)
        self.assertEqual(d["counts"], {"new_dead": 0, "fixed": 0, "still_dead": 1,
                                       "baseline_dead": 1, "current_dead": 1})

    def test_new_dead_detected(self):
        base = report([skill("a", [])])
        cur = report([skill("a", [ref("~/gone.md")])])
        d = diff_mod.diff_reports(base, cur)
        self.assertEqual(d["counts"]["new_dead"], 1)
        self.assertEqual(d["new_dead"][0]["value"], "~/gone.md")

    def test_fixed_detected(self):
        base = report([skill("a", [ref("~/gone.md")])])
        cur = report([skill("a", [ref("~/gone.md", status="ok")])])
        d = diff_mod.diff_reports(base, cur)
        self.assertEqual(d["counts"]["fixed"], 1)
        self.assertEqual(d["counts"]["current_dead"], 0)

    def test_line_shift_is_not_new(self):
        base = report([skill("a", [ref("~/gone.md", line=10)])])
        cur = report([skill("a", [ref("~/gone.md", line=99)])])
        d = diff_mod.diff_reports(base, cur)
        self.assertEqual(d["counts"]["new_dead"], 0)
        self.assertEqual(d["counts"]["still_dead"], 1)

    def test_detail_and_host_prefix_differences_are_not_new(self):
        base = report([skill("a", [ref("~/gone.md", detail="not found: /home/hatch/x")])])
        cur_ref = ref("~/gone.md", detail="not found: /home/scott/x")
        cur_ref["source_file"] = "/home/scott/skills/s/SKILL.md"
        cur = report([skill("a", [cur_ref])])
        d = diff_mod.diff_reports(base, cur)
        self.assertEqual(d["counts"]["new_dead"], 0)

    def test_unverified_and_ok_never_counted(self):
        cur = report([skill("a", [ref("~/maybe.md", status="unverified"),
                                  ref("~/fine.md", status="ok")])])
        d = diff_mod.diff_reports(report([]), cur)
        self.assertEqual(d["counts"]["current_dead"], 0)

    def test_duplicates_collapse_lowest_line_wins(self):
        cur = report([skill("a", [ref("~/gone.md", line=30), ref("~/gone.md", line=5),
                                  ref("~/gone.md", line=12)])])
        idx = diff_mod.dead_index(cur)
        self.assertEqual(len(idx), 1)
        self.assertEqual(list(idx.values())[0]["line"], 5)

    def test_value_change_is_new_plus_fixed(self):
        base = report([skill("a", [ref("~/old.md")])])
        cur = report([skill("a", [ref("~/new.md")])])
        d = diff_mod.diff_reports(base, cur)
        self.assertEqual((d["counts"]["new_dead"], d["counts"]["fixed"]), (1, 1))

    def test_malformed_report_raises(self):
        with self.assertRaises(diff_mod.ReportError):
            diff_mod.diff_reports({"nope": 1}, report([]))
        with self.assertRaises(diff_mod.ReportError):
            diff_mod.load_report("/nonexistent/report.json")

    def test_cli_exit_codes(self):
        with tempfile.TemporaryDirectory() as td:
            b, c = Path(td) / "b.json", Path(td) / "c.json"
            b.write_text(json.dumps(report([skill("a", [])])))
            c.write_text(json.dumps(report([skill("a", [ref("~/gone.md")])])))
            self.assertEqual(diff_mod.main([str(b), str(c)]), 1)
            self.assertEqual(diff_mod.main([str(b), str(b)]), 0)
            c.write_text("{not json")
            self.assertEqual(diff_mod.main([str(b), str(c)]), 2)


FAKE_SCANNER = """#!/usr/bin/env python3
import json, sys
mode = open(sys.argv[-1] if False else __import__('os').environ['FAKE_MODE']).read().strip()
data = json.loads(open(__import__('os').environ['FAKE_REPORT']).read())
print(json.dumps(data))
sys.exit(1 if data.get('total_dead') else 0)
"""

FAILING_SCANNER = "#!/usr/bin/env python3\nimport sys; sys.exit(2)\n"


class WatchTests(unittest.TestCase):
    def _setup(self, td, scanner_body=FAKE_SCANNER):
        td = Path(td)
        scanner = td / "fake_scanner.py"
        scanner.write_text(scanner_body)
        return td / "state", scanner

    def test_first_run_establishes_baseline_no_alert(self):
        import os
        with tempfile.TemporaryDirectory() as td:
            state, scanner = self._setup(td)
            rep = Path(td) / "rep.json"
            rep.write_text(json.dumps(report([skill("a", [ref("~/gone.md")])])))
            os.environ["FAKE_MODE"] = str(Path(td) / "mode")
            os.environ["FAKE_REPORT"] = str(rep)
            Path(os.environ["FAKE_MODE"]).write_text("x")
            code, msg = watch_mod.watch(state, scanner, [], False)
            self.assertEqual(code, 0)
            self.assertIn("Baseline established", msg)
            self.assertTrue((state / "baseline.json").exists())

    def test_second_run_alerts_once_then_quiet(self):
        import os
        with tempfile.TemporaryDirectory() as td:
            state, scanner = self._setup(td)
            os.environ["FAKE_MODE"] = str(Path(td) / "mode")
            Path(os.environ["FAKE_MODE"]).write_text("x")
            rep = Path(td) / "rep.json"
            os.environ["FAKE_REPORT"] = str(rep)
            rep.write_text(json.dumps(report([skill("a", [])])))
            self.assertEqual(watch_mod.watch(state, scanner, [], False)[0], 0)
            rep.write_text(json.dumps(report([skill("a", [ref("~/gone.md")])])))
            code, msg = watch_mod.watch(state, scanner, [], False)
            self.assertEqual(code, 1)
            self.assertIn("NEW", msg)
            # baseline advanced: same report again -> quiet
            code2, msg2 = watch_mod.watch(state, scanner, [], False)
            self.assertEqual(code2, 0)
            self.assertIn("No new dead", msg2)

    def test_scanner_failure_exit2_baseline_untouched(self):
        with tempfile.TemporaryDirectory() as td:
            state, scanner = self._setup(td, FAILING_SCANNER)
            state.mkdir(parents=True)
            sentinel = state / "baseline.json"
            sentinel.write_text(json.dumps(report([])))
            with self.assertRaises(diff_mod.ReportError):
                watch_mod.watch(state, scanner, [], False)
            self.assertEqual(sentinel.read_text(), json.dumps(report([])))

    def test_missing_scanner_is_exit2(self):
        with tempfile.TemporaryDirectory() as td:
            rc = watch_mod.main(["--state-dir", str(Path(td) / "s"),
                                 "--scanner", str(Path(td) / "nope.py")])
            self.assertEqual(rc, 2)


if __name__ == "__main__":
    unittest.main()
