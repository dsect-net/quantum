#!/usr/bin/env python3
"""Focused re-test for the fixed vram-broker (TRK-0478, round 2).

Verifies the three refinements from round 1:
  1. no spurious evict_insufficient when co-residents are in envelope
  2. restore re-warms Ollama to FULL GPU placement (size_vram ~2436 MiB),
     thanks to freeing ComfyUI's stale models before the rewarm
  3. broker logs the job's final status correctly (success)
"""
import json
import time

from test_driver import (MODEL, build_graph, event_lines, events_since,
                         gpu_used_free, http, ollama_load, ollama_ps,
                         run_job, OLLAMA)


def ps_vram_mib():
    ps = http("GET", OLLAMA + "/api/ps", timeout=10)
    for m in ps.get("models", []):
        if m["name"] == MODEL:
            return round(m.get("size_vram", 0) / 1048576)
    return None


def main():
    out = {}
    ollama_load()
    out["vram_before_mib"] = ps_vram_mib()
    out["gpu_before"] = gpu_used_free()
    mark = len(event_lines())
    job = run_job(build_graph("vram_broker_retest"))
    out["job"] = job
    # Wait for the broker's restore to complete.
    deadline = time.time() + 240
    restored_vram = None
    while time.time() < deadline:
        evs = events_since(mark)
        if any(e["event"] == "restore_done" for e in evs):
            restored_vram = ps_vram_mib()
            break
        time.sleep(3)
    out["restored_size_vram_mib"] = restored_vram
    out["ollama_ps_after"] = ollama_ps()
    evs = events_since(mark)
    out["broker_events"] = [e["event"] for e in evs]
    out["evict_insufficient_count"] = sum(
        1 for e in evs if e["event"] == "evict_insufficient")
    out["job_finished_statuses"] = [
        e.get("status") for e in evs if e["event"] == "job_finished"]
    print(json.dumps(out, indent=1), flush=True)


if __name__ == "__main__":
    main()
