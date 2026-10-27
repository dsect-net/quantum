#!/usr/bin/env python3
"""vram-broker: smart VRAM broker for Tritium's RTX 2060 SUPER (8 GB).

Watches the ComfyUI queue (:8188) and nvidia-smi. When a GPU job is queued
and free VRAM is below the job's headroom requirement, the broker snapshots
the resident set, evicts the minimum necessary (Ollama models first via the
Ollama API; ComfyUI's own stale cache/models via /free), and restores the
snapshot once the queue has drained for a settle window. Restore is
failure-proof: it happens whether jobs succeeded or errored, and a state
file lets a restarted broker recover outstanding evictions.

Design notes (TRK-0478):
- The broker PREPARES the card; it never blocks, cancels or reorders jobs.
- Protected tenants are never evicted: the desktop (Sunshine/GNOME), the
  ComfyUI process itself, and llama-jan (Breeze's voice LLM). Jan eviction
  exists only behind `allow_jan_eviction` (default false) -- that policy
  call belongs to the owner.
- Ollama models referenced by a queued job's graph are treated as
  job-owned and are never evicted.
- Stdlib only. Python 3.11+.

Subcommands: run | status | restore
"""

from __future__ import annotations

import argparse
import json
import os
import signal
import subprocess
import sys
import time
import urllib.request
import urllib.error
from datetime import datetime, timezone
from pathlib import Path

DEFAULT_CONFIG = {
    "comfyui_url": "http://127.0.0.1:8188",
    "ollama_url": "http://127.0.0.1:11434",
    "poll_interval_s": 2.0,
    # A ComfyUI image job peaks ~3.8-4.0 GB on top of residents (measured
    # 2026-10-27, TRK-0477). Require this much free VRAM before a job runs.
    "job_headroom_mib": 4096,
    # Measured safe envelope for non-job residents during a run (MiB).
    "max_coresident_mib": 3584,
    # Queue must be continuously empty this long before restore fires.
    "settle_window_s": 20,
    # Minimum gap between eviction passes (unloads take time to reflect).
    "evict_cooldown_s": 5,
    # keep_alive applied when re-warming evicted Ollama models.
    "restore_keep_alive": "30m",
    # Jan (llama-jan4b.service, Breeze's voice LLM) is LAST RESORT only.
    # Default false: the broker logs a shortfall instead of touching Jan.
    "allow_jan_eviction": False,
    "jan_unit": "llama-jan4b.service",
    "jan_cmdline_patterns": ["Jan-v3.5", "--port 8101"],
    "protected_cmdline_patterns": [
        "Jan-v3.5", "--port 8101", "sunshine", "gnome-remote-desktop",
        "gnome-shell", "Xorg", "Xwayland", "ComfyUI", "vram_broker",
    ],
    # Reclaim ComfyUI's torch cache before considering model unloads.
    "comfy_reclaim_cache": True,
    # At restore time (queue drained), unload ComfyUI's stale models
    # before re-warming Ollama, so restored models land fully on the GPU
    # instead of being partially offloaded to CPU under cache pressure.
    "comfy_free_on_restore": True,
    # Ignore tiny Ollama models when deciding what to evict (MiB in VRAM).
    "min_ollama_evict_mib": 128,
    "state_dir": "/home/scott/.cooper/vram-broker",
    "http_timeout_s": 10,
    "unload_timeout_s": 45,
}

MIB = 1048576


def now_iso() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")


class Broker:
    def __init__(self, cfg: dict):
        self.cfg = cfg
        self.state_dir = Path(cfg["state_dir"])
        self.state_dir.mkdir(parents=True, exist_ok=True)
        self.state_file = self.state_dir / "state.json"
        self.status_file = self.state_dir / "status.json"
        self.log_file = self.state_dir / "events.jsonl"
        self.debug = bool(os.environ.get("VRAM_BROKER_DEBUG"))
        self.stop_requested = False

        # Persistent state (survives broker restarts).
        self.state = self._load_state()
        # Volatile runtime state.
        self.mode = "idle"  # idle | holding | settling | restoring
        self.empty_since: float | None = None
        self.last_evict_pass = 0.0
        self.snapshot_logged = False  # one snapshot log per job batch
        self.seen_jobs: dict[str, str] = {}  # prompt_id -> first seen state
        self.shortfall_warned_for: set[str] = set()

    # ---------- persistence ----------
    def _load_state(self) -> dict:
        try:
            with open(self.state_file) as f:
                s = json.load(f)
            if isinstance(s, dict) and "outstanding" in s:
                return s
        except Exception:
            pass
        return {"outstanding": [], "jan_evicted": False, "batch_jobs": []}

    def _save_state(self) -> None:
        tmp = self.state_file.with_suffix(".tmp")
        with open(tmp, "w") as f:
            json.dump(self.state, f, indent=1)
        tmp.replace(self.state_file)

    # ---------- logging ----------
    def log(self, event: str, **fields) -> None:
        rec = {"ts": now_iso(), "event": event, **fields}
        line = json.dumps(rec)
        try:
            with open(self.log_file, "a") as f:
                f.write(line + "\n")
        except Exception:
            pass
        if self.debug:
            print(line, flush=True)

    # ---------- HTTP helpers ----------
    def _http_json(self, method: str, url: str, payload: dict | None = None,
                   timeout: float | None = None):
        data = None
        headers = {}
        if payload is not None:
            data = json.dumps(payload).encode()
            headers["Content-Type"] = "application/json"
        req = urllib.request.Request(url, data=data, headers=headers,
                                     method=method)
        with urllib.request.urlopen(
                req, timeout=timeout or self.cfg["http_timeout_s"]) as r:
            body = r.read()
            return json.loads(body) if body else {}

    # ---------- probes ----------
    def gpu(self) -> dict:
        out = subprocess.run(
            ["nvidia-smi", "--query-gpu=memory.total,memory.used,memory.free",
             "--format=csv,noheader,nounits"],
            capture_output=True, text=True, timeout=10).stdout.strip()
        total, used, free = (int(x) for x in out.split(","))
        return {"total_mib": total, "used_mib": used, "free_mib": free}

    def gpu_processes(self) -> list[dict]:
        out = subprocess.run(
            ["nvidia-smi", "--query-compute-apps=pid,used_memory",
             "--format=csv,noheader,nounits"],
            capture_output=True, text=True, timeout=10).stdout.strip()
        procs = []
        for line in out.splitlines():
            if not line.strip():
                continue
            pid_s, mem_s = line.split(",")
            pid = int(pid_s)
            cmdline = ""
            try:
                cmdline = Path(f"/proc/{pid}/cmdline").read_bytes() \
                    .replace(b"\0", b" ").decode(errors="replace").strip()
            except Exception:
                pass
            procs.append({"pid": pid, "mib": int(mem_s),
                          "cmdline": cmdline,
                          "class": self._classify(cmdline)})
        return procs

    def _classify(self, cmdline: str) -> str:
        jan_pats = self.cfg["jan_cmdline_patterns"]
        if any(p in cmdline for p in jan_pats):
            return "jan"
        if "ComfyUI" in cmdline or "comfyui" in cmdline.lower():
            return "comfyui"
        low = cmdline.lower()
        if "ollama" in low:
            return "ollama"
        if any(p in cmdline for p in self.cfg["protected_cmdline_patterns"]):
            return "protected"
        if "llama-server" in cmdline:
            return "llama-server"  # not Jan; v1 never evicts (no safe API)
        return "unknown"

    def comfy_queue(self) -> dict:
        q = self._http_json("GET", self.cfg["comfyui_url"] + "/queue")
        running, pending = [], []
        graphs = []
        for item in q.get("queue_running", []):
            running.append(str(item[1]))
            if len(item) > 2 and isinstance(item[2], dict):
                graphs.append(item[2])
        for item in q.get("queue_pending", []):
            pending.append(str(item[1]))
            if len(item) > 2 and isinstance(item[2], dict):
                graphs.append(item[2])
        return {"running": running, "pending": pending, "graphs": graphs}

    def comfy_history_status(self, prompt_id: str) -> str | None:
        """Final status of a finished job. ComfyUI 0.43 leaves
        status.completed=false for ERRORED jobs while still setting
        status_str, and the entry can lag the queue by a moment — so
        poll briefly and trust status_str over the completed flag."""
        deadline = time.time() + 10
        while True:
            try:
                h = self._http_json(
                    "GET", f"{self.cfg['comfyui_url']}/history/{prompt_id}")
                entry = h.get(prompt_id)
                if entry:
                    st = entry.get("status", {})
                    if st.get("status_str"):
                        return st["status_str"]
                    if st.get("completed"):
                        return "success"
            except Exception:
                pass
            if time.time() >= deadline:
                return None
            time.sleep(1)

    def ollama_resident(self) -> list[dict]:
        try:
            ps = self._http_json("GET", self.cfg["ollama_url"] + "/api/ps")
        except Exception:
            return []
        models = []
        for m in ps.get("models", []):
            models.append({
                "name": m.get("name", ""),
                "vram_mib": int(m.get("size_vram", 0) // MIB),
            })
        return models

    # ---------- actions ----------
    def ollama_evict(self, name: str) -> bool:
        try:
            self._http_json("POST", self.cfg["ollama_url"] + "/api/generate",
                            {"model": name, "keep_alive": 0}, timeout=30)
        except Exception as e:
            self.log("evict_ollama_failed", model=name, error=str(e))
            return False
        deadline = time.time() + self.cfg["unload_timeout_s"]
        while time.time() < deadline:
            if name not in [m["name"] for m in self.ollama_resident()]:
                return True
            time.sleep(0.5)
        return name not in [m["name"] for m in self.ollama_resident()]

    def ollama_rewarm(self, name: str) -> tuple[bool, float, str]:
        """Load a model back into Ollama. Returns (ok, seconds, method)."""
        t0 = time.time()
        ka = self.cfg["restore_keep_alive"]
        try:
            self._http_json("POST", self.cfg["ollama_url"] + "/api/generate",
                            {"model": name, "keep_alive": ka,
                             "stream": False}, timeout=180)
            return True, time.time() - t0, "generate"
        except Exception:
            pass
        try:  # embedding-only models cannot generate; load via /api/embed
            self._http_json("POST", self.cfg["ollama_url"] + "/api/embed",
                            {"model": name, "input": " ", "keep_alive": ka},
                            timeout=180)
            return True, time.time() - t0, "embed"
        except Exception as e:
            return False, time.time() - t0, f"failed: {e}"

    def comfy_free(self, unload_models: bool) -> bool:
        try:
            self._http_json("POST", self.cfg["comfyui_url"] + "/free",
                            {"unload_models": unload_models,
                             "free_memory": True}, timeout=30)
            return True
        except Exception as e:
            self.log("comfy_free_failed", unload_models=unload_models,
                     error=str(e))
            return False

    def jan_set(self, start: bool) -> bool:
        """Only reachable when allow_jan_eviction is true (owner's call)."""
        verb = "start" if start else "stop"
        try:
            r = subprocess.run(["sudo", "-n", "systemctl", verb,
                                self.cfg["jan_unit"]],
                               capture_output=True, text=True, timeout=60)
            return r.returncode == 0
        except Exception:
            return False

    # ---------- decision engine ----------
    @staticmethod
    def _graph_strings(node, acc: set):
        if isinstance(node, dict):
            for v in node.values():
                Broker._graph_strings(v, acc)
        elif isinstance(node, list):
            for v in node:
                Broker._graph_strings(v, acc)
        elif isinstance(node, str):
            acc.add(node)

    def job_owned_models(self, graphs: list[dict]) -> set[str]:
        """Ollama model names referenced by queued job graphs are job-owned."""
        strings: set[str] = set()
        for g in graphs:
            self._graph_strings(g, strings)
        return {m["name"] for m in self.ollama_resident()
                if m["name"] in strings}

    def eviction_pass(self, queue: dict, gpu: dict) -> None:
        """Evict the minimum necessary so free VRAM >= job_headroom_mib."""
        self.last_evict_pass = time.time()
        headroom = self.cfg["job_headroom_mib"]
        owned = self.job_owned_models(queue["graphs"])
        if owned:
            self.log("job_owned_models", models=sorted(owned))
        evicted_now = []

        # 1) Ollama models first: freely evictable, auto-reload on demand.
        resident = [m for m in self.ollama_resident()
                    if m["name"] not in owned
                    and m["vram_mib"] >= self.cfg["min_ollama_evict_mib"]]
        resident.sort(key=lambda m: -m["vram_mib"])  # largest first
        for m in resident:
            if self.gpu()["free_mib"] >= headroom:
                break
            if self.ollama_evict(m["name"]):
                self.state["outstanding"].append(
                    {"kind": "ollama", "name": m["name"],
                     "vram_mib": m["vram_mib"], "at": now_iso()})
                evicted_now.append(m["name"])
                self._save_state()
                self.log("evict_ollama", model=m["name"],
                         vram_mib=m["vram_mib"],
                         free_mib_after=self.gpu()["free_mib"])
            time.sleep(0.3)

        # 2) ComfyUI torch-cache reclaim (harmless; never while running).
        if (self.gpu()["free_mib"] < headroom
                and self.cfg["comfy_reclaim_cache"]
                and not queue["running"]):
            if self.comfy_free(unload_models=False):
                self.log("comfy_free", unload_models=False,
                         free_mib_after=self.gpu()["free_mib"])

        # 3) ComfyUI stale-model unload (only pre-job, nothing running):
        #    the pending job loads what it needs; prior workflows' models
        #    are stale by definition.
        if self.gpu()["free_mib"] < headroom and not queue["running"]:
            if self.comfy_free(unload_models=True):
                # Not added to `outstanding`: ComfyUI reloads per-job.
                self.log("comfy_free", unload_models=True,
                         free_mib_after=self.gpu()["free_mib"])

        # Sufficiency is judged on the NON-JOB resident set, not raw free:
        # once a job starts loading, free VRAM drops because the job
        # itself is consuming it (that is the allocation working, not
        # contention). The measured risk condition is co-residents above
        # the envelope (TRK-0477). Raw-free checks cried wolf in testing.
        procs_now = self.gpu_processes()
        comfy_mib_now = sum(p["mib"] for p in procs_now
                            if p["class"] == "comfyui")
        gpu_now = self.gpu()
        coresident_now = max(0, gpu_now["used_mib"] - comfy_mib_now)
        free_now = gpu_now["free_mib"]
        shortfall = (free_now < headroom
                     and coresident_now > self.cfg["max_coresident_mib"])
        if shortfall:
            batch = ",".join(sorted(set(queue["running"] + queue["pending"])))
            if self.cfg["allow_jan_eviction"] and not self.state.get(
                    "jan_evicted"):
                # LAST RESORT, owner-enabled only: stop Jan, restore FIRST.
                if self.jan_set(start=False):
                    self.state["jan_evicted"] = True
                    self._save_state()
                    self.log("evict_jan", unit=self.cfg["jan_unit"],
                             free_mib_after=self.gpu()["free_mib"])
                    free_now = self.gpu()["free_mib"]
                    procs_now = self.gpu_processes()
                    comfy_mib_now = sum(p["mib"] for p in procs_now
                                        if p["class"] == "comfyui")
                    coresident_now = max(
                        0, self.gpu()["used_mib"] - comfy_mib_now)
                    shortfall = (
                        free_now < headroom and coresident_now
                        > self.cfg["max_coresident_mib"])
            if shortfall and batch not in self.shortfall_warned_for:
                self.shortfall_warned_for.add(batch)
                self.log("evict_insufficient", level="warn",
                         free_mib=free_now, headroom_mib=headroom,
                         coresident_mib=coresident_now,
                         max_coresident_mib=self.cfg["max_coresident_mib"],
                         note="no evictable residents left; job proceeds "
                              "at risk (broker never blocks the queue)")
        if evicted_now:
            self.mode = "holding"

    def restore_pass(self, reason: str) -> None:
        """Re-warm everything we evicted. Failure-proof: always attempted
        when the queue has drained, whatever the jobs' outcomes were."""
        outstanding = list(self.state.get("outstanding", []))
        jan = bool(self.state.get("jan_evicted"))
        if not outstanding and not jan:
            return
        self.mode = "restoring"
        self.log("restore_start", reason=reason,
                 models=[o["name"] for o in outstanding], jan=jan)
        # Jan back FIRST and fast if it was ever evicted.
        if jan:
            ok = self.jan_set(start=True)
            self.log("restore_jan", ok=ok, unit=self.cfg["jan_unit"])
            if ok:
                self.state["jan_evicted"] = False
                self._save_state()
        # Free ComfyUI's stale per-job models before re-warming, so the
        # restored Ollama models get full GPU placement (a rewarm under
        # cache pressure lands partially on CPU — observed in testing).
        # Safe here: restore only runs on a drained queue, and ComfyUI
        # reloads models per job anyway.
        if outstanding and self.cfg.get("comfy_free_on_restore"):
            if self.comfy_free(unload_models=True):
                self.log("comfy_free", unload_models=True, phase="restore",
                         free_mib_after=self.gpu()["free_mib"])
                time.sleep(1)
        remaining = []
        for entry in outstanding:
            # A new job may have arrived mid-restore: stop re-warming and
            # keep the rest outstanding for the next drain.
            try:
                q = self.comfy_queue()
                if q["running"] or q["pending"]:
                    self.log("restore_interrupted_by_job",
                             remaining=[e["name"] for e in outstanding
                                        if e not in remaining])
                    remaining.extend(
                        [e for e in outstanding[outstanding.index(entry):]])
                    break
            except Exception:
                pass
            ok, secs, method = self.ollama_rewarm(entry["name"])
            self.log("restore_model", model=entry["name"], ok=ok,
                     seconds=round(secs, 1), method=method)
            if not ok:
                remaining.append(entry)
        self.state["outstanding"] = remaining
        self.state["batch_jobs"] = []
        self._save_state()
        resident = [m["name"] for m in self.ollama_resident()]
        self.log("restore_done", resident=resident,
                 still_outstanding=[e["name"] for e in remaining])
        self.mode = "idle"

    # ---------- main loop ----------
    def tick(self) -> None:
        gpu = self.gpu()
        procs = self.gpu_processes()
        try:
            queue = self.comfy_queue()
        except Exception as e:
            self.log("comfy_queue_error", error=str(e))
            queue = {"running": [], "pending": [], "graphs": []}
        comfy_mib = sum(p["mib"] for p in procs if p["class"] == "comfyui")
        coresident = max(0, gpu["used_mib"] - comfy_mib)
        jobs_present = bool(queue["running"] or queue["pending"])

        # Track job lifecycle for the log (outcomes via /history).
        current = set(queue["running"] + queue["pending"])
        for pid_ in current:
            if pid_ not in self.seen_jobs:
                self.seen_jobs[pid_] = "running" if pid_ in queue["running"] \
                    else "pending"
                if pid_ not in self.state["batch_jobs"]:
                    self.state["batch_jobs"].append(pid_)
                    self._save_state()
                self.log("job_seen", prompt_id=pid_,
                         state=self.seen_jobs[pid_],
                         free_mib=gpu["free_mib"])
        for pid_ in list(self.seen_jobs):
            if pid_ not in current:
                status = self.comfy_history_status(pid_)
                self.log("job_finished", prompt_id=pid_,
                         status=status or "unknown")
                del self.seen_jobs[pid_]

        if jobs_present:
            self.empty_since = None
            if self.mode in ("idle", "settling"):
                self.mode = "holding"
            if gpu["free_mib"] < self.cfg["job_headroom_mib"] and \
                    time.time() - self.last_evict_pass >= \
                    self.cfg["evict_cooldown_s"]:
                if not self.state["outstanding"] and \
                        not self.snapshot_logged:
                    self.snapshot_logged = True
                    self.log("snapshot", residents=procs,
                             ollama=self.ollama_resident(),
                             gpu=gpu)
                self.eviction_pass(queue, gpu)
        else:
            self.snapshot_logged = False
            # Queue empty: settle, then restore (whatever the outcomes).
            if self.state["outstanding"] or self.state.get("jan_evicted"):
                if self.empty_since is None:
                    self.empty_since = time.time()
                    self.mode = "settling"
                    self.log("settle_start",
                             settle_window_s=self.cfg["settle_window_s"])
                elif time.time() - self.empty_since >= \
                        self.cfg["settle_window_s"]:
                    self.restore_pass(reason="queue_drained")
                    self.empty_since = None
            else:
                self.mode = "idle"
                self.empty_since = None

        self._write_status(gpu, procs, queue, coresident)

    def _write_status(self, gpu, procs, queue, coresident) -> None:
        status = {
            "ts": now_iso(),
            "mode": self.mode,
            "gpu": gpu,
            "coresident_mib": coresident,
            "max_coresident_mib": self.cfg["max_coresident_mib"],
            "job_headroom_mib": self.cfg["job_headroom_mib"],
            "queue": {"running": queue["running"],
                      "pending": queue["pending"]},
            "processes": procs,
            "ollama_resident": self.ollama_resident(),
            "outstanding_evictions": self.state.get("outstanding", []),
            "jan_evicted": bool(self.state.get("jan_evicted")),
        }
        tmp = self.status_file.with_suffix(".tmp")
        try:
            with open(tmp, "w") as f:
                json.dump(status, f, indent=1)
            tmp.replace(self.status_file)
        except Exception:
            pass

    def run(self) -> None:
        def _sig(signum, _frame):
            self.stop_requested = True
        signal.signal(signal.SIGTERM, _sig)
        signal.signal(signal.SIGINT, _sig)
        self.log("broker_start", config={k: self.cfg[k] for k in (
            "job_headroom_mib", "max_coresident_mib", "settle_window_s",
            "allow_jan_eviction", "comfyui_url", "ollama_url")})
        # Crash/restart recovery: outstanding evictions from a previous
        # life get restored by the normal settle path (or immediately
        # below if the queue is already empty).
        if self.state["outstanding"] or self.state.get("jan_evicted"):
            self.log("startup_recovery",
                     outstanding=[o["name"] for o in
                                  self.state["outstanding"]],
                     jan_evicted=bool(self.state.get("jan_evicted")))
            try:
                q = self.comfy_queue()
                if not q["running"] and not q["pending"]:
                    self.restore_pass(reason="startup_recovery")
            except Exception as e:
                self.log("startup_recovery_deferred", error=str(e))
        while not self.stop_requested:
            try:
                self.tick()
            except Exception as e:
                self.log("tick_error", error=repr(e))
            time.sleep(self.cfg["poll_interval_s"])
        self.log("broker_stop")


# ---------- CLI ----------
def load_config(path: str | None) -> dict:
    cfg = dict(DEFAULT_CONFIG)
    candidates = []
    if path:
        candidates.append(Path(path))
    candidates.append(Path(
        os.environ.get("VRAM_BROKER_CONFIG",
                       "/home/scott/.cooper/vram-broker/config.json")))
    for cand in candidates:
        try:
            with open(cand) as f:
                cfg.update(json.load(f))
            break
        except Exception:
            continue
    return cfg


def cmd_status(cfg: dict) -> int:
    b = Broker(cfg)
    status = None
    try:
        with open(b.status_file) as f:
            status = json.load(f)
    except Exception:
        pass
    stale = True
    if status:
        try:
            ts = datetime.fromisoformat(status["ts"])
            stale = (datetime.now(timezone.utc).astimezone()
                     - ts).total_seconds() > 15
        except Exception:
            pass
    if status and not stale:
        gpu = status["gpu"]
        print(f"vram-broker: mode={status['mode']}  "
              f"GPU {gpu['used_mib']}/{gpu['total_mib']} MiB used, "
              f"{gpu['free_mib']} free  "
              f"coresident={status['coresident_mib']} MiB "
              f"(envelope <= {status['max_coresident_mib']})")
        q = status["queue"]
        print(f"  queue: running={len(q['running'])} "
              f"pending={len(q['pending'])}")
        for p in status["processes"]:
            print(f"  pid {p['pid']:>7}  {p['mib']:>6} MiB  [{p['class']}]  "
                  f"{p['cmdline'][:80]}")
        res = [m["name"] for m in status["ollama_resident"]]
        print(f"  ollama resident: {res or 'none'}")
        out = [o["name"] for o in status["outstanding_evictions"]]
        print(f"  outstanding evictions: {out or 'none'}"
              f"  jan_evicted={status['jan_evicted']}")
        return 0
    # Broker not reporting: fall back to live probes.
    print("vram-broker: no fresh status (daemon down?) - live probe:")
    gpu = b.gpu()
    print(f"  GPU {gpu['used_mib']}/{gpu['total_mib']} MiB used, "
          f"{gpu['free_mib']} free")
    print(f"  ollama resident: "
          f"{[m['name'] for m in b.ollama_resident()] or 'none'}")
    print(f"  outstanding evictions in state file: "
          f"{[o['name'] for o in b.state.get('outstanding', [])] or 'none'}"
          f"  jan_evicted={bool(b.state.get('jan_evicted'))}")
    print("  recover with: vram_broker.py restore")
    return 1


def cmd_restore(cfg: dict) -> int:
    b = Broker(cfg)
    q = b.comfy_queue()
    if q["running"] or q["pending"]:
        print("Refusing manual restore: ComfyUI queue is not empty "
              f"(running={q['running']}, pending={q['pending']}).")
        return 2
    if not b.state["outstanding"] and not b.state.get("jan_evicted"):
        print("Nothing outstanding to restore.")
        return 0
    b.restore_pass(reason="manual_cli")
    print("Restore pass complete. Resident now: "
          f"{[m['name'] for m in b.ollama_resident()]}")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(prog="vram-broker",
                                 description=__doc__.splitlines()[0])
    ap.add_argument("--config", default=None)
    sub = ap.add_subparsers(dest="cmd", required=True)
    for name, helptext in (("run", "run the broker daemon"),
                           ("status", "one-command status readout"),
                           ("restore", "manually restore evictions")):
        p = sub.add_parser(name, help=helptext)
        # SUPPRESS default: a --config after the verb must not clobber one
        # given before it (argparse would otherwise overwrite with None).
        p.add_argument("--config", default=argparse.SUPPRESS)
    args = ap.parse_args()
    cfg = load_config(args.config)
    if args.cmd == "run":
        Broker(cfg).run()
        return 0
    if args.cmd == "status":
        return cmd_status(cfg)
    if args.cmd == "restore":
        return cmd_restore(cfg)
    return 2


if __name__ == "__main__":
    sys.exit(main())
