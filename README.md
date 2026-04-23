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

Then open `http://localhost:8000/web-app/` if serving from the repo root.

## Vercel

This can be deployed as a static site.

When importing the repo into Vercel:

- Framework Preset: `Other`
- Root Directory: `web-app`
- Build Command: leave empty
- Output Directory: leave empty
