# COLLAB: how Claude and GPT finish the Dual Synth together

Read this first. Both AIs and the producer work from this file. If something here is wrong or outdated, fix it in
a commit and say so in `comms/`.

Last updated: 2 November 2026 by Claude.

---

## 1. The goal, in one paragraph

One instrument delivered as **one standalone HTML file using Web Audio**: two completely separate synthesizers plus
a thin shared host.

- **Synth A (VULCAN-VA, Claude):** purely subtractive virtual analog. Dark, warm, gritty. Hypersaw and unison for
  trance. No wavetables. Vintage knob interface.
- **Synth B (PRISM-WT, GPT):** wavetable synth. Bright, airy, polished. Flat modern interface with animated
  waveform displays.
- **Host (GPT):** one MIDI/keyboard input sent to both, mixer (volume/pan/mute), glue compressor, master reverb,
  A/B panel switch, shared tempo.

The central rule is **total separation**: no shared oscillators, filters, envelopes, LFOs, modulation, effects or
presets; neither synth calls into the other's code. The full rules are in `docs/HANDOFF.md` section 4 and in the
contract (see section 9 below: the full contract text is still missing from this repo).

## 2. The people

| Who | Role |
|---|---|
| **Producer** | Trance/electronic producer, not a programmer. Authorizes work, listens, has the final say on sound. Carries things between the AIs when the repo is not enough. |
| **Claude** | Owns **Synth A**, build and packaging, the shared test spec and isolation tests, integration lead. Reviews GPT's host and Synth B against the contract. |
| **GPT** | Owns the **shared host** and **Synth B**. Reviews Synth A against the contract. |

Working rules (from the producer):

1. Explain things in plain language. He knows synths by ear.
2. Hand over **complete files that run**, not fragments.
3. **Be honest about what was and was not verified.** Never write "tests pass" unless they were run, and say
   where. Neither of us can hear audio. The producer decides what sounds good.
4. Never fabricate CPU or dropout numbers.
5. Original names, looks and sounds. Copy ideas and architecture from reference synths, never branding or content.

### Authorization record

- 2 Nov 2026: the producer authorized PK-01, then Synth A M1.
- 2 Nov 2026 (later): the producer said to use the GitHub repo as the communication channel, work in phases,
  review each other's code, and "finish the job". This **replaces the earlier "no GitHub" rule** and authorizes
  the phases below.
- **Still true:** his ears are the gate. His M1 listening verdict is still pending. Every phase ends with a
  listening checkpoint, and if he rejects a sound we go back and fix the DSP before building on top of it.
- Anything that changes the public engine interface, the isolation boundary or the scope must be written down in
  `comms/` and acknowledged by the other AI before it is built on.

## 3. Repo layout and who owns what

```
COLLAB.md                  this file (shared, both edit; keep edits small)
README.md                  one-screen overview
contract/                  the contract and the engine interface (shared; changes need both AIs)
docs/HANDOFF.md            the producer's project handoff (read-only history)
comms/
  claude-to-gpt/NNN-*.md   messages from Claude (Claude writes, GPT reads)
  gpt-to-claude/NNN-*.md   messages from GPT (GPT writes, Claude reads)
  reviews/                 review reports: REVIEW-<reviewer>-of-<thing>-<n>.md
  claude-status.md         Claude's own status page (only Claude edits)
  gpt-status.md            GPT's own status page (only GPT edits)
dual-synth/
  build*.py                builds + static checks (Claude owns; GPT may add host build steps, tell Claude)
  source/synth-a/          Synth A (Claude)
  source/synth-b/          Synth B (GPT)
  source/host/             shared host (GPT). m1-harness.html is Claude's throwaway test page for Synth A.
  tests/                   DSP and isolation tests. File prefix says the owner: a-*, b-*, host-*, iso-*.
  dist/                    built pages (generated; rebuilt by whoever changes the sources)
  verification/            real-browser check scripts and reports (Claude)
```

**Ownership rule:** only the owner edits an area. The other AI proposes changes by writing a review (see
section 6) or a patch file in `comms/`, never by editing the owner's source directly. This keeps the two
engines' code separate in history as well as at runtime.

**Merge conflicts:** `claude-status.md` and `gpt-status.md` exist so that nobody edits the same file. Messages
are new files with increasing numbers. `COLLAB.md` is the only file both edit.

## 4. How we talk to each other

1. **Messages** are Markdown files in `comms/<from>-to-<to>/NNN-short-title.md` with a numbered prefix
   (`001`, `002`, ...). Write them to be read cold: name contract sections ("4.2", "ISO-17") and flag anything
   changed. Start each with: `Phase: N | Needs reply: yes/no | Blocks: what`.
2. **Branches:** Claude works on `claude/new-session-cs8wq6`. GPT should work on its own branch (suggested name:
   `gpt/host-and-synth-b`) so history stays separable. The producer decides when to merge into a main
   branch. There is no `main` yet.
3. **If GPT cannot push to GitHub** (it can read but may not write), the fallback is: GPT gives the producer
   complete files, the producer drops them into the repo or sends them to Claude, and Claude commits them
   under `source/host/` / `source/synth-b/` with the message "Imported from GPT". Tell us in your first reply
   which route works.
4. **Poll rhythm:** at the start of each work session, pull, read new files in the other side's `comms/` folder,
   and reply before coding. At the end, update your status file and commit.
5. **The producer** can see everything here. Messages that need his decision are labeled `PRODUCER DECISION:` and
   collected in section 8.

## 5. Phases

The point of phases: while one of us is coding, the other is **not idle and not blocked**. Each phase lists what
both sides do in parallel, and where one waits for the other's code, what to do meanwhile.

Legend: **C** Claude, **G** GPT, **P** producer.

### Phase 0: Setup and alignment (now)

| | Work |
|---|---|
| **C** | Repo layout, this file, interface draft (`contract/ENGINE-INTERFACE.md`), first messages. Starts Phase 1 code immediately. |
| **G** | Read `COLLAB.md`, `docs/HANDOFF.md`, `contract/ENGINE-INTERFACE.md`, `comms/claude-to-gpt/*`. Reply with `comms/gpt-to-claude/001-ack.md`: can you push, which branch, what you disagree with in the interface draft, hardware figures you claimed (M1 Max Mac Studio? NUC?) and whether verified. |
| **P** | Paste the full contract v1.0 + amendments H1-H3 into `contract/CONTRACT-v1.0.md` (or give it to either AI to commit). Answer section 8 questions. Listen to M1 (`dual-synth/dist/DualSynth_A_M1.html`, Chrome, Mac Studio). |

**Exit:** GPT's ack received; interface draft agreed or amended; contract text in `contract/`.

### Phase 1: Cores in parallel (independent code, no waiting)

| | Work |
|---|---|
| **C** | **Synth A M2**: 3 oscillators + sub + noise, saw/pulse/PWM/triangle/sine, hard sync, hypersaw (7/9 blades, mono-safe width), 24 dB ladder + 12 dB multimode + "bite" filter, key tracking, filter FM, pre/post drive, resonance compensation, pitch bend, mod wheel, sustain, mono/legato/portamento, subtle drift with a lock-to-zero knob. Node DSP tests. Browser smoke test. |
| **G** | **Host skeleton**: AudioContext + START AUDIO, controller-based engine slots (loading Synth A's M2 controller and a Synth B placeholder through the interface only), note ledger, computer keyboard + Web MIDI, mixer (gain/pan/mute, smoothed), A/B panel switch (visibility only), panic/all-notes-off/transport-hold as five distinct actions, tempo + beat anchor. Host unit tests. |
| **P** | Listen to M1 and report; this decides whether M2 builds on M1's filter and saw character unchanged. |

**While waiting on each other:** C writes the **isolation test suite** (ISO-01..04, 05/06/14, 17, 18, 19) and
static scans against the *interface* (works with any engine). G drafts **Synth B's design doc** (table families,
voice structure, patch schema) into `comms/gpt-to-claude/` for Claude to review before code.

**Exit:** Synth A M2 and host skeleton are on the repo with tests that were actually run, and a short
"what was and was not verified" section in each author's status file.

### Phase 2: Cross-review and fix (short; each reviews the *other's* Phase 1 code)

| | Work |
|---|---|
| **C** | Review GPT's host skeleton against contract 4.2/4.3 using the review checklist (section 6). Run the isolation tests against it. File `REVIEW-claude-of-host-1.md`. Meanwhile fix anything GPT reports on Synth A. |
| **G** | Review Synth A M2 (DSP correctness, interface conformance, anything that breaks isolation, edge cases). File `REVIEW-gpt-of-synth-a-m2-1.md`. Meanwhile fix anything Claude reports on the host. |

**Exit:** all severity-1 and severity-2 findings fixed or explicitly deferred with a reason; reviewer re-ran the
relevant tests and says so.

### Phase 3: Modulation/sequencing and the second engine's core

| | Work |
|---|---|
| **C** | **Synth A M3**: 3 LFOs, 16-slot mod matrix, 16-step modulation lane, arp, 16/32-step trance gate, private effects (tape saturation, chorus, flanger, phaser, BBD-style delay, plate reverb), clock integration. The contract's request/ack/revision protocol and patch compiler. |
| **G** | **Synth B M1** (hard gate: producer's listening verdict): 2 wavetable oscillators + sub + noise, first set of table families, phase-aware interpolation, band-limited playback tables, a filter, envelopes, unison. Host increments: mixer polish, glue compressor, master reverb. |
| **P** | Listening verdicts on Synth A M2 and Synth B M1. |

**While waiting:** whoever finishes first reviews the other's design/code of this phase and writes the next
phase's test plan (AQ-01..23 audio tests are Claude's spec; GPT adds Synth B specific cases).

**Exit:** both engines have their core and modulation, tests run, producer verdicts recorded.

### Phase 4: Cross-review 2

Same as Phase 2 on the Phase 3 code. Additionally: **each AI runs the other's engine under the same static
scans and isolation tests** and reports results (not just reading code).

### Phase 5: Integration (M4)

| | Work |
|---|---|
| **C** | Packaging: single standalone HTML with two separate Blob-or-fallback worklet modules from separate source trees (see decision D1), build checks, real-browser verification, level calibration between engines, compressor tuning together with G. Runs all ISO and AQ tests on the integrated build. |
| **G** | Wire the real engines into the host through the controller interface only. Fix host issues found by integration tests. Synth B M2/M3 (remaining modulation, effects, arp, gate) in parallel. |
| **P** | Listening: both engines together, level balance, host behavior. |

### Phase 6: Presets (M5)

Both: 64 original factory presets per engine, calibrated by category with at least 6 dB sample-peak headroom
on designated calibration patches; preset browser; save/revert; import/export; persistence; recovery slot;
generations and held-voice continuity. Each reviews the other's preset set for loudness and category balance
(numbers only; the producer picks what sounds good).

### Phase 7: Final cross-review, QA and release candidate

Both: full test run on the integrated build, real-browser verification on the producer's actual machines,
`docs/KNOWN-LIMITS.md` written together (honest list), final review of each other's code ("make it better"):
simplification, performance, clearer controls. Release candidate for the producer's sign-off.

## 6. Review and debugging protocol

**What a reviewer does**

1. **Read** the code against the contract and the checklist below.
2. **Run** it: builds, static scans, tests, and where possible a real browser. A review that only read the code
   says so.
3. **Reproduce** each suspected defect with the smallest input you can (a test case, a message sequence, a
   parameter set). A finding with no reproduction is marked `UNREPRODUCED`.
4. **Write** `comms/reviews/REVIEW-<reviewer>-of-<thing>-<n>.md` with findings in this shape:

```
### F-01  [S1|S2|S3|S4]  short title
Where: file:line
What: one sentence
Repro: exact steps or test snippet
Expected / Actual:
Suggested fix: (optional; the owner decides)
Status: open | fixed in <commit> | deferred (reason) | disagree (reason)
```

Severity: **S1** breaks isolation, crashes, or violates a normative (N) contract item. **S2** audible defect,
wrong behavior, data loss. **S3** quality/clarity/performance. **S4** nit.

**What an owner does:** fix S1/S2 first, reply to each finding in the same file (status line), re-run the
tests, commit with the finding IDs in the message. If you disagree, say why and let the reviewer answer once.
If still stuck, mark `PRODUCER DECISION:`.

**Review checklist**

- Separation: any shared state, shared registration names, cross-mentions, calls across the boundary?
- Interface (contract 4.2): events, control requests, acks, no per-note ack, immutable engine ID, session ID,
  stereo output, Shadow DOM panel with scoped CSS, idempotent dispose.
- Worklet rules: single strict-mode IIFE, no `Math.random`, no globals, no allocation in `process()`,
  subnormals handled in feedback paths, non-finite samples contained and counted.
- Real-time: block-boundary commits, bounded work per block, voice limit and stealing behave.
- Honesty: status messages are counters not made-up numbers; every "tested" claim names the environment.
- Sound-facing sanity: levels (6 dB headroom on calibration patches), clicks at note on/off and preset change,
  smoothing of everything that is turned live, determinism.
- Usability: every control reachable by keyboard, double-click reset, readable values.

## 7. Definition of done (per milestone)

1. Builds with every static check passing (list them in the status file).
2. DSP tests written and **run**; output pasted or summarized with counts.
3. Real-browser smoke test run (or explicitly "not run").
4. Reviewed by the other AI, S1/S2 closed.
5. Producer listening verdict recorded (his ears; ours is numbers only).
6. Status file updated; open risks listed.

## 8. Open decisions (PRODUCER DECISION)

| # | Question | Status |
|---|---|---|
| D1 | **How the page loads each worklet.** Verified 2 Nov: Blob-URL `addModule` fails on `file://` (Chromium; likely the cause of the Safari "module failed"). Options: (a) `data:` URL fallback (M1 already has it), (b) localhost launcher. Both are disclosed deviations from contract 4.8. Recommended now: (a), then verify in Safari. | **Open** |
| D2 | Confirm the unconfirmed defaults: one shared BPM; 64 presets per synth; 8 voices (up to 16); browser save + file export/import; per-synth transpose and trim; held notes keep their sound after a preset change; ring mod and waveshaping allowed in A; arp stop does not drop into direct play. | **Open** |
| D3 | Test target machine and browser: the 2015 MacBook Pro in Safari is the weak case. Mac Studio with Chrome? | **Open** |
| D4 | MIDI keyboard or computer keys? | **Open** |
| D5 | Hardware figures GPT claimed (M1 Max Mac Studio 32 GB, NUC 12 i7-12700H): confirmed? | **Open** |
| D6 | Final names (VULCAN-VA, PRISM-WT are provisional). | **Open** |
| D7 | M1 listening verdict (sound and control usability). | **Open, pending** |

## 9. Known gaps in this repo (be honest about them)

- **The full contract text is not in the repo.** Only the summary in `docs/HANDOFF.md` section 4 exists, plus
  `contract/ENGINE-INTERFACE.md`, which Claude drafted from that summary and the as-built M1 controller. Where we
  go beyond the summary we mark it `U` (unconfirmed) until the producer supplies the contract.
- **Nothing has been heard.** All sound judgments are the producer's. Our numbers prove it is finite, stable,
  in tune, not clipping and deterministic, not that it sounds good.
- **No CPU numbers exist** for the producer's machines. Do not quote any.
- **Safari is unverified** for everything. Chrome/Edge are the primary targets (Safari also lacks Web MIDI).
- **GPT's code does not exist yet**, and neither does its environment's result of any test. Its claims in the
  handoff about hardware are unconfirmed.

## 10. Who does what next (right now)

1. **Claude:** (this commit) repo + COLLAB + interface draft; then Synth A M2 on this branch.
2. **GPT:** reply `comms/gpt-to-claude/001-ack.md`; then host skeleton on your branch.
3. **Producer:** contract text into `contract/`; section 8 answers; M1 listening.
