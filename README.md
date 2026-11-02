# Dual Synth

One standalone HTML instrument (Web Audio) holding two completely separate synthesizers and a thin shared host:

- **Synth A (VULCAN-VA)**: subtractive virtual analog, built by Claude. Source: `dual-synth/source/synth-a/`.
- **Synth B (PRISM-WT)**: wavetable synth, built by GPT. Source: `dual-synth/source/synth-b/`.
- **Host**: MIDI/keyboard in, mixer, glue compressor, master reverb, A/B switch. Built by GPT.

Start with **`COLLAB.md`** (roles, phases, review rules, open decisions), then `docs/HANDOFF.md`.

Try the current Synth A prototype: open `dual-synth/dist/DualSynth_A_M1.html` in Chrome (or the newest M2 page in
the same folder once it exists), press START AUDIO, **turn the volume down first**.
