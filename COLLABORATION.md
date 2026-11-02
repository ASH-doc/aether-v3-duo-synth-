# DUAL SYNTH — shared work and review log

Updated 2026-11-02 by Codex. Start here on every session.

## Producer direction and decision authority

The producer now explicitly requests GitHub collaboration, code handoffs, reciprocal
review, and phased completion. This supersedes older statements saying "No GitHub"
and "move files by hand". Work may proceed in owned areas in testable increments.
It does not constitute a listening verdict or acceptance of an undocumented contract
change. M1 musical approval remains a hard gate **per engine** before M2/M3 expansion.
Only the producer can approve sound and control feel.

The complete Architecture & Interface Contract v1.0 and H1–H3 are still absent.
Use `handoff-bundle/dual-synth/HANDOFF.md` section 4 as the working summary, marking
additional assumptions unconfirmed. Do not invent exact ISO definitions, wire
payloads, acceptance thresholds, or claim full contract compliance.

## Verified starting point

- Imported base: `78835913e59b685b81923834769b1e9cdf13e8cf`, branch
  `claude/new-session-cs8wq6`.
- Source root: `handoff-bundle/dual-synth/`. Edit modular source here. The ZIP is an
  historical transfer artifact, not the authoritative working tree.
- A: VULCAN-VA M1 exists. B: only `wt-pk01`, a triangle test tone. There is **no
  PRISM-WT M1** in this baseline. The initial producer handoff's contrary statement
  is superseded by source inspection and Claude's MESSAGE-TO-GPT.md.
- Host: PK-01 page and temporary A listening harness; no complete shared host.
- Codex H-01: standalone host note ledger and 10 tests, awaiting Claude review.
  It is not wired into the existing pages and is not a playable instrument.
- Codex H-02a: fixed the temporary A harness MIDI device/channel ownership,
  targeted disconnect/CC123 release, and All Notes Off/Panic ownership cleanup.
  Seven regression tests pass; rebuilt A listening HTML included.
- M1 listening approval: A pending; B cannot be evaluated until built.
- Full contract: requested from producer, still pending.

## Ownership and working together

| Area | Author | Required peer reviewer |
|---|---|---|
| A controller, UI, DSP, presets, private effects | Claude | Codex |
| B controller, UI, DSP, presets, private effects | Codex | Claude |
| Shared host and isolation tests | Codex | Claude |
| Final build/packaging, audio test plan, integration lead | Claude | Codex |
| Musical acceptance, target machines, contract decisions | Producer | Both report evidence |

Never share engine DSP helpers, mutable state, presets, effects, RNGs, or modulation.
The host calls public controllers, never their ports or internal voice state.
Reviewing another owner's code is encouraged; propose fixes with regression evidence
and let that owner implement them unless explicitly agreed otherwise.

### GitHub handoff protocol

1. Fetch current remote refs at the start of a session. Read this note and new
   `reviews/` entries. Use the existing checkout: cloud tasks are already isolated;
   do not create worktrees unless the producer asks.
2. Work on a named task branch (`codex/<task>` or `claude/<task>`). State base SHA,
   owned files, deliverable, and dependency here or in its PR before overlapping work.
3. Keep commits small and runnable. Push complete source, tests, and build outputs
   when changed. Never force-push a colleague's branch or overwrite unrelated work.
4. Submit a PR when API access permits; otherwise publish the branch plus a review
   note naming it. Include commands, exact outcomes, known failures, and limitations.
5. Reviewer fetches the branch and executes tests, reviews interfaces/isolation,
   malformed input, note lifecycle, DSP stability, and regression risks. Record
   severity, file/function, reproduction, and requested correction in `reviews/`.
6. Author fixes findings on that branch. Reviewer reruns affected checks against the
   new SHA. Author self-review is never recorded as peer approval.
7. Integrate after review and applicable musical gates. Claude coordinates packaging;
   do not silently declare the current default branch or a new `main` integration-ready.
8. At phase completion, review both components together, address findings, then rerun
   relevant integration/isolation checks. Record the reviewed SHAs and verdict.

GitHub is an asynchronous mailbox, not an automatic way to execute the other AI.
Neither agent may claim the other read, reviewed, or approved a handoff without a
reply. Check at session start, before shared-interface edits, and before completion;
do not wait in a polling loop. While blocked, work on independent owned tasks below.

## Phased delivery plan

| Phase | Codex work | Claude work in parallel | Exit evidence / gate |
|---|---|---|---|
| 0 — establish baseline | Reproduce builds/tests; inspect A and host; publish H-01 ledger for review | Review H-01; answer interface findings; prepare A listening candidate | Reproducible baseline, findings assigned, contract gaps recorded |
| 1 — M1 per engine | Build an original, bounded B listening prototype: tables prepared off render thread, oscillator/morph, filter/envelopes, velocity, 8 voices, private controller/UI, numerical tests | Fix A M1 defects; review B's code and measurements; verify loading on named browsers | Separate playable A/B deliverables, numeric checks, producer listening verdict for each; no M2/M3 before that engine passes |
| 2 — host and controller contract | H-02 input adapters; H-03 clock/revision ledger; H-04 independent lifecycle; H-05 smoothed stereo mixer and master FX; integration mocks/tests | A controller request/ack/capabilities/recovery and generation implementation; review each host increment | Full contract reconciled, controller fixtures agreed, failure/recovery and routing tested |
| 3 — complete core synthesis | B: 2 WT oscillators, sub/noise, 32 original families, phase-aware/band-limited tables, bounded 16-lane unison, dual filters | A: its own oscillators, hypersaw, filters, performance controls | M1 approval first; incremental DSP/performance evidence; no shared engine implementation |
| 4 — modulation, effects and performance | B: 4 envelopes/LFOs, 32 matrix slots, 16/32 sequencer, private arp/gate and clean effects | A: its own modulation, arp/gate and private effects | Independent clock sync, effect state, tails and panic verified; named-hardware load results |
| 5 — patch state and presets | B compiler, four generation slots, revision acknowledgments, schema/migration/import/export/storage, original 64-preset bank | Equivalent A-owned pipeline and original bank | Malformed input rejection, supersession, held-note continuity, storage failure and bounded-memory checks |
| 6 — integration and release | Host/isolation regression, cross-review A and final package, close findings | Integrate reviewed components, cross-review B/host, package standalone HTML | Producer approval, named browser/device matrix, level/headroom/long-session tests, complete files and release notes |

Implement foundational generation/revision contracts in phase 2 before dependent
features; phase 5 completes end-user persistence/presets rather than retrofitting
held-note correctness. Keep every phase in small independently reviewable commits.

### Waiting work

- Waiting for code review: write tests for the next owned slice, reproduce defects,
  document contracts, or measure the existing implementation. Do not edit the peer's
  in-flight files or integrate unreviewed changes as accepted.
- Waiting for A listening approval: Codex can build B M1 and host foundations;
  Claude can review those, fix A M1 defects, and improve packaging/test evidence.
- Waiting for B listening approval: Codex can address B feedback, host foundations,
  and A review. No B M2/M3 feature expansion.
- Waiting for full contract: work on summary-supported internal components; hold
  disputed public wire formats and final compliance claims.

## Current mailbox

### Codex → Claude: H-01 and H-02a ready for review

Branch: `codex/shared-coordination` (base SHA above).
Files: `source/host/note-ledger.mjs`, `tests/host-note-ledger.test.mjs` under the source
root. Run `node tests/host-note-ledger.test.mjs` from that root: **10 tests passed**.
See `reviews/2026-11-02-codex-baseline.md` for baseline findings and integration limits.

Please test H-01, especially source/channel identity, transpose changes during held
notes, one controller throwing, detach/replacement, and panic admission control.
Reply in a separate `reviews/<date>-claude-h01.md` or PR review with the tested SHA.
Review-only for H-01; do not wire that module into your build until adapter/recovery
semantics are agreed. H-02a fixes the existing temporary harness directly, retaining
its current engine interface; inspect source/host/m1-harness.html and run
`node verification/host-baseline-regressions.cjs` (7 passed). Three of those tests
first failed on the baseline, confirming the bugs before correction. Codex next
owns the complete H-02 adapters and B M1 preparation.

### Claude → Codex: awaiting reply

No peer review or response has been received in this session. Claude should push
its next A changes with commands and a review request; Codex will review those.

## Validation and unresolved decisions

Codex executed on 2026-11-02, Node 24.19.0 / Python 3.12.14 on Linux:

```sh
cd handoff-bundle/dual-synth
python3 build.py                    # 26 passed, 0 failed, 0 skipped
python3 build_m1.py                 # 16 passed, 0 failed
node tests/pk01-dsp-test.js         # 35 passed, 0 failed
node tests/m1-dsp-test.js           # 16 passed, 0 failed
node tests/host-note-ledger.test.mjs # 10 passed, 0 failed
node verification/host-baseline-regressions.cjs # 7 passed, 0 failed
```

Baseline builds matched the supplied artifacts; H-02a rebuilds DualSynth_A_M1.html
with host fixes only. Synth A DSP/controller/panel are unchanged. These tests do not prove
browser compatibility, audio quality, or real-device CPU performance. Claude's
Chromium report is historical evidence, not a Codex Safari result. Its universal
claims about Blob/file loading need narrowing to tested browser/version/platform.

Producer still supplies: complete contract/amendments; per-engine listening verdicts;
real target hardware/browser and keyboard/MIDI use; decision on fallback loading or
localhost deviation if required. Broad implementation authorization does not mean a
particular sound or packaging deviation has been accepted. Final defaults marked U
in HANDOFF.md remain U until explicitly resolved.

### Codex browser result for the H-02a page

Executed `verification/m1-smoke.cjs` with installed playwright-core and Chromium
154.0.8037.57 on Linux over a temporary loopback HTTP server. At 44.1 kHz, Blob
loading succeeded; C4 peak was 0.0736534; output was silent before playing and after
release; all 17 sliders were present; no page errors. Web MIDI permission was
denied, so real MIDI was not tested. The seven MIDI/ownership regressions use
controller and DOM stubs in Node, not hardware.

`file://` navigation was blocked by administrator browser policy
(`ERR_BLOCKED_BY_ADMINISTRATOR`) before the application loaded. This is not evidence
of an application Blob failure. Safari and producer-machine behavior remain untested.
The local server was for internal validation only, not adoption of a launcher or
a change to the final single-HTML delivery contract.

Reproduce with installed Playwright and its Chromium (or set PLAYWRIGHT_MODULE and
CHROMIUM_PATH to your installed equivalents):

```sh
cd handoff-bundle/dual-synth
python3 -m http.server 8765 --bind 127.0.0.1 --directory dist
# In a second terminal, from the same directory:
node verification/m1-smoke.cjs http://127.0.0.1:8765/DualSynth_A_M1.html
```
