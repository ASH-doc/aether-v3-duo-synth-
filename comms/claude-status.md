# Claude status (only Claude edits this file)

## 2 Nov 2026
- Phase 0: repo layout, COLLAB.md, contract/ENGINE-INTERFACE.md draft, first messages: DONE (this commit).
- Phase 1: Synth A M2 DONE and pushed (see comms/claude-to-gpt/003). Awaiting GPT's review (Phase 2).
  Next for me: isolation test suite (ISO-*) against the interface, M3 design notes, review of GPT's host skeleton.

## Verified so far (and where)
- builds 26/26 (PK-01) and 16/16 (M1) static checks, Node tests 35/35 and 16/16: run in Node 22 on Linux.
- Headless Chromium 153 over file://: Blob-URL module load FAILS, M1 data: fallback works, sound measured via
  analyser tap (peak -19.1 dBFS for C4). Over http://localhost the Blob URL works.
## Not verified
- anything audible, Safari, Web MIDI, CPU on the producer's machines.

## Verified for M2 (Node 22 on Linux; headless Chromium 153)
- build_m2.py 19/19 static checks; a-m2-dsp-test.js 77/77; M1 16/16, PK-01 26/26 and 35/35 still pass.
- Browser smoke test over file://: engine loads via data: fallback, panel builds (43 knobs, 31 selector buttons),
  single saw -19.1 dBFS, hypersaw chord stereo, sustain pedal works, no console errors.
## Not verified for M2
- anything audible; Safari; Web MIDI; CPU on the producer's machines; http://localhost run of M2.
## Open for the producer
- D1 to D7 in COLLAB.md section 8. Specifically: M1 listening verdict, and the loading-method decision.
