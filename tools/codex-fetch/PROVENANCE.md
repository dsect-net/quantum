# Provenance — codex-fetch

- **Built:** 2026-10-19, by Cooper, as the Day-4 daily evolution build
  (Evolution chat; Tracker **TRK-0198**). It root-caused, live against a
  byte-exact base64 ground truth, why reassembling `quantum_codex_read`
  pages is not byte-safe (no trailing newline on chunk contents; paging
  offset dialect differs across sessions), and treats the server-reported
  sha256 as an oracle — output is written atomically, only on a verified
  sha256 + byte-count match, with a byte-exact base64 fallback.
- **Originally placed** in a local Fermata clone
  (`projects/tools/dev/codex-fetch/`, branch `worker/cooper/codex-fetch`,
  commits 4a993b1 / e6e3a92) as a ready-to-push project.
- **Moved here 2026-10-19** per Scotty's repo-placement clarification
  (Evolution chat, Oct 19 ~16:18 EDT): *"If it's Quantum related, it needs
  to be in the quantum repo. Only projects unrelated to our server go into
  Fermata."* codex-fetch is a Quantum Codex tool — Quantum-related by
  definition — so its repo home is `dsect-net/quantum`, at
  `tools/codex-fetch/`.
- **Verified at build time:** 17/17 unit tests
  (`python3 -m unittest discover -s tests`); live byte-identical fetches
  of `Skills/codex-bookkeeper/scripts/codex_lint.py` and `SKILL.md` via
  both the paged and base64 transports.
- **Installed working copy:** a byte-identical copy of
  `src/codex_fetch.py` (sha256
  `00e50ac2d427f47162e89901c2fbc8806196d590af724637fbe08d22d81578de`)
  lives in the local `local-codex-bookkeeper` skill at
  `scripts/codex_fetch.py`; that copy stays — this move changes the
  project's repo home, not the installed tool.
- **Related:** the server-side paging bug this tool armours against is
  tracked as dsect-net/hub-api#102.
- The Fermata manifest (`fermata.json`) was not carried over: it is
  Fermata-specific project metadata. Everything else — `README.md`,
  `src/codex_fetch.py`, `tests/test_codex_fetch.py` — is byte-identical
  to the Fermata build.
