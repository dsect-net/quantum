#!/usr/bin/env python3
"""Round 3 for vram-broker (TRK-0478): full-placement restore proof.

Prelude forces a clean slate the earlier rounds lacked:
  1. fully unload llama3.2:3b (a resident model is never re-placed)
  2. free ComfyUI's cached models
  3. THEN run test_driver2's cycle: its fresh load must land ~2436 MiB
     in VRAM, and after evict -> job -> settle -> restore, the restored
     model must ALSO be at ~2436 MiB (fix: restore frees ComfyUI first).
Also asserts the snapshot event fires at most once for the batch.
"""
import json
import time

import test_driver
import test_driver2
from test_driver import MODEL, http, ollama_ps, OLLAMA


def main():
    ok_unload = test_driver.ollama_unload()
    http("POST", "http://127.0.0.1:8188/free",
         {"unload_models": True, "free_memory": True}, timeout=30)
    time.sleep(3)
    print(json.dumps({"prelude_unload_ok": ok_unload,
                      "ollama_ps_clean": ollama_ps(),
                      "gpu_clean": test_driver.gpu_used_free()}),
          flush=True)
    test_driver2.main()


if __name__ == "__main__":
    main()
