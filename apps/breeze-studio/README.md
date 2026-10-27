# Breeze Studio

A small demo / workflow UI for the Quantum MCP media tools: **Breeze** text-to-speech
and **Nebula** (ComfyUI) media generation. It drives the real hub tools end-to-end —
pick a voice, type text, add an optional direction, render, and play the MP3 in the
browser; or pick a Nebula workflow, set a prompt, and see the generated image inline.

Built Oct 19, 2026 (Tracker TRK-0211; MCP tools landed in hub-api PR #104 / TRK-0210).
This folder became its canonical home Oct 19, 2026 (TRK-0212).

## What it does

- **Breeze panel** — voice dropdown (live from `quantum_breeze_list_voices`), text area
  with character count, optional direction/instruction field with presets, sample
  texts, Generate → poll `quantum_breeze_status` with chunk progress → play/download
  the MP3 from `quantum_breeze_result`. Keeps a session history of generated clips.
- **Nebula panel** — workflow dropdown (live from `quantum_nebula_list_workflows`),
  backend select (nvidia/amd), prompt wired to each workflow's positive-prompt node
  (resolved via `quantum_nebula_workflow_params`), Generate → poll
  `quantum_nebula_status` → image outputs served inline, other outputs as downloads.

Generation is asynchronous by design: Breeze renders take seconds-to-minutes, so the
page polls job status rather than blocking.

## New Voice creation (added Oct 27, 2026)

The **New Voice** card designs a voice from a plain-language description and freezes
it into a saved profile:

1. `quantum_breeze_design_voice` renders one sample passage with breeze-cli's
   `--instruction` alone (no existing profile). The raw WAV is kept as the job's
   `design.wav` plus a `design.json` (instruction + sample text) so the design
   survives a hub restart.
2. `quantum_breeze_save_voice` freezes it in clone mode (`--ref-audio design.wav
   --ref-text <the exact sample text> --save-voice <name>`), writing
   `<voices dir>/<name>.breeze` plus a provenance sidecar in
   `<voices dir>/.provenance/<name>.json`.

Registration *is* the voices directory: `quantum_breeze_list_voices` lists the
`*.breeze` files live, so a saved voice appears in this page's picker, the hub
catalogue, and (via the sidecar list) Home Assistant's `tts.breeze` options with
no further wiring. Names are lowercase slugs; existing profiles are never
overwritten.

### Gating — read before touching

Creation burns GPU and writes permanent profiles, so it is **not** available to
the breeze-demo key above (the hub refuses it: its allowlist has no design/save
tools). Two extra secrets, both only on Tritium, neither ever in this repo:

- **`/home/scott/.cooper/breeze-creator/mcp-key`** (600, dir 700) — a second gateway
  key, label `breeze-creator` (id `mk_ac1333393dbf8faa1486e41d`, developer, tailnet,
  expires 2027-01-25), allowlisted to exactly `quantum_breeze_design_voice`,
  `quantum_breeze_save_voice`, `quantum_breeze_status`, `quantum_breeze_result`,
  `quantum_breeze_list_voices`. The server holds it in a second MCP client
  (`BREEZE_CREATOR_KEY_FILE`).
- **`/home/scott/.cooper/breeze-creator/ui-token`** (600) — the creator token the
  human types into the New Voice form; the server compares it per request
  (`BREEZE_CREATOR_TOKEN_FILE`). Rotate by replacing the file's contents; no
  restart needed. If the file is absent, the create endpoints return 503 and the
  form reports itself locked.

## How it runs

- Single-file Python (stdlib only): `breeze_server.py`. No build step, no dependencies.
- Host: Tritium, as systemd **user** service `breeze-demo.service`
  (WorkingDirectory `/home/scott/breeze-demo`, listens on `127.0.0.1:7656`).
- Exposed tailnet-only via Tailscale Serve:
  **https://tritium-linux.fairy-chinstrap.ts.net:8446/** → `127.0.0.1:7656`.
  Never Funnel.
- Also linked from Home Assistant as the "Breeze Studio" sidebar panel
  (`/config/dashboards/breeze-studio.yaml`, an iframe of the URL above).
- Design: modern corporate minimalist — light surfaces, soft borders, black primary
  buttons, brand violet sparingly; phone-responsive.

## MCP authentication — read this before touching the server

The page's backend talks to the hub gateway (Tritium-local `127.0.0.1:8091/mcp`) with a
dedicated worker key. The key **value** is never in this repo, in git history, or in any
doc. It lives only at:

- **`/home/scott/.cooper/breeze-demo/mcp-key`** on Tritium (file mode 600, dir 700)

Key facts (from the hub key store, `lib/mcp-gateway-keys.js`):

- Label: `breeze-demo` · Key id: `mk_89ee2275be1ea3c4ed19ad24`
- Role: developer, audience: tailnet
- Allowlist: exactly the 8 media tools (`quantum_breeze_list_voices`,
  `quantum_breeze_generate`, `quantum_breeze_status`, `quantum_breeze_result`,
  `quantum_nebula_list_workflows`, `quantum_nebula_workflow_params`,
  `quantum_nebula_generate`, `quantum_nebula_status`) — it can do nothing else
- Minted: Oct 19, 2026 via the hub's `mintKey()` · Expires: 2027-01-18 (90-day cap)
- Revoke: `revokeKey('mk_89ee2275be1ea3c4ed19ad24')` from `lib/mcp-gateway-keys.js`
  (takes effect on the next gateway request; the page then falls back to its
  "not provisioned" state)

Note: Breeze job handles are in-memory in the hub — a hub restart clears status/result
lookups for in-flight jobs (rendered MP3s persist under `/mnt/fast/breeze-mcp/<job_id>/`).
The page handles that case with a plain "generate again" message.

## Redeploy

```sh
# on Tritium, from a checkout of this repo:
cp apps/breeze-studio/breeze_server.py /home/scott/breeze-demo/breeze_server.py
cp apps/breeze-studio/breeze-demo.service ~/.config/systemd/user/breeze-demo.service  # only if the unit changed
systemctl --user daemon-reload   # only if the unit changed
systemctl --user restart breeze-demo.service
curl -s https://tritium-linux.fairy-chinstrap.ts.net:8446/healthz
curl -s https://tritium-linux.fairy-chinstrap.ts.net:8446/api/voices   # expect 8 profiles
```

(Verify the unit's installed location on the host before copying — check
`systemctl --user cat breeze-demo.service`.)

## Files

- `breeze_server.py` — the whole app (server, page, API routes)
- `breeze-demo.service` — systemd user unit
- `screenshots/` — desktop + phone captures of the live page
