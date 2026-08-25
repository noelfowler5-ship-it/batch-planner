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

**Multiple clips, one post** — a project can hold up to `CF.MAX_CLIPS` (3)
clips instead of one — an unboxing, a demo, a result shot — added via **+ Add
another clip** on the Edit tab. They're treated as one continuous video
throughout: one combined scene plan, one set of hooks/captions/voiceover
written for the assembled whole, one policy check, one export. Each clip
still gets its own AI analysis and its own score (the Plan tab shows both the
combined average and each clip's own breakdown) — see "How multiple clips
become one video" below for how that's kept correct.

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

**Edit** — enable/disable scenes (order and timing stay locked to the AI's
plan), 9:16 crop, mute, apply a hook as on-screen text, full undo/redo. The
source video is never modified; every edit is an instruction recorded against
it. A **Preview** button on both Edit and Export plays the clip back — silent,
with overlays burned in — exactly as it will export, so you can check text
placement and timing before spending real render time.

**Policy check** — after content is generated, the app automatically asks
Gemini to scan the hooks, captions, voiceover and overlays (plus the video
frames) for patterns that commonly trigger TikTok affiliate policy strikes:
faked promotion/urgency, faked or staged danger, missing paid-partnership
disclosure, fake testimonials, unverifiable claims, misleading results. Each
flag names the risky line, why it's risky, and a suggested fix. It's a
heuristic self-check, not a compliance verdict — the app says so everywhere
this result is shown — and it's cheap to re-run: regenerating content with
new text triggers a fresh check automatically, but reopening a project with
unchanged content reuses the cached result.

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
       project.js        project + clips[], local/combined timeline, migration
       ai-schema.js      validate + repair every AI response
       ai-client.js      the only file that touches the network; owns the cache
       editor.js         segments, overlays, undo/redo, source→output mapping
       export.js         canvas + MediaRecorder render; optional MP4 convert
       preview.js        silent playback preview (reuses export.js's drawing)
       ui.js             toasts, modal, tabs, markup builders
       screens.js        Create / Projects / Queue / Settings
       studio.js         Plan (Overview/Director/Content/Policy) / Edit / Export
       app.js            state, boot, one delegated click handler

Netlify Functions (AI only — never video bytes)
  └─ netlify/functions/
       lib/gemini.mjs           shared helpers (not deployed as a function)
       gemini-analyze.js        POST /api/gemini/analyze
       gemini-generate.js       POST /api/gemini/generate
       gemini-policy-check.js   POST /api/gemini/policy-check
       gemini-models.js         GET  /api/gemini/models
```

**No framework, no npm, no build step, no database, no user accounts.**
Vanilla JS in classic `<script>` tags (not ES modules) so the app still runs
from a double-clicked file.

### How multiple clips become one video

A project holds `clips[]` — an ordered list, each with its own `videoId`
(the IndexedDB blob it points at), `fingerprint` (its own AI cache key) and
`analysis` (its own scene plan). Everything downstream is built on two
timelines, both defined in `project.js`:

- **Local time** — a position within one clip's own footage. This is what
  `editor.js` segments use (`sourceStart`/`sourceEnd`, plus a `clipId` saying
  which clip they belong to) and what each clip's own AI analysis speaks in.
- **Combined (global) time** — a position in the finished, assembled video,
  as if every clip's footage had been laid end to end. `P.localToGlobal` /
  `P.globalToLocal` convert between the two using each clip's cumulative
  duration (`P.clipOffsets`). Content generation and the policy check are
  shown a `P.combinedAnalysis(project)` — one virtual scene list with every
  clip's scenes converted to global time — so the AI writes one script for
  the whole post, never one per clip.

The one thing this makes non-obvious: **two different clips can share the
same local timestamps** (both might have a scene at "0s–5s"), so anything
that used to match on time alone had to become clip-aware too —
`E.sourceToOutput`/`E.sourceToOutputNearest` take a `clipId`, and
`E.applyAllSafe`'s REMOVE-matching keys on `clipId + start + end`, not just
`start + end`. `test/run.cjs`'s "two clips sharing identical local
timestamps" section is a regression test for exactly this.

Export and preview render loops create **one `<video>` element per clip
actually used** (not one per project) — `X.render`/`CF.preview.open` take a
map of `{clipId: Blob}`, wait for every clip's metadata to load, then walk
the enabled segments in order, picking whichever clip's element a segment
belongs to. Switching clips mid-render is just picking a different
already-loaded element; nothing needs re-encoding or re-fetching.
`X.targetSizeFor(project)` frames the canvas against the **first** clip's
shape — a later clip with different dimensions still renders correctly
(`drawFrame` reads each segment's own video dimensions at draw time and
letterboxes/crops into whatever the target is), just fit into clip 1's frame
rather than its own.

A project saved before multi-clip existed has no `clips` array at all — just
the old single-video fields directly on the project. `P.normalize()`
migrates that into a one-entry `clips[]` the first time the project loads,
preserving the video, its analysis and its score rather than discarding
them; a segment saved before `clipId` existed is stamped with the migrated
clip's id so old edits keep working.

### Why frames, not the video file

The original plan was `Browser → Netlify Function → Gemini` carrying the video.
That cannot work: Netlify caps synchronous function request bodies at roughly
**6 MB**, while a 20-second 1080p clip is **15–60 MB**.

So the browser extracts 6–14 JPEG stills at 480px wide (~400 KB total) and those
travel to Gemini instead, with their timestamps and the clip duration. Gemini
reads images natively. This is faster, far kinder to a free quota, and avoids
cross-origin upload uncertainty entirely. Audio-based analysis is a possible
later upgrade, not a requirement.

### Why every frame can come out black (and the fix)

On some iOS Safari sessions the browser never actually starts decoding a
freshly loaded `<video>` — every `seeked` event fires right on schedule, but
the canvas it's drawn to stays black, so the AI correctly reports "no usable
footage" about a video that plays fine. Two WebKit quirks stack together:
`seeked` can fire before the target frame has actually been decoded and
painted, and on a `<video>` that has never played even once, seeking alone
sometimes never triggers real decoding at all.

`video-engine.js` works around both: before the first seek it nudges the
element with a muted `play()`/`pause()` (invisible — the element is never
attached to the DOM) to force the decoder to initialize, and after each
`seeked` event it waits on **`requestVideoFrameCallback`**, the only API that
actually reports "a new frame is now available to draw", falling back to two
animation frames where that is unavailable. Both resolve immediately and cost
nothing on browsers that never had the problem.

Note that `readyState` is *not* usable here, though it looks like it should
be: it stays at `HAVE_ENOUGH_DATA` straight through a seek, so polling it
answers nothing. An earlier version of this fix did exactly that and was a
no-op.

Because a silent version of this bug is so hard to spot from the outside —
the AI faithfully reports "solid black screen, no usable footage" about a
video that plays perfectly — extraction now also *measures* what it drew.
Each frame's peak luma is sampled from the canvas, and an all-black set is
reported to the user directly instead of being sent to Gemini. Peak rather
than mean, so genuinely dark footage (which still has highlights) is never
mistaken for a decode failure; an unreadable canvas reports "unknown", never
"black".

### The AI cache can outlive the bug that poisoned it

Cache keys are `fingerprint + prompt version + model + language`, and the
fingerprint is derived from the file itself (`name + size + lastModified +
duration`). Re-uploading the same file therefore reproduces the same key and
replays the stored verdict **without calling the API at all** — which is the
intended behaviour, and exactly what keeps this inside a free tier.

The trap: if a result was cached while extraction was broken, re-uploading
the video can never fix it, because the fix never gets to run. The escape
hatch is `PROMPT_VERSION` in `ai-client.js` (mirrored in the three functions)
— bumping it retires every existing entry at the cost of one re-analysis.
**Bump it whenever a bug may have poisoned stored results**, not only when a
prompt changes. Per-project, "Analyse again" forces a single bypass.

### On-screen text follows the creator's real captions

The overlay look and timing are copied from this creator's own published
videos, not from generic short-form advice:

- **White text, heavy dark outline, no box.** Their shots are frequently a
  white gadget on a pale counter, so the outline — not a background pill —
  is what keeps the text readable. The `style` field (hook / benefit /
  proof / cta) still records what a line is *for*, but no longer changes how
  it is painted; the old colour-coded pills looked nothing like the real feed.
- **Vertically centred**, which is where every one of their captions sits.
- **Count follows clip length, not the editing time budget** — see
  `U.overlayCountFor()`, mirrored in the generate prompt. Under 20s gets one
  caption held for the whole video (3 of their 4 reference posts do exactly
  this); 20–25s allows two; over 25s gets 3–4 that change as the demo moves.
  The validator enforces this, because the prompt is a request, not a
  guarantee: extra captions are trimmed and a too-brief lone caption is
  stretched to cover the clip, both reported as repairs.
- **Colloquial Malay with 1–3 emoji**, matching how they actually write
  ("je", "ni", "korang", "mak-mak"). The prompt carries real caption examples
  as a register reference.
- **No numeric prices, ever.** Only vague value words ("murah", "berbaloi",
  "bajet"). The app cannot know a real price, and an invented one is exactly
  the kind of misleading claim the policy check exists to catch.
- **The example set can grow.** Settings → Caption style examples starts with
  the four lines above but is editable — add real captions as the creator
  posts more, so the AI's voice keeps tracking theirs instead of staying
  pinned to what it shipped with. `U.sanitizeStyleExamples()` caps this at 12
  entries / 160 characters each, client and server both, since it goes
  straight into the prompt. Changing the list is part of the generate cache
  key (`styleHash`), so editing it and regenerating is guaranteed to use the
  new voice rather than replay text written for the old one.

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
   `fingerprint + prompt version + model + language` (the policy check also
   keys on a hash of the actual generated content, so editing the text
   triggers a fresh check but reopening an unchanged project doesn't).
   Re-opening a project, or re-analysing the same clip, costs nothing. Only an
   explicit "Re-analyse" or "Re-check" spends quota, and it asks first.
2. **Small, separate calls, not one expensive one.** Analysis gets images;
   generation gets only the resulting text plan; the policy check gets the
   text plan plus the frames it needs to check visuals. The model is never
   asked to "make my TikTok" in one shot.

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
node test/run.cjs      # 381 assertions — browser app
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

1. Upload a video → frames appear in the filmstrip, and none of them are
   solid black (a real bug on some iOS Safari sessions — see "Why every frame
   can come out black" below)
2. Reload → the project is still there (the IndexedDB happy path)
3. **Export** — render a short clip end to end and play the result. This is the
   least-tested path: it depends on `captureStream`, `MediaRecorder` and
   `AudioContext` behaviour that varies by browser. If it fails, the app reports
   why rather than hanging.
4. **Preview** — open it from Edit and from Export, confirm play/pause actually
   drives the hidden `<video>` and the canvas draws overlays in sync, and that
   closing it (X, Esc, backdrop tap) always stops playback and frees the object
   URL — the harness can fake the open/close plumbing but not real `<video>`
   timing.
5. **Emoji in captions** — the creator's style calls for 1–3 emoji per line,
   and captions are drawn with `strokeText` then `fillText`. Colour emoji
   under an outline pass is the one part of the caption look that cannot be
   checked headlessly: confirm on a real device that emoji render in colour
   and are not doubled or blacked out by the outline. If they are, skip the
   stroke pass for emoji code points.
6. **MP4 conversion** — downloads ffmpeg.wasm from a CDN on first use
7. A real Gemini call with a live API key, including **the policy check** —
   confirm it fires automatically after generation and that a genuinely risky
   script (e.g. a hook claiming a fake discount deadline) actually gets
   flagged, not just the happy "looks fine" path
8. An iPhone HEVC `.mov` — some browsers refuse to decode it, and the app should
   say so clearly rather than hang
9. **Multi-clip export/preview** — add a second and third clip (ideally
   different resolutions, to actually exercise the "framed against clip 1's
   shape" fallback in `X.targetSizeFor`), enable segments from more than one,
   and confirm export/preview switch cleanly between clips at a segment
   boundary — no frozen frame, no audio glitch, no stall waiting on a second
   clip's metadata. This is the multi-video-element path the harness cannot
   drive at all.
10. **Add another clip mid-session** — from the Edit tab on a real device,
    confirm the file picker opens, ingest progress shows on the Edit tab (not
    just Create), and the new clip's segment appears without disturbing the
    existing ones or their overlays.
