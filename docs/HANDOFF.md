# DUAL SYNTH: project summary and handoff for Claude Code

Status as of 2 November 2026. Read this whole file before touching anything.

## 1. How to work with the producer

- He is a trance and electronic music producer, **not a programmer**. He knows synths by ear. Explain in plain language and design from a player's point of view.
- Give **complete files he can drop in and run**, never fragments or patches.
- Be honest about what is and is not verified. Never claim a test passed unless it was actually run. You cannot hear audio; he decides what sounds good.
- Do not build beyond the step he has authorized. Changes to the public interface, the isolation boundary or the scope need his approval (and GPT's, while GPT owns the host and Synth B).
- He moves complete files between AIs by hand. No GitHub. If he asks for a message to GPT, write it concisely and self-contained, naming contract sections (for example "section 5.8" or "ISO-17") and flagging anything changed.

## 2. The project in one paragraph

One instrument, delivered as **one standalone HTML file using Web Audio**, containing two completely separate synthesizers plus a thin shared host. Original names, panel looks and sounds: copy architecture and ideas from reference synths, never their branding, artwork or factory content.

- **Synth A (provisional name VULCAN-VA):** purely subtractive virtual analog. A mix of Spire, u-he Diva and Access Virus TI, with Diva the main target. Dark, warm, gritty. Hypersaw and unison for trance. **No wavetables.** Vintage-hardware, knob-based interface.
- **Synth B (provisional name PRISM-WT):** wavetable synth inspired by Massive, Serum, Korg Modwave and Arturia Pigment. Bright, airy, polished, digital. Flat modern interface with animated waveform displays.
- **Host:** receives MIDI and keyboard once and sends the same events to both. Mixer (volume, pan, mute per synth), glue compressor and master reverb on the summed output, and an A/B switch that only changes what is visible. Each synth has its own private effects and a large preset bank (provisional: 64 each).

**The central rule is total separation.** No shared oscillators, filters, envelopes, LFOs, modulation, effects or presets, and neither synth calls into the other's code. The only shared things are keyboard and MIDI input, the shared tempo and beat anchor, and the host mixer and master processing.

## 3. Ownership (as agreed in the contract negotiation)

| Who | Owns |
|---|---|
| Claude | Synth A, build and packaging, audio test spec, browser verification where possible, integration lead |
| GPT (separate chat) | Shared host, Synth B, isolation tests |
| The producer | Authorizes work, carries files by hand, listens to milestones, final say on sound |

This was the plan in the **DUAL SYNTH Architecture & Interface Contract v1.0** (v1.0-RC plus amendments H1 to H3), signed by both AIs at the specification level over 9 negotiation rounds. Neither AI's agreement authorizes implementation; only the producer does. Earlier plans (Codex plus Gemini building the engines, a GitHub-based workflow, a VST/AU plugin target) are superseded. Confirm with him if ownership changes now that the work moves to Claude Code.

## 4. Architecture (contract summary)

Labels: **N** normative, **T** target, **R** recommended, **D** deferred, **U** unconfirmed.

### 4.1 Separation and isolation
- **N** Each engine has its own worklet processor, registration name (`va-*` for A, `wt-*` for B), controller and port, DSP state, voices, effects, modulation, RNG, patch compiler and schema, and UI.
- **N** Each worklet is one independently encapsulated strict-mode IIFE with no top-level bindings except the registration, no global, prototype or standard-API mutation, **no `Math.random` in DSP** (private seeded RNG instead), and no bundling that merges the two scopes.
- **N** The guarantee is strong logical and DSP-state isolation with best-effort fault containment. There is **no CPU or memory isolation**: both engines run on one audio thread.
- **N** Panel switching never resets voices, reloads presets, clears effects, restarts sequencers, disposes processors or suspends the context.
- Each engine is **one processor** with its effects inside, built in **two halves**: a main-thread half (UI, presets, validation, patch compiler producing typed arrays) and a worklet half (render, commit at block boundaries).

### 4.2 Host-to-engine interface (N)
- The host never touches an engine's port, only its controller. Creation is async. The controller exposes an immutable engine ID, a session ID, one **two-channel stereo** AudioNode, one self-contained panel root (Shadow DOM, scoped CSS), ready/capabilities, event methods, patch methods, status/error subscriptions and dispose.
- **Events:** `noteOn` (noteId, note, velocity, channel, optional time, optional batchId), `noteOff` (noteId, optional time), `pitchBend` (-1..1), `modWheel` (0..1), `sustain`, `allNotesOff`, `panic`. There is **no ack per note**. Live notes are never delayed for preset loading. Grouped notes arrive as one atomic batch.
- **Control requests:** `loadPatch`, `getPatch`, `resetToInit`, `setParam`, `setClock`, `setQuality`, `setVoiceLimit`, `setSeed`, `dispose`. Each carries `sessionId`, `requestId` and `revision`. Acks are `applied` (with `committedFrame`), `pending`, `rejected` or `superseded`. Stale acks are ignored. A ~2 s timeout is diagnostic ("stalled"), never an automatic "failed".
- **Patch pipeline:** the main-thread compiler validates and converts to bounded typed arrays; the worklet commits atomically at a block boundary and range-checks defensively. No JSON parsing, table building or unbounded allocation in the render path.
- **Status** is pushed about 4 times a second, counters only. **Never fabricate CPU or dropout numbers.**
- Disposal is idempotent and never waits on a dead worklet. Restart order: new session, patch, clock, controllers, held notes.

### 4.3 Lifecycle, mixer, MIDI, clock
- The host owns the AudioContext. START AUDIO needs a user gesture. A failed engine must not block the other.
- Mixer: A and B each go through gain/pan/mute, then sum, glue compressor and master reverb, then out. All smoothed. **Mute acts only post-engine** (the engine keeps running its arp, modulation and effects).
- **Note ledger:** source, channel, original pitch, dispatched pitch, velocity, noteId, destination session, physical-key state. Note-off uses the ledger, never the current transpose. An unknown noteOff is ignored silently.
- **Clock:** BPM, integer frame anchor, anchor beat, running, effective frame and revision, in AudioContext frames, with about 100 ms lead for planned changes. Default tempo 138 BPM. v1 host controls (R/U): BPM, tap tempo, Resync to beat 0.
- Window blur releases computer-keyboard notes only; external MIDI notes stay. A MIDI disconnect releases that source's notes. On context suspension: detect `statechange`, preserve state, resume, reconcile the ledger, show an indicator.
- **Five distinct actions:** panel switch, transport hold, all-notes-off, panic, engine restart. Panic stops new notes, fades both engines (about 20 ms), clears the master reverb, resets the ledger, and never erases presets.

### 4.4 Presets and persistence
- **N** Each engine has its own factory and user presets, schema, browser, save/revert and import/export.
- **N** **Generations:** 4 fixed slots (FREE/LIVE/RETIRED/FADING), up to 16 voices, 1 live plus up to 2 retired plus up to 1 fading. Retired generations are immutable and no slot is overwritten while any voice references it. Pending loads are latest-wins and every superseded request gets a terminal ack. Held voices keep their sound across a preset change. One private effects chain per engine, so outgoing voices may pass through the new effects (documented).
- **N** Storage keys are namespaced `dualsynth.A.*` and `dualsynth.B.*`, with a storage-availability check, honest save status, an Unsaved Changes indicator, JSON export/import in an envelope `{engine, format, schema, payload}`, engine-owned migrations and a recovery slot. Malformed patches are rejected and the last committed patch is kept.
- **T** 64 original factory presets per engine (leads, plucks, supersaws, basses, pads, arps, gated sounds), calibrated by category, with at least 6 dB of sample-peak headroom on designated calibration patches.

### 4.5 CPU, memory, quality
- **T** Each engine alone under 30% of the render block (p99), the pair under 60%, measured externally on named hardware (record hardware, browser, sample rate, preset, voice count, quality tier).
- **N** Quality tiers Eco / Studio / Offline, **fixed per voice at allocation**, so a tier change never retunes held voices. Handle subnormals in feedback paths, preallocate buffers, no per-sample allocation. Default 8 voices, up to 16.

### 4.6 Synth A feature set (N unless noted)
- 3 oscillators plus sub and noise: saw, pulse with PWM, triangle, sine, hard sync. (R: ring mod and waveshaper, awaiting approval.) **Wavetables, additive and spectral synthesis are prohibited.**
- Hypersaw: 7 blades default, 9 max, with original nonlinear detune/balance curves and a **mono-safe** width control.
- Filters: 24 dB ladder, 12 dB multimode, "bite" 12 dB. Pre- and post-drive, resonance compensation, key tracking, filter FM.
- 3 envelopes, 3 LFOs, a 16-slot mod matrix, a 16-step modulation lane, arp, 16/32-step trance gate, mono/legato/portamento.
- Drift is subtle with an amount knob that locks to zero. Slew and envelope curves are deterministic. **No random timing jitter.**
- Private effects: tape saturation, chorus, flanger, phaser, BBD-style delay, plate reverb.
- Dark vintage hardware look, knob-based, with a secondary page for the matrix.

### 4.7 Synth B feature set (GPT builds it; Claude reviews it against the contract)
2 wavetable oscillators plus sub and noise, at least 32 original harmonic-domain table families, phase-aware interpolation and band-limited playback tables, up to 16 unison lanes per note, two filters (serial/parallel), 4 envelopes, 4 LFOs, an independent 16/32-step modulation source, a 32-slot matrix, its own arp and gate, private clean effects, and displays that show real state.

### 4.8 Packaging (N)
One standalone HTML, **no external URLs, no third-party libraries**, each worklet a separate Blob module from separate source trees, modular source kept. If `file://` double-click fails, a localhost launcher is a **disclosed deviation needing his approval**.

## 5. Decisions made

- Two engines, total separation, one thin host. Original names (provisional: VULCAN-VA and PRISM-WT).
- Web Audio in a single HTML file as the delivery target. The earlier VST/AU idea is not part of this plan.
- Contract v1.0 is the specification. Thresholds for audio tests are set only after reference builds exist. Numeric tests catch breakage; **his ears decide musical quality.**
- Milestones: PK-01 (packaging), then M1 as a **hard gate per engine** (he must give a listening verdict on sound and control usability; if he rejects it, return to core DSP), then M2 full engines, M3 effects/arp/gate/modulation, M4 integration and compressor tuning, M5 presets.
- Authorization history: he authorized PK-01. PK-01 produced no sound for him (see section 7). He then told Claude to go ahead with Synth A regardless, so **M1 for Synth A was built and is awaiting his listening verdict.** Nothing beyond M1 is authorized.
- Proposed defaults he has **not yet confirmed**: one shared BPM; 64 presets per synth; 8 voices up to 16; browser save plus file export/import; per-synth transpose and trim (an addition to his brief); held notes keep sound and gating after a preset change; ring mod and waveshaping allowed in A; arp stop does not drop into direct play.
- Open questions still unanswered: whether the approval-sheet defaults above are accepted; which computer and browser are the real test target (so far he tested on a 2015 MacBook Pro in Safari, and he also owns a Mac Studio); whether he plays a MIDI keyboard or the computer keys; and the hardware figures GPT claimed (Apple M1 Max Mac Studio 32 GB, Intel NUC 12 i7-12700H 32 GB), which are **unconfirmed**.

## 6. Current state of the code

Project folder layout:

```
dual-synth/
  build.py                     PK-01 build and static checks
  build_m1.py                  Synth A M1 build and static checks
  source/
    synth-a/
      pk01-worklet.js          PK-01 test tone (va-pk01, 220 Hz sine, about -20 dBFS)
      params.json              Synth A M1 parameter table (single source of truth)
      m1-worklet.js            Synth A DSP half (template; build injects params.json)
      m1-panel.js              Synth A controller and Shadow DOM panel (template)
    synth-b/
      pk01-worklet.js          PLACEHOLDER (wt-pk01, 330 Hz triangle); GPT's real Synth B replaces it
    host/
      pk01-host.html           PK-01 page
      m1-harness.html          THROWAWAY test page for M1, not the real host
  tests/
    pk01-dsp-test.js           Node test of the PK-01 worklets
    m1-dsp-test.js             Node test of the M1 worklet
  dist/
    DualSynth_PK01.html        built PK-01 page
    DualSynth_A_M1.html        built M1 page
    va-m1-worklet.js           built M1 worklet (used by the Node test)
```

Commands: `python3 build.py`, `python3 build_m1.py`, `node tests/pk01-dsp-test.js`, `node tests/m1-dsp-test.js`. Both builds write `dist/` only if every check passes.

### What was actually run
- **PK-01:** 26 static checks passed (strict single-IIFE worklets, no banned globals, prototype mutation, `Math.random`, import/require, unique registration names, no cross-mentions, no external URLs or network calls, no fault hook, valid JavaScript). Six deliberately broken copies were all rejected. The Node test (35 passes) confirmed about -20 dBFS peak, correct pitch, no NaN, no clicks, and identical left/right at 44.1 and 48 kHz.
- **M1:** 16 static checks passed. The Node test (16 passes) confirmed A4 at 440.4 Hz; a four-note full-velocity chord on the default patch peaks at -6.1 dBFS (just inside the 6 dB headroom target); worst-case settings with 8 notes stay finite with a peak of -1.5 dBFS; voices free after release; the voice limit and stealing behave (8 sounding, 12 stolen when 20 notes are held); panic clears everything within about 20 ms; two identical runs are bit-identical; and 44.1, 48 and 96 kHz in both quality modes stay finite.
- **Never run:** any real browser, `file://` loading, anything audible, and CPU load on any of his machines.

### M1 design (Synth A worklet)
- **Voice:** one polyBLEP saw, free-running phase reset to 0 on a free voice (not reset on a steal). Pitch is `440 * 2^((note-69)/12)` times a global octave/fine ratio.
- **Filter:** 4-pole ladder with a rational soft saturator in every stage and a one-sample feedback delay. Resonance 0..1 maps to feedback `k = 4 * res`. Input gain is `dg * (1 + 0.5k)` where `dg = 1 + 14 * drive^2`, with output makeup `0.35 / sqrt(dg)`. Filter coefficients update every 16 samples. **Studio** mode runs the filter twice per sample (linear-interpolated up, averaged down) and is a basic 2x only. **Eco** runs once. The tier is fixed per voice at allocation.
- **Envelopes:** two ADSRs per voice (filter and amp). Linear attack, exponential decay and release (time constant `T/6.9`), minimum 1 ms. Filter cutoff is `2^(log2(cutoff) + envAmt * env * velScale)` octaves.
- **Velocity:** to amp level (`avel`) and to filter envelope depth (`fvel`).
- **Voices:** 16 allocated, limit 8. Stealing takes a free voice, else the quietest releasing voice, else the oldest held voice.
- **Output:** own rational soft clipper limits the final output to +/-1 (it colors loud signals slightly). A non-finite sample is zeroed and counted.
- **Smoothing:** cutoff, resonance, drive, envelope amount and volume are smoothed at the control rate. Other parameters apply directly at block boundaries.
- **Panic:** 20 ms fade to zero, then all voices cleared; new notes are ignored during the fade.
- **Messages from the controller:** `noteOn`, `noteOff`, `allNotesOff`, `panic`, `param`, `patch`, `quality`, `voices`. The worklet validates and clamps everything and posts a status message (voices, steals, repaired samples) about 4 times a second.
- **Default patch (starting guesses, not tuned by ear):** cutoff 900 Hz, resonance 35%, drive 25%, envelope amount +3.5 oct, velocity to filter 40%, filter env A 1 ms / D 280 ms / S 25% / R 220 ms, amp env A 3 ms / D 400 ms / S 80% / R 180 ms, velocity to level 50%, volume 70%.
- **Panel:** Shadow DOM, 17 knobs in five groups (Oscillator, Filter, Filter envelope, Amp envelope, Output). Drag (Shift for fine), arrow keys, wheel, double-click to reset. Each knob is a keyboard-focusable ARIA slider.

### Differences from the contract in M1 (disclose these)
- The `data:` URL fallback for module loading (used only if the Blob URL fails) is a **deviation needing his approval**, or remove it.
- The request/ack/revision protocol and `sessionId`/`requestId` machinery are not built; `setParam` is fire-and-forget. A note's scheduled `time` is ignored.
- The 2x filter is crude and resonance compensation is a fixed rough amount. Self-oscillation tracking at high cutoff is **unverified** because of the one-sample feedback delay.
- Not in M1: key tracking, pitch bend, sustain pedal, glide, the other oscillators, hypersaw, the other filters, LFOs, matrix, arp, gate, effects, presets, persistence, generations.
- `m1-harness.html` is a throwaway test page (START AUDIO, computer keys, on-screen keys, Web MIDI, panic, log) so the producer can play the engine. It is not the real host.

## 7. Known problems and unverified items

1. **PK-01 produced no sound for him.** He ran it on a 2015 MacBook Pro in **Safari** and the page reported "module failed" (he could see the page and panels). He did not send the exact log line, so **the cause is unknown**. Hypotheses, none verified: Safari handling of AudioWorklet modules loaded from Blob URLs, `file://` origin restrictions, or an old Safari. Chrome and Edge are the contract's primary targets; Safari also lacks Web MIDI. The M1 page logs the exact error from both the Blob and `data:` attempts, so his next run will show the real reason.
2. **M1 may hit the same wall.** It uses the same loading method. If he reports "module failed" again, get the log line first; do not guess.
3. **No audio has been heard.** Sound quality, control feel and CPU on his machines are all unknown. If the 2015 MacBook crackles, try Eco quality.
4. Double-click `file://` operation, MIDI permission and storage behavior are unverified until run in a real browser.

## 8. What is still to build

### Immediate
1. Get the **real browser result**: have him run `dist/DualSynth_A_M1.html` in Chrome (ideally on the Mac Studio) and send the log. If Claude Code on his Mac has a real browser, verify for real and report exactly what was run and seen.
2. If Blob loading fails in Chrome too, propose the fallbacks (data URL, then a localhost launcher) and get his approval before adopting either.
3. Get his **listening verdict on M1** (sound and control usability). This is the hard gate. If rejected, return to core DSP (filter feel, saw character, envelope shapes, drive, resonance behavior).
4. Get his answers to the open questions and approval-sheet defaults in section 5.

### After M1 passes (each step needs his go-ahead)
- **M2, full Synth A:** three oscillators plus sub and noise, hypersaw (7/9 blades, mono-safe width), pulse/PWM, sync, 12 dB multimode and "bite" filters, key tracking, filter FM, pre/post drive, resonance compensation, pitch bend, mod wheel, sustain, mono/legato/portamento, subtle drift with a lock-to-zero knob, deterministic slew.
- **M3, modulation and sequencing:** 3 LFOs, 16-slot mod matrix, 16-step modulation lane, arp, 16/32-step trance gate, private effects (tape saturation, chorus, flanger, phaser, BBD delay, plate reverb), shared clock integration.
- **M4, integration:** wire to GPT's host, glue compressor tuning, level calibration between engines, review GPT's host and Synth B against the contract, run the isolation tests.
- **M5, presets:** 64 original factory presets with the calibration rules, the preset browser, save/revert, import/export, persistence, recovery slot, generations and held-voice continuity.
- **Contract machinery still missing for Synth A:** the full control-request/ack protocol, patch compiler to typed arrays with generations, voice-quality tiers beyond Eco/Studio (Offline), the ready event and status fields, restart and disposal semantics.
- **Tests to write and actually run:** static scans, ISO-01..04, 05/06/14, 17, 18, 19 (stereo routing), MIDI/timing ISO-07..09, 12, 13, preset ISO-10, 11, 20 and generation-eviction cases, and the AQ-01..23 audio tests (aliasing, pitch accuracy, drift bounds, hypersaw mono collapse under about 3 dB at default width, level calibration, stereo balance, filter self-oscillation tracking, cutoff zipper, envelope timing, click detection, preset-change artifacts, panic fade, dense-chord stability, long-session stability, determinism, sample-rate independence, effect independence). Fault injection only in a **test build**, with a static check that the production build has no hook.
- **GPT's side:** the real host, the real Synth B and its isolation tests. Claude reviews them against the contract and integrates them.

### Deferred (D)
MIDI Learn, MPE, MIDI clock input, per-generation effects chains, paired A/B scenes, queued-note audition mode, sample import, third-party libraries, any cross-engine feature.

## 9. Known limits to state honestly
- Cannot match commercial plug-ins' tuning on day one.
- No perfect anti-aliasing under arbitrary modulation.
- No CPU isolation on one audio thread.
- Safari lacks Web MIDI; Chrome and Edge are the primary targets.
- Claude cannot hear audio; the producer decides what sounds good.

## 10. Suggested first moves in Claude Code
1. Run the two builds and two Node tests to confirm the folder works on his machine.
2. Use a real browser (Chrome, via the Chrome tools or a headless setup) to load `dist/DualSynth_A_M1.html` and `dist/DualSynth_PK01.html`; record exactly what loads and what the log says.
3. Report results, ask the open questions, and **wait for his M1 verdict** before writing anything new.
