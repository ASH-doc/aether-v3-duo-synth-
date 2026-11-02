#!/usr/bin/env python3
"""Synth A M2 build and static checks.  Run:  python3 build_m2.py"""
import json, re, shutil, subprocess, sys, tempfile
from pathlib import Path

R = Path(__file__).resolve().parent
S = R / "source"
params = json.dumps(json.loads((S / "synth-a/params-m2.json").read_text()), separators=(",", ":"))
wk = (S / "synth-a/m2-worklet.js").read_text().replace("/*@PARAMS@*/", params)
pn = (S / "synth-a/m2-panel.js").read_text().replace("/*@PARAMS@*/", params)
host = (S / "host/m2-harness.html").read_text()

res = []
def check(name, ok, detail=""): res.append((name, "PASS" if ok else "FAIL", detail))

table = json.loads((S / "synth-a/params-m2.json").read_text())
ids = [p["id"] for p in table]
def _ok(p):
    c = p.get("choices")
    base = p["min"] <= p["def"] <= p["max"] and p["min"] < p["max"] and p["curve"] in ("lin", "log", "sq")
    if p["curve"] == "log": base = base and p["min"] > 0
    if c: base = base and p["min"] == 0 and p["max"] == len(c) - 1 and p["step"] == 1 and float(p["def"]).is_integer()
    return base
check("Parameter table: unique ids, defaults in range, curves and choices consistent",
      len(ids) == len(set(ids)) and all(_ok(p) for p in table), str([p["id"] for p in table if not _ok(p)]))
check("Parameter table: worklet and panel use only ids that exist",
      all(i in ids for i in re.findall(r"IX\.(\w+)", wk)), str([i for i in set(re.findall(r"IX\.(\w+)", wk)) if i not in ids]))
check("Worklet: no wavetable, additive or spectral synthesis (Synth A is subtractive only)",
      not re.search(r"wavetable|additive|spectral|\bfft\b|\bifft\b", wk, re.I))

BANNED = re.compile(r"\b(window|document|globalThis|self|localStorage|sessionStorage|navigator|fetch|XMLHttpRequest|WebSocket|eval|importScripts|require)\b|new\s+Function\b")
PROTO = re.compile(r"\.prototype\b|__proto__|Object\s*\.\s*(defineProperty|defineProperties|setPrototypeOf|assign|freeze)|Reflect\s*\.")
tops = [l for l in wk.splitlines() if l and not l[0].isspace()]
check("Worklet: one strict-mode IIFE, nothing else at top level",
      wk.startswith("(function () {\n  'use strict';") and tops == ["(function () {", "})();"])
names = re.findall(r"registerProcessor\(\s*'([^']+)'", wk)
check("Worklet: one registration, name va-m2", names == ["va-m2"], str(names))
check("Worklet: no Math.random", not re.search(r"Math\s*\.\s*random", wk))
check("Worklet: no import/export/require", not re.search(r"^\s*(import|export)\b|\bimport\s*\(|\brequire\s*\(", wk, re.M))
check("Worklet: no banned globals or network access", not BANNED.search(wk), str(BANNED.findall(wk)))
check("Worklet: no prototype or built-in mutation", not PROTO.search(wk))
check("Worklet: plain ASCII, nothing that can break a script tag", wk.isascii() and "</script" not in wk.lower() and "<!--" not in wk)
check("Worklet never mentions engine B", not re.search(r"\bwt-|PRISM|Synth B", wk))
check("No external URLs or outside files anywhere",
      not any(re.search(r"https?://|@import|<link\b|<script[^>]*\ssrc\s*=", s, re.I) for s in (wk, pn, host)))
check("Page makes no network calls", not re.search(r"\b(fetch|XMLHttpRequest|WebSocket|sendBeacon|EventSource)\b", pn + host))
check("No fault-injection hook in the build", not re.search(r"fault[_-]?inject|inject[_-]?fault|__fault|fault[_-]?hook", wk + pn + host, re.I))
slots = host.count("{{WORKLET_A}}") == 1 and host.count("{{PANEL_A}}") == 1
check("Harness has one slot each for worklet and panel", slots)
dist = host.replace("{{WORKLET_A}}", wk.rstrip()).replace("{{PANEL_A}}", pn.rstrip()) if slots else ""
if dist:
    check("Built page: slots filled, three script blocks all closed",
          "{{" not in dist and dist.lower().count("<script") == 3 and dist.lower().count("</script>") == 3)

node = shutil.which("node")
def syntax(text, name):
    with tempfile.TemporaryDirectory() as d:
        p = Path(d) / name; p.write_text(text)
        r = subprocess.run([node, "--check", str(p)], capture_output=True, text=True)
        return r.returncode == 0, r.stderr.strip()[:300]
if node and dist:
    for nm, txt in (("worklet", wk), ("panel", pn)):
        ok, err = syntax(txt, nm + ".js"); check(f"{nm} parses as valid JavaScript", ok, err)
    m = re.search(r'<script id="harness-main">\n(.*?)</script>', dist, re.S)
    ok, err = syntax(m.group(1), "harness.js") if m else (False, "not found"); check("harness script parses as valid JavaScript", ok, err)

for n, s, d in res: print(f"{s}  {n}" + (f"   [{d}]" if s != "PASS" and d else ""))
bad = [r for r in res if r[1] == "FAIL"]
print(f"\n{len(res)-len(bad)} passed, {len(bad)} failed")
if bad: print("Build NOT written."); sys.exit(1)
(R / "dist").mkdir(exist_ok=True)
(R / "dist/DualSynth_A_M2.html").write_text(dist)
(R / "dist/va-m2-worklet.js").write_text(wk)
print("Built dist/DualSynth_A_M2.html and dist/va-m2-worklet.js")
