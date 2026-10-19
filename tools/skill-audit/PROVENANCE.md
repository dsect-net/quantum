# Provenance — skill-audit

- **Built:** 2026-10-17, by Cooper, as the Day-2 daily evolution build
  (Evolution chat). A stdlib-only Python scanner that finds dead
  references in agent skill files (`SKILL.md` trees): absolute/`~/`
  paths, skill-folder refs, markdown links, and GitHub repos — with
  host-aware classification (`ok` / `dead` / `unverified` / `skipped`)
  so skills written for another machine don't cry wolf.
- **Originally placed** in Fermata as draft PR
  [ScottyVenable/fermata#10](https://github.com/ScottyVenable/fermata/pull/10)
  (via the cooper-the-fox fork, commit `45684c2`, project path
  `projects/tools/dev/skill-audit/`).
- **Moved here 2026-10-19** per Scotty's repo-placement clarification
  (Evolution chat, Oct 19 ~16:18 EDT): *"If it's Quantum related, it
  needs to be in the quantum repo. Only projects unrelated to our server
  go into Fermata."* skill-audit exists solely to audit the fleet's own
  SKILL.md trees — Quantum/Cooper infrastructure by purpose — so its
  repo home is `dsect-net/quantum`, at `tools/skill-audit/`, beside
  `tools/codex-fetch/` (moved the same day, PR #83). The Fermata draft
  PR #10 is stranded on the suspended cooper-the-fox fork; this repo is
  now the canonical home and the Fermata draft is superseded.
- **Verified at build time:** 11/11 unit tests
  (`python3 -m unittest discover -s tests`). First real run
  (2026-10-17) over 33 custom skills: 7 distinct GitHub repos
  referenced, all resolve; 3 path findings, including genuine rot —
  `local-codex-bookkeeper` referencing a missing
  `scripts/codex_lint.py` (restored by the Day-3 evolution build,
  TRK-0182).
- **Carried over:** `src/skill_audit.py` (sha256
  `19c875cefa774939b2b5b28cea3804f718fdfcd3b70b8e73a0574be5bc442702`)
  and `tests/test_skill_audit.py` (sha256
  `57d84d80623a1cc0a2e93092f8eaa13199bd0ab53711eddd06e885b61941a057`)
  are byte-identical to the Fermata build. `README.md` is carried over
  with one line changed: the license line no longer reads "per the
  Fermata repo."
- The Fermata manifest (`fermata.json`) was not carried over: it is
  Fermata-specific project metadata.
