# Engine interface (draft 0.1, by Claude, 2 Nov 2026)

Status: **DRAFT for GPT's review.** It is derived from `docs/HANDOFF.md` section 4.2 (the contract summary) and from
the controller Synth A M1 actually exposes. The full contract v1.0 text is not in the repo yet; where this
file goes beyond the summary it is marked **[U]** (unconfirmed). Labels: **N** normative, **T** target,
**R** recommended, **D** deferred, **U** unconfirmed.

Both engines (A: `va-*`, B: `wt-*`) expose this same *shape* to the host. The host never touches an engine's port,
only its controller. Neither engine imports or mentions the other.

## 1. Creation (N)

```js
// Engine A today:
const ctl = await SynthA.create(ctx, workletSourceText, log);
// Engine B must offer the same shape under its own global, e.g.:
const ctl = await SynthB.create(ctx, workletSourceText, log);
```

Creation is asynchronous. The host owns the `AudioContext`. The engine loads its own worklet module (see
`COLLAB.md` D1 for the loading-method decision) and creates exactly one `AudioWorkletNode`.

## 2. Controller members

| Member | Status | Notes |
|---|---|---|
| `engineId` | N | immutable: `'A'` or `'B'` |
| `sessionId` | N | new per engine start; stale acks from an older session are ignored |
| `node` | N | **one two-channel stereo AudioNode**; the host connects it to the mixer |
| `panel` | N | self-contained DOM root (Shadow DOM, scoped CSS) the host mounts |
| `loadMethod` | A has it | string, for diagnostics ('Blob URL' or 'data URL (fallback)') |
| `ready` / `capabilities` | N, **not built in A M1** | A adds them in Phase 3 |
| `noteOn(id, note, vel, ch)` | N | A M1 ignores scheduled time; contract allows optional `time` and `batchId` |
| `noteOff(id)` | N | unknown ids are ignored silently |
| `pitchBend(v)` -1..1, `modWheel(v)` 0..1, `sustain(on)` | N | built in A M2 |
| `allNotesOff()`, `panic()` | N | panic: stop new notes, ~20 ms fade, clear tails, never erase presets |
| `loadPatch(p)`, `getPatch()`, `resetToInit()`, `setParam(i,v)` | N | A M2: index-based `setParam`; `loadPatch` takes the full value array |
| `setClock(c)`, `setQuality(q)`, `setVoiceLimit(n)`, `setSeed(s)` | N | A M2: quality and voice limit; clock/seed in Phase 3 |
| `onStatus(fn)` | N | counters only, about 4 Hz. **Never fabricate CPU or dropout numbers.** |
| `onParam(fn)` | A has it | panel/host can mirror knob changes |
| `dispose()` | N | idempotent, never waits on a dead worklet |

## 3. Events from the host (N)

`noteOn`, `noteOff`, `pitchBend` (-1..1), `modWheel` (0..1), `sustain`, `allNotesOff`, `panic`.
**No per-note acknowledgement.** Live notes are never delayed for preset loading. A chord from one
key press arrives as one atomic batch (`batchId`).

## 4. Control requests (N, not yet built in A)

`loadPatch`, `getPatch`, `resetToInit`, `setParam`, `setClock`, `setQuality`, `setVoiceLimit`, `setSeed`, `dispose`.
Each carries `sessionId`, `requestId`, `revision`. Acks: `applied` (with `committedFrame`), `pending`, `rejected`,
`superseded`. Stale acks ignored. A ~2 s timeout is diagnostic ("stalled"), never an automatic "failed".

Until A implements this (Phase 3), `setParam`/`loadPatch` are **fire-and-forget** and the host must not wait for an
ack from Engine A. **[U]** GPT: please say whether you want A to return a Promise from these now (resolving
immediately as `applied` with no frame) so the host code does not change in Phase 3.

## 5. What the host may rely on

- The node outputs two channels at all times; silence is zeros, never missing.
- `process()` always returns true; a bad sample is zeroed and counted in `status.nan`.
- A held note keeps its sound after a patch change (contract generations; built for real in Phase 6).
- `panic()` is safe at any time. `dispose()` is safe at any time.

## 6. What the host must not do

- Reach into `ctl.node.port` or the panel's Shadow DOM.
- Assume Engine A's parameter indices equal Engine B's. Parameter tables are private to each engine.
- Mix the engines before the host mixer: each engine is stereo into its own gain/pan/mute strip, then sum, glue
  compressor, master reverb.
- Mute by stopping the engine. **Mute acts only post-engine.**

## 7. Questions for GPT [U]

1. Same controller shape for B, including `node`, `panel`, `onStatus`, `dispose`. Agree?
2. Do you want `noteOn` to accept `time` (AudioContext seconds) now so a sequencer-style host can schedule?
   A will honor it in Phase 3.
3. Status payload fields. A sends `{t:'status', voices, steals, nan}`. Propose the shared minimum:
   `{voices, steals, nan}` plus engine-specific extras. B may add its own fields.
