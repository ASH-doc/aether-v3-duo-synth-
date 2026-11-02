# Browser check, 2 November 2026 (Claude)

Environment: headless Chromium 153 (Playwright) on Linux, 44.1 kHz AudioContext, no speakers.
Audio was measured by an analyser tapped onto whatever connects to the destination.
Tree used: byte-identical to dual-synth/ as uploaded (rebuilt with build.py / build_m1.py, diff -r clean).

Node: build.py 26/26, build_m1.py 16/16, pk01-dsp-test 35/35, m1-dsp-test 16/16.

| Page                          | file://                                   | http://localhost |
|-------------------------------|-------------------------------------------|------------------|
| DualSynth_PK01.html           | A and B: Blob module FAILED (AbortError, blob:null/...) ; silent | both load, peak -14.2 dBFS |
| DualSynth_A_M1.html           | Blob FAILED, data: fallback loads; C4 peak -19.1 dBFS; silent before/after | Blob loads; same level |

Conclusion: AudioWorklet modules cannot be loaded from a Blob URL on a file:// page (opaque origin).
Same symptom as the producer's Safari "module failed". Not verified in Safari itself.

Not checked: sound quality (needs his ears), Web MIDI (headless blocked it), CPU on his machines,
Safari behaviour of the data: fallback.

Rerun: npm i playwright (or use a preinstalled one), then
  node verification/browser-check.js dist/DualSynth_A_M1.html m1 out.png
  node verification/browser-check.js dist/DualSynth_PK01.html pk01 out.png
