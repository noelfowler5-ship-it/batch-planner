# ClipForge AI

A local-first AI video editor for one faceless Malaysian TikTok affiliate creator.

> RAW VIDEO → AI DIRECTOR → QUICK EDIT → EXPORT

Not a CapCut competitor. The goal is to turn a raw affiliate-product clip —
kitchen gadgets, skincare, fashion, whatever the creator sells — into a
publish-ready 9:16 TikTok in a 3–10 minute session.

**Status: all phases built.** Upload → AI analysis → content generation →
editing → export works end to end. Two things need a real device to confirm —
see *Needs a hands-on check* at the bottom.

---

## What it does

**Create** — drop in a video. It reads the duration and resolution, makes a
cover frame, and extracts 6–14 still frames, all on your device. Pick how much
time you have (3 / 5 / 10 / 20 min); that controls how aggressive the AI gets.

**Analyse** — sends the *stills* to Gemini and gets back a scene-by-scene plan:
what each stretch is for (HOOK / PROBLEM / DEMO / BENEFIT / PROOF / RESULT /
CTA / FILLER / REMOVE), how strong it looks, whether a face is visible, and a
score out of 100 with a verdict band. The score is an editing judgement, and the
app says so — it never claims to predict views.

**Director** — every scene with its purpose, the matching voiceover line, the
suggested on-screen text, and a button that *applies* each one. "Apply all safe
suggestions" switches off the REMOVE scenes and adds the overlays in one tap.

**Content** — 5 hooks (pick one), 3 captions, three voiceover lengths timed to
the real clip, and timed text overlays. In casual Bahasa Melayu, BM + English,
or English.

**Edit** — trim, split, reorder, enable/disable segments, 9:16 crop, mute,
text overlays with position and style, full undo/redo. The source video is never
modified; every edit is an instruction recorded against it.

**Export** — renders to 1080×1920 in the browser and saves the file. No upload,
no watermark, no account.

**Queue & batch** — projects grouped by stage (Raw → Analyzing → Editing →
Ready → Posted), and a batch mode that scores several clips in one run so you
can see which one deserves your evening.

Nothing connects to TikTok. Nothing posts itself. There is no account and no
server-side database.

---

## Architecture

```
Browser (all video work is local)
  ├─ index.html          shell, 4 tabs + the per-project studio
  ├─ css/app.css         all styling — no CDN, no build step
  └─ js/
       util.js           pure helpers + constants
       db.js             IndexedDB (projects, videos, AI cache) + fallback
       video-engine.js   probe · thumbnail · frame extraction (canvas)
       project.js        project record, workflow, migration
       ai-schema.js      validate + repair every AI response
       ai-client.js      the only file that touches the network; owns the cache
       editor.js         segments, overlays, undo/redo, source→output mapping
       export.js         canvas + MediaRecorder render; optional MP4 convert
       ui.js             toasts, modal, tabs, markup builders
       screens.js        Create / Projects / Queue / Settings
       studio.js         Overview / Director / Content / Edit / Export
       app.js            state, boot, one delegated click handler

Netlify Functions (AI only — never video bytes)
  └─ netlify/functions/
       lib/gemini.mjs        shared helpers (not deployed as a function)
       gemini-analyze.js     POST /api/gemini/analyze
       gemini-generate.js    POST /api/gemini/generate
       gemini-models.js      GET  /api/gemini/models
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
reads images natively. This is faster, far kinder to a free quota, and avoids
cross-origin upload uncertainty entirely. Audio-based analysis is a possible
later upgrade, not a requirement.

### Why canvas + MediaRecorder, not ffmpeg.wasm, for export

ffmpeg.wasm is a ~30 MB download, its fast core needs COOP/COEP headers that
would block other resources, and burning styled text through it means shipping
fonts into the wasm filesystem. MediaRecorder is native, needs no download, and
handles trim, reorder, crop and overlays in one pass using the *same drawing
code* as the preview — so what you see cannot drift from what you get.

The trade-off, stated in the UI: rendering runs in **real time** (a 30-second
video takes about 30 seconds), and most browsers record WebM rather than MP4.
ffmpeg.wasm is loaded on demand *only* to convert WebM → MP4 when asked.

### Why no Tailwind CDN

If MP4 conversion ever needs COOP/COEP headers, every cross-origin script and
stylesheet stops loading. Plain CSS avoids that, and means the app renders
correctly on a first-ever offline open.

### Two things that keep the AI free

1. **Caching.** Every result is stored against
   `fingerprint + prompt version + model + language`. Re-opening a project, or
   re-analysing the same clip, costs nothing. Only an explicit "Re-analyse"
   spends quota, and it asks first.
2. **Two cheap calls, not one expensive one.** Analysis gets images; generation
   gets only the resulting text plan. The model is never asked to "make my
   TikTok" in one shot.

### Never trusting model output

`ai-schema.js` validates and repairs every response before it touches a project:
out-of-range scores are clamped, unknown enum values replaced, overlapping or
out-of-bounds scene timings fixed, overlapping overlays dropped, over-long text
truncated. If a response cannot be repaired it is rejected with a clear message
and **the project is left untouched**. Repairs are reported, never silent.

---

## Running it

**Quickest look:** double-click `clipforge/index.html`. The UI works and you can
click around, but Chrome blocks IndexedDB on `file://` (videos stay in memory for
that session) and AI cannot run — there is no server to proxy through. The app
detects both and says so.

**Properly**, from the `clipforge/` folder:

```
python3 -m http.server 8080
```

then open `http://localhost:8080`. IndexedDB, service worker and install-to-home
all work. AI still needs the Netlify functions, so use a deploy for that.

## Deploying

Two options:

1. **Separate Netlify site (recommended)** — same repo, publish directory
   `clipforge`, functions directory `netlify/functions`, build command empty.
   Clean URL and its own service-worker scope.
2. **Same site as the Batch Planner** — it lands at `/clipforge/`. Note the
   existing root `service-worker.js` claims scope `/` and will cache ClipForge's
   files, which makes updates stick. Option 1 avoids that.

Then set **`GEMINI_API_KEY`** in Netlify → Site configuration → Environment
variables, and redeploy. Optionally set `GEMINI_MODEL` to override the default
without a code change. See `.env.example` at the repo root. The key never
reaches the browser.

**After editing anything in `clipforge/`, bump `CACHE_NAME` in
`clipforge/service-worker.js`** (`clipforge-v2` → `clipforge-v3`), otherwise
installed copies keep serving the old version.

---

## Tests

```
cd clipforge
node test/run.cjs      # 197 assertions — browser app
node test/server.mjs   #  26 assertions — Netlify proxy helpers
```

`test/run.cjs` loads the app's real script files into a Node `vm` with a stubbed
DOM. It covers pure logic, AI-response validation and repair, the whole edit
model (including undo/redo and source→output time mapping), storage round trips,
and the rendered markup of every screen in both empty and populated states —
asserting no `undefined`/`NaN` leaks and that user text is escaped rather than
injected.

It deliberately leaves `indexedDB` and `MediaRecorder` undefined, so the
degraded-storage and cannot-export paths are the ones under test. `.cjs` because
the repo root sets `"type": "module"`.

`test/server.mjs` covers the proxy helpers that handle untrusted input: JSON
extraction from prose-wrapped model replies, frame filtering (a remote URL or a
`text/html` data URL never reaches Google), and model-name validation (a model id
is interpolated into a URL, so path traversal and query injection are rejected).

### Needs a hands-on check

The harness cannot drive a real `<video>`, canvas or network, so these are
verified by hand:

1. Upload a video → frames appear in the filmstrip
2. Reload → the project is still there (the IndexedDB happy path)
3. **Export** — render a short clip end to end and play the result. This is the
   least-tested path: it depends on `captureStream`, `MediaRecorder` and
   `AudioContext` behaviour that varies by browser. If it fails, the app reports
   why rather than hanging.
4. **MP4 conversion** — downloads ffmpeg.wasm from a CDN on first use
5. A real Gemini call with a live API key
6. An iPhone HEVC `.mov` — some browsers refuse to decode it, and the app should
   say so clearly rather than hang
