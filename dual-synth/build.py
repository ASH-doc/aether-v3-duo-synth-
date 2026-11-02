#!/usr/bin/env python3
"""DUAL SYNTH PK-01 build and static checks.  Run:  python3 build.py

Reads the two worklet sources and the host template, runs the static checks,
and only writes dist/DualSynth_PK01.html if every check that ran has passed.
"""
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent
A_PATH = ROOT / "source" / "synth-a" / "pk01-worklet.js"
B_PATH = ROOT / "source" / "synth-b" / "pk01-worklet.js"
HOST_PATH = ROOT / "source" / "host" / "pk01-host.html"
OUT_PATH = ROOT / "dist" / "DualSynth_PK01.html"

results = []  # (name, status, detail) with status PASS / FAIL / SKIP


def check(name, ok, detail=""):
    results.append((name, "PASS" if ok else "FAIL", detail))


def skip(name, detail):
    results.append((name, "SKIP", detail))


a = A_PATH.read_text(encoding="utf-8")
b = B_PATH.read_text(encoding="utf-8")
host = HOST_PATH.read_text(encoding="utf-8")

ENGINES = (("A", a, "va-"), ("B", b, "wt-"))

BANNED_GLOBALS = re.compile(
    r"\b(window|document|globalThis|self|localStorage|sessionStorage|navigator|"
    r"fetch|XMLHttpRequest|WebSocket|eval|importScripts|require)\b|new\s+Function\b"
)
PROTO_MUTATION = re.compile(
    r"\.prototype\b|__proto__|Object\s*\.\s*(defineProperty|defineProperties|setPrototypeOf|assign|freeze)|Reflect\s*\."
)
MODULE_SYNTAX = re.compile(r"^\s*(import|export)\b|\bimport\s*\(|\brequire\s*\(", re.M)


def top_level_lines(src):
    return [ln for ln in src.splitlines() if ln and not ln[0].isspace()]


for label, src, prefix in ENGINES:
    strict_iife = src.startswith("(function () {\n  'use strict';")
    only_wrapper = top_level_lines(src) == ["(function () {", "})();"]
    check(f"{label}: one strict-mode IIFE, nothing else at top level", strict_iife and only_wrapper)

    names = re.findall(r"registerProcessor\(\s*'([^']+)'", src)
    check(f"{label}: exactly one registration, name starts with {prefix}",
          len(names) == 1 and names[0].startswith(prefix) and src.count("registerProcessor") == 1,
          f"found {names}")

    check(f"{label}: no Math.random", not re.search(r"Math\s*\.\s*random", src))
    check(f"{label}: no import/export/require", not MODULE_SYNTAX.search(src))
    check(f"{label}: no banned globals or network access", not BANNED_GLOBALS.search(src),
          str(BANNED_GLOBALS.findall(src)))
    check(f"{label}: no prototype or built-in mutation", not PROTO_MUTATION.search(src))
    check(f"{label}: nothing that could break out of an embedded script tag",
          "</script" not in src.lower() and "<!--" not in src)

names_a = re.findall(r"registerProcessor\(\s*'([^']+)'", a)
names_b = re.findall(r"registerProcessor\(\s*'([^']+)'", b)
check("Registration names are unique across A and B", bool(names_a) and bool(names_b) and not set(names_a) & set(names_b))

check("A never mentions B", not re.search(r"\bwt-|PRISM|Synth B", a))
check("B never mentions A", not re.search(r"\bva-|VULCAN|Synth A", b))

URL_PATTERN = re.compile(r"https?://|//cdn\.|@import|<link\b|<script[^>]*\ssrc\s*=", re.I)
check("No external URLs or outside files in worklets or host template",
      not any(URL_PATTERN.search(s) for s in (a, b, host)))

HOST_NETWORK = re.compile(r"\b(fetch|XMLHttpRequest|WebSocket|sendBeacon|EventSource)\b")
check("Host makes no network calls", not HOST_NETWORK.search(host))
check("No fault-injection hook in the production build",
      not re.search(r"fault[_-]?inject|inject[_-]?fault|__fault|fault[_-]?hook|window\.__test", a + b + host, re.I))

# Build
ok_placeholders = host.count("{{WORKLET_A}}") == 1 and host.count("{{WORKLET_B}}") == 1
check("Host template has exactly one slot for each worklet", ok_placeholders)

dist = host.replace("{{WORKLET_A}}", a.rstrip() + "\n").replace("{{WORKLET_B}}", b.rstrip() + "\n") if ok_placeholders else ""
if dist:
    check("Built page embeds both worklets unchanged, no unfilled slots",
          a.rstrip() in dist and b.rstrip() in dist and "{{" not in dist)
    check("Built page has exactly three script blocks, all closed",
          dist.lower().count("<script") == 3 and dist.lower().count("</script>") == 3)

# Syntax checks with Node (parse only, nothing is run)
node = shutil.which("node")
if node and dist:
    def syntax_ok(text, name):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / name
            p.write_text(text, encoding="utf-8")
            r = subprocess.run([node, "--check", str(p)], capture_output=True, text=True)
            return r.returncode == 0, r.stderr.strip()

    for label, src, _ in ENGINES:
        good, err = syntax_ok(src, f"worklet-{label}.js")
        check(f"{label}: worklet parses as valid JavaScript", good, err)
    m = re.search(r'<script id="host-main">\n(.*?)</script>', dist, re.S)
    if m:
        good, err = syntax_ok(m.group(1), "host-main.js")
        check("Host script parses as valid JavaScript", good, err)
    else:
        check("Host script found in built page", False)
else:
    skip("JavaScript syntax checks", "node not found")

# Report
width = max(len(n) for n, _, _ in results)
for name, status, detail in results:
    line = f"{status}  {name}"
    if status != "PASS" and detail:
        line += f"   [{detail}]"
    print(line)

failed = [r for r in results if r[1] == "FAIL"]
passed = [r for r in results if r[1] == "PASS"]
skipped = [r for r in results if r[1] == "SKIP"]
print(f"\n{len(passed)} passed, {len(failed)} failed, {len(skipped)} skipped")

if failed:
    print("Build NOT written.")
    sys.exit(1)

OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
OUT_PATH.write_text(dist, encoding="utf-8")
print(f"Built {OUT_PATH.relative_to(ROOT)} ({OUT_PATH.stat().st_size} bytes)")
