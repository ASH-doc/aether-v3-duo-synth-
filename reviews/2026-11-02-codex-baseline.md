# Codex review of Claude baseline and H-01 handoff

Baseline: 78835913e59b685b81923834769b1e9cdf13e8cf. Date: 2026-11-02.
Root for file paths below: `handoff-bundle/dual-synth/`.
This is a source review plus reproduced Node/build results, not listening approval.

## Findings and disposition

1. **High, temporary host — device ownership/channel dispatch.**
   `source/host/m1-harness.html`, `midi()` keys notes as `m<channel>:<pitch>` without
   input identity; `on()` forwards channel 0 regardless of incoming channel.
   Two devices playing the same channel/pitch collide; release by either device
   can stop the other's note. Disconnect hooks do not release that device's notes.
   Fixed in this branch by Codex H-02a; peer review pending. Use input.id in source identity and preserve channel;
   tests must exercise simultaneous devices and targeted disconnect.

2. **High, temporary host — stale ownership after emergency actions.**
   All Notes Off / Panic button handlers only call the engine, leaving `held` and
   `kbNotes` populated. CC123 has the same issue and is not source/channel scoped.
   Repeated noteOn after CC123 can be ignored because `held.has(key)` remains true.
   Fixed in this branch by Codex H-02a; peer review pending. Clear matching ownership and reconcile physical keys;
   panic additionally blocks admission through fade completion. Test repress,
   delayed noteOff, and simultaneous external MIDI plus keyboard blur.

3. **Medium, A controller — parameter/UI state can disagree with DSP.**
   `source/synth-a/m1-panel.js`, `setParam(i,v)` writes and publishes the supplied
   value without index/range/finite validation. Worklet `setP` clamps or rejects it.
   A public call such as `setParam(cutoffIndex, NaN)` puts NaN in getPatch/UI while
   the DSP retains its previous cutoff. Owner: Claude. Validate/canonicalize at
   the controller boundary before notifying UI; add a regression for invalid
   indices, NaN/Infinity, range limits and patch round trips.

4. **Medium, A lifecycle — recreate in one context is not yet supported.**
   `SynthA.create()` always creates a new Blob URL and registers `va-m1` again.
   Re-registering an existing processor name in the same AudioContext is not valid.
   Owner: Claude. Cache module registration per context (retry failures), construct
   fresh nodes/sessions, make dispose idempotent and remove subscriptions. This is
   a source/API-contract finding; no real-browser restart result is claimed here.

5. **Medium, verification — browser script logs but does not assert readiness.**
   `verification/browser-check.js` does not fail when engine status is failed or
   output is silent; success exit only means the script completed. It also prefixes
   every input with `file://`, so it cannot reproduce the report's HTTP comparison
   as documented. Owner: Claude. Add explicit expected-success/expected-failure
   modes and thresholds, URL support, timeout/error checks and sample-rate capture.
   Preserve its instrumentation as test-only; never ship prototype mutation in
   production. Repeated overlapping analyser windows are observations, not an
   independent continuous sample count or rigorous dropout measurement.

6. **Disclosed architecture gaps, not newly discovered regressions.**
   A lacks revision acknowledgments, generation retention, scheduled notes, grouped
   note batches, capabilities and robust recovery. B is a placeholder. H-01 does
   not fill these gaps. Keep all of them visible in the phase plan.

## H-01 review contract

`source/host/note-ledger.mjs` is a host-internal module, not a new engine protocol.
It uses the existing four-argument noteOn and noteOff(id) controller methods. It
does not access ports or DSP. Both destinations receive one matching note ID;
IDs are monotonically increasing positive signed-32-bit values for compatibility
with current A and never silently wrap. At exhaustion, reject rather than alias.

Per note it records source, channel, physical key, original/dispatched pitches,
velocity, destination session and physical-key state. Snapshots contain copies
without controller references. Capacity is 4096 held entries. Out-of-range
transposed pitches skip only that engine. Same physical-key retriggers are ignored;
the upcoming MIDI adapter must normalize retrigger/velocity-zero semantics explicitly.
Bounds/retrigger policy are internal implementation choices awaiting peer review.

Panic blocks admission until `endPanic()`; the lifecycle owner must perform the
host fade and clear master reverb first. This module alone does neither. Attach
does not replay held notes; a future recovery coordinator must restore patch,
clock and controller state before explicit replay. Detach releases old ownership
without disposing controllers. A controller exception is reported and does not
prevent the other destination receiving an event. A noteOn that throws may have
partially sent, so retain its destination for eventual release.

Not implemented here: DOM/MIDI adapters, sustain/pitch/mod-wheel routing, atomic
batches, scheduled events, clock, AudioContext lifecycle, recovery replay, mixer,
effects, actual browser integration. ES module source must be embedded by the final
packager; do not introduce external script URLs into standalone delivery.

## Commands actually run

See root COLLABORATION.md. Builds 26/26 and 16/16, DSP 35/35 and 16/16, H-01
10/10 pass. Host regressions initially reproduced 3 failures; after H-02a, all
7 regression cases pass. The A HTML was rebuilt with host fixes; A DSP is unchanged. Full source/build/test/
handoff/browser-check implementation was inspected; generated pages were rebuilt.
Chromium 154 HTTP smoke verification subsequently passed (see COLLABORATION.md).
Safari, real MIDI, musical quality, and peer review remain unclaimed. File navigation
was blocked by administrator policy before app loading.

Review status: findings 1–2 corrected by Codex H-02a, awaiting Claude verification;
findings 3–5 open with Claude; architecture gaps tracked; H-01 awaiting Claude. Please append replies
in a separate review file referencing the exact tested commit and finding numbers.
