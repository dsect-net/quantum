#!/usr/bin/env python3
"""Live test driver for vram-broker (TRK-0478). Runs on Tritium.

Phases:
  A  load llama3.2:3b deliberately; record BEFORE numbers
  B  queue a small Qwen-Image 2.1 job; expect broker evict -> job OK ->
     settle -> restore; record timings + peak VRAM
  C  queue a deliberately broken job (wrong VAE); expect evict -> job
     ERROR -> restore anyway
  D  control: with nothing evictable loaded, a job must cause NO eviction
     and NO restore (broker only restores what it evicted)
Writes test-summary.json next to this file.
"""
import json
import subprocess
import time
import urllib.request
from pathlib import Path

HERE = Path("/home/scott/.cooper/vram-broker")
EVENTS = HERE / "events.jsonl"
COMFY = "http://127.0.0.1:8188"
OLLAMA = "http://127.0.0.1:11434"
MODEL = "llama3.2:3b"
GRAPH_SRC = "/home/scott/qwen21/api-t2i-st.json"

summary = {"phases": {}}


def http(method, url, payload=None, timeout=30):
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(url, data=data, method=method,
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        body = r.read()
        return json.loads(body) if body else {}


def gpu_used_free():
    out = subprocess.run(
        ["nvidia-smi", "--query-gpu=memory.used,memory.free",
         "--format=csv,noheader,nounits"],
        capture_output=True, text=True).stdout.strip()
    used, free = out.split(",")
    return int(used), int(free)


def ollama_ps():
    try:
        ps = http("GET", OLLAMA + "/api/ps", timeout=10)
        return [m["name"] for m in ps.get("models", [])]
    except Exception:
        return []


def event_lines():
    try:
        return EVENTS.read_text().splitlines()
    except Exception:
        return []


def events_since(n):
    out = []
    for line in event_lines()[n:]:
        try:
            out.append(json.loads(line))
        except Exception:
            pass
    return out


def ollama_load():
    t0 = time.time()
    http("POST", OLLAMA + "/api/generate",
         {"model": MODEL, "prompt": "Say OK", "stream": False,
          "keep_alive": "30m"}, timeout=300)
    return time.time() - t0


def ollama_unload():
    http("POST", OLLAMA + "/api/generate",
         {"model": MODEL, "keep_alive": 0}, timeout=60)
    for _ in range(60):
        if MODEL not in ollama_ps():
            return True
        time.sleep(0.5)
    return False


def build_graph(prefix, broken=False):
    g = json.loads(Path(GRAPH_SRC).read_text())
    for node in g.values():
        ct = node.get("class_type", "")
        inp = node.get("inputs", {})
        if "Latent" in ct and "width" in inp and "height" in inp:
            inp["width"], inp["height"] = 512, 512
        if ct == "KSampler":
            inp["steps"] = 8
        if ct == "SaveImage":
            inp["filename_prefix"] = prefix
        if broken and ct == "VAELoader":
            inp["vae_name"] = "wan2.2_vae.safetensors"
    return g


def run_job(graph, timeout=600):
    """Queue a job; poll to completion while sampling peak VRAM."""
    resp = http("POST", COMFY + "/prompt", {"prompt": graph}, timeout=30)
    pid = resp.get("prompt_id")
    if not pid:
        return {"accepted": False, "resp": resp}
    t0 = time.time()
    peak = 0
    status = None
    while time.time() - t0 < timeout:
        used, _ = gpu_used_free()
        peak = max(peak, used)
        try:
            h = http("GET", f"{COMFY}/history/{pid}", timeout=10)
            entry = h.get(pid)
            if entry and entry.get("status", {}).get("completed"):
                status = entry["status"].get("status_str", "success")
                break
        except Exception:
            pass
        time.sleep(3)
    return {"accepted": True, "prompt_id": pid, "status": status,
            "seconds": round(time.time() - t0, 1), "peak_used_mib": peak}


def wait_restore(timeout=300):
    t0 = time.time()
    while time.time() - t0 < timeout:
        if MODEL in ollama_ps():
            return round(time.time() - t0, 1)
        time.sleep(3)
    return None


def main():
    # ---------- Phase A ----------
    mark = len(event_lines())
    load_s = ollama_load()
    used, free = gpu_used_free()
    summary["phases"]["A"] = {
        "load_seconds": round(load_s, 1), "gpu_used_mib": used,
        "gpu_free_mib": free, "ollama_ps": ollama_ps()}
    print("A done", summary["phases"]["A"], flush=True)

    # ---------- Phase B ----------
    mark = len(event_lines())
    job = run_job(build_graph("vram_broker_test"))
    job_end = time.time()
    restore_wait = wait_restore()
    evs = events_since(mark)
    summary["phases"]["B"] = {
        "job": job,
        "restore_wait_s_after_job_end": restore_wait,
        "ollama_ps_after": ollama_ps(),
        "gpu_after": gpu_used_free(),
        "broker_events": [e["event"] for e in evs],
        "evict_events": [e for e in evs if e["event"].startswith("evict")
                         or e["event"].startswith("restore")
                         or e["event"] == "snapshot"],
    }
    print("B done", job.get("status"), "restore_wait", restore_wait,
          flush=True)

    # ---------- Phase C ----------
    if MODEL not in ollama_ps():
        ollama_load()
    mark = len(event_lines())
    job = run_job(build_graph("vram_broker_failtest", broken=True))
    restore_wait = wait_restore()
    evs = events_since(mark)
    summary["phases"]["C"] = {
        "job": job,
        "restore_wait_s_after_job_end": restore_wait,
        "ollama_ps_after": ollama_ps(),
        "broker_events": [e["event"] for e in evs],
    }
    print("C done", job.get("status"), "restore_wait", restore_wait,
          flush=True)

    # ---------- Phase D ----------
    ollama_unload()
    used, free = gpu_used_free()
    mark = len(event_lines())
    job = run_job(build_graph("vram_broker_control"))
    time.sleep(45)  # beyond the settle window: nothing should restore
    evs = events_since(mark)
    summary["phases"]["D"] = {
        "free_before_mib": free, "job": job,
        "ollama_ps_after": ollama_ps(),
        "evict_or_restore_events": [
            e["event"] for e in evs
            if e["event"].startswith(("evict", "restore", "snapshot"))],
        "broker_events": [e["event"] for e in evs],
    }
    print("D done", job.get("status"), flush=True)

    (HERE / "test-summary.json").write_text(json.dumps(summary, indent=1))
    print("SUMMARY WRITTEN", flush=True)


if __name__ == "__main__":
    main()
