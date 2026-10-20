#!/usr/bin/env python3
"""Breeze / Nebula MCP demo — single-file stdlib server.

A small workflow UI that exercises the Quantum MCP media tools end-to-end:
Breeze TTS (list voices, generate, poll status, stream the MP3) and a
Nebula panel (list workflows, queue a run with a prompt override, poll
status, display image outputs).

Every tool call goes through the hub MCP gateway's own local endpoint
(127.0.0.1:8091/mcp, JSON-RPC, same protocol the Cooper bridge uses via
mcp.dsect.net). Auth: a gateway bearer key read at startup from the file
named by BREEZE_DEMO_MCP_KEY_FILE (default
/home/scott/.cooper/breeze-demo/mcp-key). The key never reaches the
browser. If the file is absent the page runs in a clearly-labelled
"not provisioned" mode instead of failing silently.

Binds 0.0.0.0:7656 (LAN + tailnet, same exposure as the tracker board
and PFML dashboard). Tailscale Serve (tailnet-only) fronts it on :8446.
"""
import html
import json
import os
import re
import threading
import urllib.request
import urllib.error
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, unquote, parse_qs

PORT = 7656
GATEWAY = os.environ.get("BREEZE_DEMO_GATEWAY", "http://127.0.0.1:8091/mcp")
KEY_FILE = os.environ.get(
    "BREEZE_DEMO_MCP_KEY_FILE", "/home/scott/.cooper/breeze-demo/mcp-key")
BREEZE_DIR = Path("/mnt/fast/breeze-mcp")
NEBULA_OUTPUT_ROOTS = [Path("/home/scott/ComfyUI/output")]
MAX_BODY = 65536
JOB_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9\-_]{2,80}$")
IMG_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".gif"}
CTYPES = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
          ".webp": "image/webp", ".gif": "image/gif", ".mp4": "video/mp4",
          ".webm": "video/webm", ".mp3": "audio/mpeg", ".wav": "audio/wav",
          ".flac": "audio/flac"}

# ---------------------------------------------------------------- MCP client

class McpError(Exception):
    pass

class McpNotProvisioned(McpError):
    pass

def _load_key():
    try:
        key = Path(KEY_FILE).read_text(encoding="utf-8").strip()
    except OSError:
        return None
    return key or None

class McpClient:
    """Minimal streamable-HTTP MCP client for the hub gateway.

    Mirrors the bridge (mcp.py): initialize -> Mcp-Session-Id header,
    notifications/initialized, tools/call; unwraps SSE frames and
    structuredContent. Calls are serialized with a lock (the gateway
    session is shared); one re-init retry on session errors.
    """

    def __init__(self):
        self._lock = threading.Lock()
        self._session = None
        self._key = _load_key()
        self._rid = 100

    @property
    def provisioned(self):
        return bool(self._key)

    def _post(self, payload, session=None):
        data = json.dumps(payload).encode()
        req = urllib.request.Request(GATEWAY, data=data, method="POST")
        req.add_header("Content-Type", "application/json")
        req.add_header("Accept", "application/json, text/event-stream")
        req.add_header("Authorization", f"Bearer {self._key}")
        if session:
            req.add_header("Mcp-Session-Id", session)
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                raw = r.read().decode(errors="replace")
                ctype = r.headers.get("Content-Type", "")
                new_session = r.headers.get("Mcp-Session-Id")
        except urllib.error.HTTPError as e:
            body = e.read().decode(errors="replace")[:400]
            raise McpError(f"gateway HTTP {e.code}: {body}")
        except Exception as e:
            raise McpError(f"gateway unreachable: {e}")
        if "text/event-stream" in ctype:
            frames = [ln[5:].strip() for ln in raw.splitlines()
                      if ln.startswith("data:")]
            raw = frames[-1] if frames else raw
        try:
            msg = json.loads(raw)
        except json.JSONDecodeError:
            raise McpError(f"gateway returned non-JSON: {raw[:200]}")
        if isinstance(msg, dict) and msg.get("error"):
            err = msg["error"]
            raise McpError(err.get("message") or json.dumps(err)[:300])
        return msg.get("result"), new_session

    def _open_session(self):
        result, session = self._post({
            "jsonrpc": "2.0", "id": 1, "method": "initialize",
            "params": {"protocolVersion": "2025-03-26", "capabilities": {},
                       "clientInfo": {"name": "breeze-demo-page",
                                      "version": "1.0"}}})
        try:
            self._post({"jsonrpc": "2.0", "method": "notifications/initialized"},
                       session=session)
        except Exception:
            pass
        self._session = session
        return session

    def call(self, name, args):
        if not self._key:
            raise McpNotProvisioned(
                "MCP key not provisioned on Tritium yet "
                f"(expected a gateway key file at {KEY_FILE}).")
        with self._lock:
            for attempt in (1, 2):
                if not self._session:
                    self._open_session()
                self._rid += 1
                try:
                    result, _ = self._post(
                        {"jsonrpc": "2.0", "id": self._rid,
                         "method": "tools/call",
                         "params": {"name": name, "arguments": args}},
                        session=self._session)
                    break
                except McpError as e:
                    if attempt == 1 and ("session" in str(e).lower()
                                         or "HTTP 404" in str(e)
                                         or "HTTP 400" in str(e)):
                        self._session = None
                        continue
                    raise
        if not isinstance(result, dict):
            raise McpError("empty tool result")
        sc = result.get("structuredContent")
        if isinstance(sc, dict):
            parsed = sc
        else:
            text = ""
            for item in result.get("content") or []:
                if item.get("type") == "text":
                    text = item.get("text", "")
                    break
            try:
                parsed = json.loads(text) if text else {}
            except json.JSONDecodeError:
                parsed = {"text": text}
        if result.get("isError") or (isinstance(parsed, dict)
                                     and parsed.get("ok") is False):
            msg = (parsed.get("error") or parsed.get("message")
                   or parsed.get("text") or "tool call failed")
            raise McpError(str(msg)[:400])
        return parsed

MCP = McpClient()
_audio_paths = {}          # job_id -> Path of finished MP3 (from result call)
_audio_lock = threading.Lock()
_prompt_param_cache = {}   # workflow -> {"node","key"} or None

def remember_audio(job_id, path_str):
    p = Path(path_str)
    try:
        resolved = p.resolve()
    except OSError:
        return
    if BREEZE_DIR.resolve() in resolved.parents:
        with _audio_lock:
            _audio_paths[job_id] = resolved

def audio_path_for(job_id):
    with _audio_lock:
        p = _audio_paths.get(job_id)
    if p and p.exists():
        return p
    candidate = BREEZE_DIR / job_id / "output.mp3"
    if candidate.exists():
        return candidate
    return None

def locate_nebula_output(filename):
    """Find a Nebula output file by basename under the ComfyUI output tree."""
    base = os.path.basename(filename or "")
    if not base:
        return None
    for root in NEBULA_OUTPUT_ROOTS:
        direct = root / base
        if direct.exists():
            return direct
        try:
            for dirpath, _dirs, files in os.walk(root):
                if os.path.relpath(dirpath, root).count(os.sep) > 3:
                    continue
                if base in files:
                    return Path(dirpath) / base
        except OSError:
            continue
    return None

def prompt_param_for(workflow):
    """The positive-prompt node/key for a workflow, via the MCP params tool."""
    if workflow in _prompt_param_cache:
        return _prompt_param_cache[workflow]
    found = None
    try:
        res = MCP.call("quantum_nebula_workflow_params", {"workflow": workflow})
        params = res.get("params") or []
        texts = [p for p in params if p.get("kind") == "text"]
        for p in texts:
            label = f"{p.get('label', '')} {p.get('title', '')}".lower()
            if "positive" in label:
                found = {"node": p["node"], "key": p["key"]}
                break
        if not found:
            for p in texts:
                if p.get("node_type") == "CLIPTextEncode":
                    found = {"node": p["node"], "key": p["key"]}
                    break
        if not found and texts:
            found = {"node": texts[0]["node"], "key": texts[0]["key"]}
    except McpError:
        found = None
    _prompt_param_cache[workflow] = found
    return found

# --------------------------------------------------------------------- page

CSS = """
:root{--ink:#16161a;--mut:#6b6b76;--line:#e4e4ea;--bg:#f6f6f8;--card:#fff;
--violet:#6d28d9;--ok:#14743c;--err:#b3261e;--radius:14px}
*{box-sizing:border-box}
body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,
Helvetica,Arial,sans-serif;background:var(--bg);color:var(--ink);
-webkit-font-smoothing:antialiased}
.wrap{max-width:880px;margin:0 auto;padding:28px 18px 56px}
header h1{font-size:26px;margin:0 0 4px;letter-spacing:-.01em}
header p{margin:0;color:var(--mut);font-size:14.5px;line-height:1.5}
.badge{display:inline-block;font-size:12px;font-weight:600;padding:3px 10px;
border:1px solid var(--line);border-radius:999px;background:#fff;color:var(--mut)}
.badge.live{color:var(--ok);border-color:#bfe3cd}
.badge.warn{color:#8a5a00;border-color:#ecd9a8;background:#fffaf0}
.card{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);
padding:20px;margin-top:18px}
.card h2{margin:0 0 4px;font-size:18px}
.card .sub{color:var(--mut);font-size:13.5px;margin:0 0 14px;line-height:1.5}
label{display:block;font-size:13px;font-weight:600;margin:14px 0 6px}
label:first-of-type{margin-top:0}
select,input[type=text],textarea{width:100%;font:inherit;font-size:15px;
padding:10px 12px;border:1px solid var(--line);border-radius:10px;background:#fff}
textarea{resize:vertical;min-height:96px;line-height:1.5}
.row{display:flex;gap:12px;flex-wrap:wrap}
.row>div{flex:1;min-width:180px}
.count{font-size:12px;color:var(--mut);text-align:right;margin-top:4px}
.chips{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px}
.chip{font-size:12.5px;padding:6px 11px;border:1px solid var(--line);
border-radius:999px;background:#fafafa;cursor:pointer}
.chip:hover{border-color:var(--violet);color:var(--violet)}
button.primary{background:#111;color:#fff;border:0;font:inherit;font-weight:600;
font-size:15px;padding:12px 22px;border-radius:10px;cursor:pointer;margin-top:18px}
button.primary:disabled{opacity:.45;cursor:default}
.status{margin-top:14px;font-size:14px;color:var(--mut);min-height:20px}
.status.err{color:var(--err)}
.bar{height:8px;background:#eeeef2;border-radius:99px;overflow:hidden;margin-top:8px;
display:none}
.bar>i{display:block;height:100%;width:0;background:var(--violet);
transition:width .4s ease}
audio{width:100%;margin-top:12px}
.dl{font-size:13.5px;margin-top:8px;display:inline-block}
.hist{margin-top:6px}
.hist .item{border-top:1px solid var(--line);padding:12px 0}
.hist .item:first-child{border-top:0}
.hist .meta{font-size:12.5px;color:var(--mut);margin-bottom:6px}
.hist .txt{font-size:14.5px;line-height:1.45}
.notice{border:1px solid #ecd9a8;background:#fffaf0;border-radius:var(--radius);
padding:14px 18px;margin-top:18px;font-size:14px;line-height:1.55}
.outputs{display:flex;gap:12px;flex-wrap:wrap;margin-top:12px}
.outputs figure{margin:0;width:220px}
.outputs img{width:100%;border:1px solid var(--line);border-radius:10px;display:block}
.outputs figcaption{font-size:12px;color:var(--mut);margin-top:5px;word-break:break-all}
footer{color:var(--mut);font-size:12.5px;margin-top:26px;line-height:1.6}
code{background:#f0f0f3;padding:1px 5px;border-radius:5px;font-size:12.5px}
"""

JS = """
const $=id=>document.getElementById(id);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function api(path,opts){const r=await fetch(path,opts);
  const d=await r.json().catch(()=>({error:"bad server response"}));
  if(!r.ok)throw new Error(d.message||d.error||("HTTP "+r.status));return d;}
function esc(s){const d=document.createElement("div");d.textContent=s;return d.innerHTML;}

// ---------------- Breeze ----------------
const DIRECTIONS=[
 "Speak casually and warmly, like a friend chatting over coffee. Relaxed and upbeat, gentle volume, never projected or announcer-like.",
 "Speak like a calm documentary narrator: measured pace, clear diction, warm low register, natural pauses between sentences.",
 "Bright and energetic, like a morning radio host: upbeat and smiling, but never shouted."];
const SAMPLES=[
 "Good evening. This is the Breeze demo page, coming to you live through the Quantum MCP.",
 "The quick brown fox jumps over the lazy dog. Pack my box with five dozen liquor jugs.",
 "Welcome back to the Quantum Channel. Tonight we take a look back at how far the fleet has come."];
let history=[];
function buildChips(){
 $("dirChips").innerHTML=DIRECTIONS.map((d,i)=>`<button type="button" class="chip" data-d="${i}">Direction ${i+1}</button>`).join("");
 $("dirChips").querySelectorAll("button").forEach(b=>b.onclick=()=>{$("bInstruction").value=DIRECTIONS[+b.dataset.d];});
 $("textChips").innerHTML=SAMPLES.map((s,i)=>`<button type="button" class="chip" data-t="${i}">Sample ${i+1}</button>`).join("");
 $("textChips").querySelectorAll("button").forEach(b=>b.onclick=()=>{$("bText").value=SAMPLES[+b.dataset.t];countChars();});
}
function countChars(){$("bCount").textContent=$("bText").value.length+" / 2000 characters";}
async function loadVoices(){
 try{const d=await api("/api/voices");
   $("bVoice").innerHTML=d.voices.map(v=>`<option value="${esc(v.name)}">${esc(v.name)}</option>`).join("");
   const def=d.voices.find(v=>v.name==="cooper-v7")||d.voices[0];
   if(def)$("bVoice").value=def.name;
 }catch(e){$("bStatus").textContent="Could not load voices: "+e.message;$("bStatus").className="status err";}
}
async function breezeGenerate(){
 const text=$("bText").value.trim(),voice=$("bVoice").value,
       instr=$("bInstruction").value.trim();
 const st=$("bStatus"),bar=$("bBar"),fill=$("bFill");
 st.className="status";$("bPlayer").style.display="none";$("bDl").style.display="none";
 if(!text){st.textContent="Write or pick some text first.";st.className="status err";return;}
 $("bGo").disabled=true;bar.style.display="block";fill.style.width="4%";
 st.textContent="Asking Breeze to start the job...";
 const t0=Date.now();
 try{
  const job=await api("/api/breeze/generate",{method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({text,voice,instruction:instr||undefined})});
  const jobId=job.job_id;let state=job.state||"queued";
  while(true){
   if(Date.now()-t0>10*60*1000)throw new Error("Timed out after 10 minutes - the job may still finish on the hub; try a shorter text.");
   const s=await api("/api/breeze/status/"+encodeURIComponent(jobId));
   state=s.state;
   if(s.chunks_total){fill.style.width=Math.round(100*(s.chunks_done||0)/s.chunks_total)+"%";
     st.textContent=`Rendering with ${voice} - chunk ${s.chunks_done||0} of ${s.chunks_total}...`;}
   else st.textContent="Job "+state+"...";
   if(state==="done")break;
   if(state==="error")throw new Error(s.error||"Generation failed on the hub.");
   await sleep(2500);
  }
  fill.style.width="100%";
  const res=await api("/api/breeze/result/"+encodeURIComponent(jobId));
  const url="/audio/"+encodeURIComponent(jobId);
  const pl=$("bPlayer");pl.src=url;pl.style.display="block";
  const dl=$("bDl");dl.href=url;dl.download=res.filename||"breeze.mp3";
  dl.textContent="Download MP3 ("+Math.round((res.size_bytes||0)/1024)+" KB)";dl.style.display="inline-block";
  st.textContent="Done in "+Math.round((Date.now()-t0)/1000)+"s - press play.";
  history.unshift({text,voice,url,time:new Date()});
  renderHistory();
 }catch(e){
   if(/no longer tracked|unknown job|not found/i.test(e.message))
     st.textContent="That job is no longer tracked - the hub restarted and cleared its job table. Generate again.";
   else st.textContent="Something went wrong: "+e.message;
   st.className="status err";bar.style.display="none";
 }
 $("bGo").disabled=false;
}
function renderHistory(){
 $("histList").innerHTML=history.map(h=>`<div class="item">
   <div class="meta">${esc(h.voice)} - ${h.time.toLocaleTimeString()}</div>
   <div class="txt">${esc(h.text.slice(0,140))}${h.text.length>140?"...":""}</div>
   <audio controls preload="none" src="${h.url}"></audio></div>`).join("");
 $("histCard").style.display=history.length?"block":"none";
}

// ---------------- Nebula ----------------
let promptTargets={};
async function loadWorkflows(){
 try{const d=await api("/api/workflows");
   $("nWorkflow").innerHTML=d.workflows.map(w=>`<option value="${esc(w.name)}">${esc(w.name)}</option>`).join("");
   const def=d.workflows.find(w=>w.name.includes("DreamShaper 8"))||d.workflows[0];
   if(def)$("nWorkflow").value=def.name;
   notePromptTarget();
 }catch(e){$("nStatus").textContent="Could not load workflows: "+e.message;$("nStatus").className="status err";}
}
async function notePromptTarget(){
 const wf=$("nWorkflow").value;if(!wf)return;
 if(!(wf in promptTargets)){
   try{const d=await api("/api/workflow_prompt?workflow="+encodeURIComponent(wf));
     promptTargets[wf]=d.prompt_param||null;
   }catch(e){promptTargets[wf]=null;}
 }
 $("nPromptNote").textContent=promptTargets[wf]
   ? "The prompt is wired to this workflow's positive-prompt node."
   : "This workflow exposes no prompt node - it will run with its built-in defaults.";
}
async function nebulaGenerate(){
 const wf=$("nWorkflow").value,backend=$("nBackend").value,prompt=$("nPrompt").value.trim();
 const st=$("nStatus");st.className="status";$("nOutputs").innerHTML="";
 $("nGo").disabled=true;const t0=Date.now();
 st.textContent="Queuing the run on Nebula...";
 try{
  const job=await api("/api/nebula/generate",{method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({workflow:wf,backend,prompt:prompt||undefined})});
  if(job.state==="deferred"||job.deferred){st.textContent="The backend is busy - the run was deferred by Nebula. Try again in a bit.";
    $("nGo").disabled=false;return;}
  const pid=job.prompt_id;let state="queued";
  while(true){
   if(Date.now()-t0>15*60*1000)throw new Error("Timed out after 15 minutes - video workflows can run long; the run may still complete in Nebula.");
   const s=await api("/api/nebula/status/"+encodeURIComponent(pid));
   state=s.state||state;
   st.textContent="Nebula run "+state+" ("+Math.round((Date.now()-t0)/1000)+"s)...";
   if(s.done||state==="done"||state==="completed"||state==="success"){
     const outs=s.outputs||[];
     if(!outs.length){st.textContent="Run finished - no output files were reported.";break;}
     st.textContent="Done - "+outs.length+" output file(s).";
     $("nOutputs").innerHTML=outs.map(o=>{
       const name=typeof o==="string"?o:(o.filename||o.name||"");
       const url="/nebula_output/"+encodeURIComponent(name);
       return /\\.(png|jpe?g|webp|gif)$/i.test(name)
         ? `<figure><a href="${url}"><img src="${url}" alt=""></a><figcaption>${esc(name)}</figcaption></figure>`
         : `<figure><figcaption><a href="${url}">${esc(name)}</a></figcaption></figure>`;}).join("");
     break;
   }
   if(state==="error"||state==="failed")throw new Error(s.error||"The Nebula run failed.");
   await sleep(4000);
  }
 }catch(e){st.textContent="Something went wrong: "+e.message;st.className="status err";}
 $("nGo").disabled=false;
}

window.addEventListener("DOMContentLoaded",()=>{
 buildChips();countChars();loadVoices();loadWorkflows();
 $("bText").addEventListener("input",countChars);
 $("bGo").addEventListener("click",breezeGenerate);
 $("nGo").addEventListener("click",nebulaGenerate);
 $("nWorkflow").addEventListener("change",notePromptTarget);
});
"""

def render_page():
    if MCP.provisioned:
        badge = '<span class="badge live">MCP connected via the hub gateway</span>'
        notice = ""
    else:
        badge = '<span class="badge warn">MCP key not provisioned yet</span>'
        notice = f"""<div class="notice"><strong>One step left:</strong> this page talks to the
Quantum MCP gateway on Tritium, but no gateway key file is provisioned for it yet
(expected at <code>{html.escape(KEY_FILE)}</code>). Once a worker key is dropped
there and the service restarted, the panels below go live &mdash; everything else
on this page is already wired.</div>"""
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Breeze Studio - MCP Demo</title>
<style>{CSS}</style>
</head>
<body>
<div class="wrap">
<header>
  <h1>Breeze Studio</h1>
  <p>A small workflow page for the Quantum MCP media tools &mdash; Breeze voice
  generation and Nebula media runs, exercised live through the hub gateway.</p>
  <p style="margin-top:10px">{badge}</p>
</header>
{notice}

<section class="card">
  <h2>Breeze &mdash; text to speech</h2>
  <p class="sub">Pick a voice profile, write something, optionally steer it with a
  direction. Generation runs on Tritium's GPU (~15 s per sentence chunk) and jobs
  serialize on the hub, so longer texts take a little while.</p>
  <label for="bVoice">Voice</label>
  <select id="bVoice"><option>Loading voices...</option></select>
  <label for="bText">Text to speak</label>
  <textarea id="bText" maxlength="2000" placeholder="Write what the voice should say..."></textarea>
  <div class="count" id="bCount">0 / 2000 characters</div>
  <div class="chips" id="textChips"></div>
  <label for="bInstruction">Direction <span style="color:var(--mut);font-weight:400">(optional)</span></label>
  <input type="text" id="bInstruction" placeholder="e.g. warm, unhurried, slight smile">
  <div class="chips" id="dirChips"></div>
  <button class="primary" id="bGo">Generate voice</button>
  <div class="status" id="bStatus"></div>
  <div class="bar" id="bBar"><i id="bFill"></i></div>
  <audio id="bPlayer" controls style="display:none"></audio>
  <div><a class="dl" id="bDl" style="display:none" href="#">Download MP3</a></div>
</section>

<section class="card" id="histCard" style="display:none">
  <h2>This session</h2>
  <p class="sub">Clips generated since this page was opened.</p>
  <div class="hist" id="histList"></div>
</section>

<section class="card">
  <h2>Nebula &mdash; media workflows</h2>
  <p class="sub">Queue a Nebula workflow run through the same MCP. Image workflows
  finish in well under a minute; video workflows can take several minutes.</p>
  <div class="row">
    <div><label for="nWorkflow">Workflow</label>
      <select id="nWorkflow"><option>Loading workflows...</option></select></div>
    <div><label for="nBackend">Backend</label>
      <select id="nBackend"><option value="nvidia">NVIDIA &mdash; RTX 2060 Super</option>
      <option value="amd">AMD &mdash; Radeon 890M</option></select></div>
  </div>
  <label for="nPrompt">Prompt <span style="color:var(--mut);font-weight:400">(optional)</span></label>
  <input type="text" id="nPrompt" placeholder="Describe the image or scene...">
  <div class="count" id="nPromptNote" style="text-align:left"></div>
  <button class="primary" id="nGo">Run workflow</button>
  <div class="status" id="nStatus"></div>
  <div class="outputs" id="nOutputs"></div>
</section>

<footer>Breeze Studio &mdash; a demo surface for TRK-0210's MCP media tools
(voices and workflows are listed live from the hub). Private, tailnet-only.
Breeze job history lives in the hub's memory: if the hub restarts, finished
MP3s stay on disk but in-flight jobs are forgotten.</footer>
</div>
<script>{JS}</script>
</body>
</html>"""

# -------------------------------------------------------------------- HTTP

class Handler(BaseHTTPRequestHandler):
    def _send(self, code, body, ctype, extra=None):
        if isinstance(body, str):
            body = body.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def _json(self, code, obj):
        self._send(code, json.dumps(obj), "application/json; charset=utf-8")

    def _mcp_json(self, fn):
        try:
            self._json(200, fn())
        except McpNotProvisioned as e:
            self._json(503, {"ok": False, "error": "mcp_not_provisioned",
                             "message": str(e)})
        except McpError as e:
            self._json(502, {"ok": False, "error": "mcp_error",
                             "message": str(e)})
        except Exception as e:  # fail visibly, never hang
            self._json(500, {"ok": False, "error": "server_error",
                             "message": str(e)[:300]})

    def _read_body(self):
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = 0
        if length <= 0 or length > MAX_BODY:
            return None
        try:
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
        except Exception:
            return None
        return payload if isinstance(payload, dict) else None

    # -- GET --
    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        if path in ("/", "/index.html"):
            try:
                self._send(200, render_page(), "text/html; charset=utf-8")
            except Exception as exc:
                self._send(500, f"<h1>Page error</h1><pre>{html.escape(str(exc))}</pre>",
                           "text/html; charset=utf-8")
        elif path == "/healthz":
            self._send(200, "ok", "text/plain")
        elif path == "/api/voices":
            self._mcp_json(lambda: MCP.call("quantum_breeze_list_voices", {}))
        elif path == "/api/workflows":
            self._mcp_json(lambda: MCP.call("quantum_nebula_list_workflows", {}))
        elif path == "/api/workflow_prompt":
            wf = (parse_qs(parsed.query).get("workflow") or [""])[0]
            self._mcp_json(lambda: {"ok": True, "workflow": wf,
                                    "prompt_param": prompt_param_for(wf)})
        elif path.startswith("/api/breeze/status/"):
            job_id = unquote(path[len("/api/breeze/status/"):])
            if not JOB_ID_RE.match(job_id):
                self._json(400, {"ok": False, "error": "bad job id"})
            else:
                self._mcp_json(lambda: MCP.call("quantum_breeze_status",
                                                {"job_id": job_id}))
        elif path.startswith("/api/breeze/result/"):
            job_id = unquote(path[len("/api/breeze/result/"):])
            if not JOB_ID_RE.match(job_id):
                self._json(400, {"ok": False, "error": "bad job id"})
            else:
                def _result():
                    res = MCP.call("quantum_breeze_result", {"job_id": job_id})
                    if res.get("file"):
                        remember_audio(job_id, res["file"])
                    return res
                self._mcp_json(_result)
        elif path.startswith("/api/nebula/status/"):
            pid = unquote(path[len("/api/nebula/status/"):])
            if not JOB_ID_RE.match(pid):
                self._json(400, {"ok": False, "error": "bad prompt id"})
            else:
                self._mcp_json(lambda: MCP.call("quantum_nebula_status",
                                                {"prompt_id": pid}))
        elif path.startswith("/audio/"):
            self._serve_audio(unquote(path[len("/audio/"):]))
        elif path.startswith("/nebula_output/"):
            self._serve_nebula(unquote(path[len("/nebula_output/"):]))
        else:
            self.send_response(404)
            self.end_headers()

    def _serve_audio(self, job_id):
        if not JOB_ID_RE.match(job_id):
            self.send_response(404)
            self.end_headers()
            return
        p = audio_path_for(job_id)
        if not p:
            self._json(404, {"ok": False, "error": "audio_not_found",
                             "message": "No MP3 on disk for that job."})
            return
        try:
            data = p.read_bytes()
        except OSError:
            self._json(404, {"ok": False, "error": "audio_not_found",
                             "message": "No MP3 on disk for that job."})
            return
        self._send(200, data, "audio/mpeg",
                   {"Content-Disposition": f'inline; filename="{job_id}.mp3"'})

    def _serve_nebula(self, filename):
        p = locate_nebula_output(filename)
        if not p:
            self._json(404, {"ok": False, "error": "output_not_found",
                             "message": "That output file could not be located "
                                        "under the Nebula output folders."})
            return
        try:
            data = p.read_bytes()
        except OSError:
            self._json(404, {"ok": False, "error": "output_not_found",
                             "message": "That output file could not be read."})
            return
        ctype = CTYPES.get(p.suffix.lower(), "application/octet-stream")
        disp = "inline" if p.suffix.lower() in IMG_EXTS else "attachment"
        self._send(200, data, ctype,
                   {"Content-Disposition": f'{disp}; filename="{p.name}"'})

    # -- POST --
    def do_POST(self):
        path = urlparse(self.path).path
        if path == "/api/breeze/generate":
            payload = self._read_body()
            if payload is None:
                self._json(400, {"ok": False, "error": "invalid JSON body"})
                return
            text = str(payload.get("text") or "").strip()
            voice = str(payload.get("voice") or "").strip()
            instruction = str(payload.get("instruction") or "").strip()
            if not text or len(text) > 20000:
                self._json(400, {"ok": False, "error": "bad_text",
                                 "message": "Text is required (max 20000 chars)."})
                return
            if not voice or not JOB_ID_RE.match(voice.replace("-", "x")):
                self._json(400, {"ok": False, "error": "bad_voice",
                                 "message": "Pick a voice."})
                return
            args = {"text": text, "voice": voice}
            if instruction:
                args["instruction"] = instruction
            self._mcp_json(lambda: MCP.call("quantum_breeze_generate", args))
        elif path == "/api/nebula/generate":
            payload = self._read_body()
            if payload is None:
                self._json(400, {"ok": False, "error": "invalid JSON body"})
                return
            workflow = str(payload.get("workflow") or "").strip()
            backend = payload.get("backend")
            prompt = str(payload.get("prompt") or "").strip()
            if not workflow or len(workflow) > 300:
                self._json(400, {"ok": False, "error": "bad_workflow",
                                 "message": "Pick a workflow."})
                return
            args = {"workflow": workflow}
            if backend in ("nvidia", "amd"):
                args["backend"] = backend
            def _gen():
                if prompt:
                    target = prompt_param_for(workflow)
                    if target:
                        args["overrides"] = [{"node": target["node"],
                                              "key": target["key"],
                                              "value": prompt}]
                return MCP.call("quantum_nebula_generate", args)
            self._mcp_json(_gen)
        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, fmt, *args):  # keep the journal quiet
        pass


if __name__ == "__main__":
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
