# Well-Formed Scale Instrument Web Prototype

This is a static first-pass web app for the well-formed scale instrument.

## Why this version is plain HTML/CSS/JS

The local environment available in this Codex workspace includes a working browser-compatible project path more readily than a full `npm`/Next.js toolchain. A static app is also:

- easier to understand and edit
- deployable on Vercel Hobby
- a good first step before deciding whether a larger React app is needed

## Files

- `index.html` - app shell and controls
- `styles.css` - UI styling
- `scale.js` - ported scale-building logic
- `audio.js` - browser audio and polyphony helpers
- `app.js` - app state, rendering, playback, and computer-key mapping

## Local testing

Any static web server will work. For example:

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000/` when serving from this repository.

Run the regression checks with Node.js:

```bash
node --test scale.test.mjs session.test.mjs app.test.mjs audio.test.mjs
```

Valid builder edits rebuild automatically, preserving the last valid scale during incomplete input. Build Scale or Enter rebuilds immediately. Typing in one field forms one Undo step until the field loses focus or is confirmed. Compact Undo/Redo controls restore earlier scales, and Escape stops playback. Scale data v2 saves the applied scale, stable step labels, mode, cycle/coset, metronome tempo in BPM, and display/audio settings; v1 files remain readable, and older v2 Duration settings convert to BPM while retaining their note spacing.

## Vercel

This can be deployed as a static site.

When importing the repo into Vercel:

- Framework Preset: `Other`
- Root Directory: repository root
- Build Command: leave empty
- Output Directory: leave empty

## Instrument sounds

The Explorer includes Versilian piano, marimba, pipe organ and clarinet recordings, plus a synthesized sine reference. Samples are loaded locally on demand and played at continuous rates for the calculated frequencies. Hold screen or computer keys to sustain chords; notes release independently, and quick mouse clicks ring for a beat so they can overlap. Piano and marimba decay naturally. Cycle notes connect at each beat, with short release tails. See [sample sources and preparation](assets/samples/README.md) for CC0 credits, rebuild instructions, and acoustic tuning limitations.
