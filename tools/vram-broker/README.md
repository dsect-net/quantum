# vram-broker — smart VRAM broker for the RTX 2060 SUPER

**Tracker:** TRK-0478 · **Host:** Tritium · **Status:** live-tested 2026-10-27

The 2060 SUPER has 8 GB and too many tenants: Jan (Breeze's voice LLM,
~3.0 GB), Ollama models (Quark's llama3.2:3b, ~3.0 GB), ComfyUI image/video
jobs (~4 GB peak), and the desktop. Twice on 2026-10-27 a queued job met a
full card: Breeze renders died with Vulkan OOM (TRK-0465), and a ComfyUI
2511 run OOM'd and segfaulted at ~6.4 GB resident (TRK-0477).

The broker fixes the collision without touching the queue:

1. It polls the ComfyUI queue (:8188) and `nvidia-smi` every 2 s.
2. When a job is queued and free VRAM is below `job_headroom_mib`
   (default 4096 MiB — measured job peaks are 3.8–4.0 GB), it snapshots
   the resident set and evicts the **minimum necessary**:
   - Ollama models first, largest-first, via the Ollama API
     (`keep_alive: 0`). They auto-reload on next request if needed.
   - Then ComfyUI's torch cache via `/free` (never while a job runs).
   - Then ComfyUI's stale loaded models via `/free unload_models`
     (only pre-job, nothing running — the pending job loads its own).
   - Ollama models **referenced by the queued job's graph** are
     job-owned and never evicted. Nothing is ever killed; no job is
     blocked, cancelled or reordered. If nothing evictable remains, the
     broker logs `evict_insufficient` and the job proceeds at risk.
3. When the queue has been **continuously empty** for `settle_window_s`
   (default 20 s) — whether the jobs succeeded or errored — it restores
   the snapshot: Jan first (if ever evicted), then each Ollama model is
   re-warmed with `restore_keep_alive` (default 30 m). A burst of jobs
   therefore causes one eviction and one restore, not thrash.
4. Every transition is persisted to a state file. If the broker dies
   mid-holding, the next start recovers and restores once the queue is
   empty. `vram-broker restore` does the same manually.

## Protected tenants (never evicted in v1)

- Desktop: Sunshine, GNOME remote desktop, gnome-shell, Xorg/Xwayland.
- The ComfyUI process itself (managed only through its `/free` API).
- **Jan** (`llama-jan4b.service`, Breeze's voice LLM): last resort only.
  Eviction code exists (systemd stop/start, restored first) but is
  disabled by `allow_jan_eviction: false` — **whether Jan may ever be
  evicted is the owner's open call** (TRK-0478). With it disabled, a
  shortfall is logged instead.

## Files

| Path | What |
|---|---|
| `~/vram-broker/vram_broker.py` | running copy (deployed from this repo folder) |
| `~/.cooper/vram-broker/config.json` | live config (from `config.example.json`) |
| `~/.cooper/vram-broker/events.jsonl` | structured decision log |
| `~/.cooper/vram-broker/status.json` | live status snapshot (rewritten each poll) |
| `~/.cooper/vram-broker/state.json` | outstanding evictions (crash recovery) |
| `/etc/systemd/system/vram-broker.service` | system unit, runs as scott |
| `~/.local/bin/vram-broker` | status wrapper |

## Commands

```sh
vram-broker status            # one-command readout
journalctl -u vram-broker -f  # service log (events also in events.jsonl)
tail -f ~/.cooper/vram-broker/events.jsonl
python3 ~/vram-broker/vram_broker.py restore   # manual recovery
```

## Policy defaults (all in config.json)

| Key | Default | Meaning |
|---|---|---|
| `job_headroom_mib` | 4096 | free VRAM required before a job runs |
| `max_coresident_mib` | 3584 | measured safe non-job resident envelope |
| `settle_window_s` | 20 | queue-empty time before restore |
| `poll_interval_s` | 2.0 | watch cadence |
| `evict_cooldown_s` | 5 | min gap between eviction passes |
| `restore_keep_alive` | `30m` | keep_alive for re-warmed Ollama models |
| `min_ollama_evict_mib` | 128 | ignore smaller Ollama models |
| `comfy_free_on_restore` | `true` | free ComfyUI's stale models before re-warming, so restored models land fully on the GPU |
| `allow_jan_eviction` | `false` | owner's call — see above |

## Extending

Other job sources (e.g. the ROCm ComfyUI on :8288) can be added by
generalising the queue probe into a list; the eviction/restore core is
source-agnostic. Reaction latency is one poll (~2 s) after a job appears;
eviction completes before the sampler's peak allocations for the current
model sizes (loads take 10 s+). A future Nebula-side pre-flight hook
could remove even that window.

## Live test (2026-10-27, summary)

Round 1 (full driver, 4 phases): with llama3.2:3b resident (free VRAM
1761 MiB), a Qwen-Image 2.1 job was queued — the broker evicted the 3B
(free 1761 → 4309 MiB), the job succeeded in 39.3 s (peak 6897 MiB, no
OOM), and after the 20 s settle the 3B was re-warmed (11.6 s) and
verified resident. A deliberately broken job (wrong VAE → execution
error) triggered the same evict → drain → restore chain (failure-proof
restore proven). A control job with nothing evicted caused no restore.
Jan was never touched.

Three refinements came out of round 1 and are implemented above:

1. **Shortfall is judged on co-residents, not raw free.** Once a job
   starts loading, free VRAM falls because the job is consuming it;
   warning on raw free cried wolf in every phase. The warning now
   requires co-resident (non-ComfyUI) VRAM above `max_coresident_mib`.
2. **Restore frees ComfyUI's stale models first.** A rewarm issued
   while ComfyUI still held ~2.9 GB of per-job cache landed the 3B
   partially on CPU (701 MiB of 2436 MiB in VRAM). With
   `comfy_free_on_restore`, the restore frees that cache first and the
   model returns fully on-GPU.
3. **Job outcomes are read from `status_str`.** ComfyUI 0.43 leaves
   `status.completed=false` for errored jobs; the broker polls briefly
   and trusts `status_str`, falling back to `unknown` — never guessing.

Round 2 (focused re-test) verified all three: clean cycle, no spurious
`evict_insufficient`, correct `success` status in the log, and the 3B
restored at full GPU placement. Full numbers in TRK-0478 and the PR.
