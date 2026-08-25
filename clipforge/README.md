# ClipForge AI

A local-first AI video editor for one faceless Malaysian TikTok affiliate creator.

> RAW VIDEO → AI DIRECTOR → QUICK EDIT → EXPORT

Not a CapCut competitor. The goal is to turn a raw kitchen-gadget clip into a
publish-ready 9:16 TikTok in a 3–10 minute session.

**Status: Phase 1 complete.** The local pipeline works end to end — upload, probe,
frame extraction, project storage, workflow queue. AI, editing and export are not
built yet, and the UI says so plainly rather than showing buttons that do nothing.

---

## What works today (Phase 1)

- Upload a video (tap or drag) — MP4, MOV, WebM
- Reads duration, resolution and file size locally
- Generates a cover thumbnail
- **Extracts 6–14 evenly spaced still frames** — the input the AI stage will use
- Saves projects and video blobs to IndexedDB; survives a browser restart
- Projects list, rename, delete
- Queue grouped by workflow stage: Raw → Analyzing → Editing → Ready → Posted
- Settings: language, default time budget, face-free mode, storage usage
- Installable PWA, works fully offline
- Graceful degradation when IndexedDB is unavailable

Nothing is uploaded anywhere. Phase 1 makes **zero network calls**.

## Not built yet

| Feature | Phase |
|---|---|
| Gemini analysis, scene breakdown, score, AI Director | 2 |
| Hook / voiceover / caption / text generation + Apply | 3 |
| Editor: trim, split, reorder, overlays, undo/redo | 4 |
| Export 1080×1920 H.264 via ffmpeg.wasm | 5 |
| Batch scoring across many clips | 7 |

---

## Architecture

```
Browser (everything local)
  ├─ index.html          shell, 4 tabs
  ├─ css/app.css         all styling — no CDN, no build step
  └─ js/
       util.js           pure helpers + constants
       db.js             IndexedDB, with a localStorage/memory fallback
       video-engine.js   probe · thumbnail · frame extraction (canvas)
       project.js        project record + workflow logic
       ui.js             toasts, modal, tabs, markup builders
       screens.js        one render function per tab
       app.js            state, boot, single delegated click handler

Netlify Functions (Phase 2 — AI only, never video bytes)
  └─ gemini-analyze.js · gemini-generate.js
```

**No framework, no npm, no build step, no database, no user accounts.**
Vanilla JS in classic `<script>` tags (not ES modules) so the app still runs
from a double-clicked file.

### Why frames, not the video file

The original plan was `Browser → Netlify Function → Gemini` carrying the video.
That cannot work: Netlify caps synchronous function request bodies at roughly
**6 MB**, while a 20-second 1080p clip is **15–60 MB**.

So the browser extracts 6–14 JPEG stills at 480px wide (~400 KB total) and those
travel to Gemini instead, with their timestamps and the clip duration. Gemini
reads images natively. This is faster, far kinder to a free quota, and avoids the
cross-origin upload uncertainty entirely. Audio-based analysis is a possible
later upgrade, not a Phase 2 requirement.

### Why no Tailwind CDN

Phase 5 (ffmpeg.wasm) may require `COOP`/`COEP` headers, which block every
cross-origin script and stylesheet. Writing plain CSS now avoids a rewrite then,
and means the app renders correctly on a first-ever offline open.

---

## Running it

**Quickest look:** double-click `clipforge/index.html`. Everything renders and
you can click around — but Chrome blocks IndexedDB on `file://`, so videos are
kept in memory only for that session. The app detects this and says so.

**Properly**, from the `clipforge/` folder:

```
python3 -m http.server 8080
```

then open `http://localhost:8080`. IndexedDB, the service worker and install-to-
home-screen all work.

## Deploying

The repo already deploys to Netlify on push. Two options for ClipForge:

1. **Separate Netlify site (recommended)** — same repo, publish directory
   `clipforge`, functions directory `netlify/functions`, build command empty.
   Gives it a clean URL and its own service-worker scope.
2. **Same site** — it lands at `/clipforge/`. Note the existing root
   `service-worker.js` claims scope `/` and will cache ClipForge's files, which
   makes updates stick. Option 1 avoids that entirely.

Set `GEMINI_API_KEY` in the Netlify environment variables when Phase 2 lands.
See `.env.example` at the repo root. The key never reaches the browser.

**After editing anything in `clipforge/`, bump `CACHE_NAME` in
`clipforge/service-worker.js`** (`clipforge-v1` → `clipforge-v2`), otherwise
installed copies keep serving the old version.

---

## Tests

```
cd clipforge
node test/run.cjs
```

83 assertions covering the pure logic (time formatting, frame sampling,
fingerprinting, project normalisation, workflow transitions), a storage round
trip, and the rendered markup of every screen in both its empty and populated
state — including that no `undefined`/`NaN` leaks into the HTML and that user
text is escaped rather than injected.

`test/harness.cjs` loads the app's real script files into a Node `vm` with a
stubbed DOM. It deliberately leaves `indexedDB` undefined so the degraded
storage path is the one under test. `.cjs` because the repo root sets
`"type": "module"`.

### What the harness cannot cover

These need a real browser and are checked by hand:

1. Upload a video → frames appear in the filmstrip
2. Reload the page → the project is still there (IndexedDB happy path)
3. Drag-and-drop a file onto the window
4. Play the preview video in the project modal
5. Install to a phone home screen, then open with aeroplane mode on
6. A HEVC/H.265 `.mov` from an iPhone — some browsers refuse to decode it, and
   the app should report that clearly rather than hang
