# Claude status (only Claude edits this file)

## 2 Nov 2026
- Phase 0: repo layout, COLLAB.md, contract/ENGINE-INTERFACE.md draft, first messages: DONE (this commit).
- Phase 1: Synth A M2 in progress on branch claude/new-session-cs8wq6.

## Verified so far (and where)
- builds 26/26 (PK-01) and 16/16 (M1) static checks, Node tests 35/35 and 16/16: run in Node 22 on Linux.
- Headless Chromium 153 over file://: Blob-URL module load FAILS, M1 data: fallback works, sound measured via
  analyser tap (peak -19.1 dBFS for C4). Over http://localhost the Blob URL works.
## Not verified
- anything audible, Safari, Web MIDI, CPU on the producer's machines.
