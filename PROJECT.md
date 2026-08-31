# Batch Planner + ClipForge — Project Roadmap

## Overview

This repo hosts two independent applications for **@ultramain** (kitchen-gadget TikTok affiliate):

1. **Batch Planner** (`index.html`, live & deployed)
   - Weekly TikTok content planner: affiliate products → video library → weekly schedule
   - Captions + TOC (voiceover script) generator
   - Performance tracking + angle optimization
   - Learning tab: static course content
   - Offline-first PWA on localStorage/IndexedDB

2. **ClipForge AI** (`clipforge/`, local-first video editor)
   - Upload clip → Gemini scene plan + score → edit captions/hooks/voiceover → export 9:16
   - Non-shared code; read `clipforge/README.md` before touching

`netlify/functions/` now holds only ClipForge's Gemini proxies — Batch Planner has **no
TikTok API integration and makes no server calls of its own** (see "TikTok API — removed"
below). Changes to one app must not break the other.

## Tech Stack

- **Front end**: vanilla JS (no framework), Tailwind CSS via CDN, service worker for offline
- **Back end**: `netlify/functions/` — ClipForge's Gemini proxies only; Batch Planner is pure client-side
- **Data**: localStorage + IndexedDB (videos stored as blobs + thumbnails)
- **Deployment**: git-push-to-deploy (Netlify auto-build on push)
- **No CI, no linter, no build step**

## Key Architectural Patterns

### Batch Planner (`index.html` ~ 1700 lines)

**State Model**
- `state`: products, logs, plans, settings, learning, UI state (tab, sort, learningChapter)
- `localStorage`: K-prefixed keys (ttbp_products, ttbp_logs, ttbp_plans, ttbp_settings, ttbp_learning)
- `IndexedDB`: ttbp-db/videos store for video blobs + thumbnails
- `newProduct()` / `newVideo()` define canonical shape

**Rendering Pattern**
- No virtual DOM. Each tab has `render<Tab>()` → `innerHTML`
- Single delegated click listener on `document` keyed off `data-action` attributes
- Modals: `openModal(html)` / `closeModal()`; form helpers return HTML strings

**Content Generation** (domain logic)
- Captions: `TAGMETA` (pain/benefit tags) + `HOOKS` (question/pov/price) + `makeHook()` → cached per language
- TOC (voiceover): `sceneCount()` → `sceneTimes()` → `TOC_PLANS` templates → `generateTOC()` → cached
- **Captions resolve before TOC** (TOC hook lines mirror caption hook)
- Languages: Bahasa Melayu ("BM Santai"), English, "Mix"

**Weekly Planning**
- `buildPlan()` slots product/video per day using `videoScore()` (recency, REUSE_PENALTY, BACKTOBACK_PENALTY)
- `getPlan(weekKey, create)` lazily builds/fetches per ISO week
- `currentWeekKey()` / `mondayOf()` for date math

**Performance Tracking** (manual-only — no TikTok API)
- `state.logs` fed by two paths, both user-driven, no live API sync:
  - **CSV import**: fuzzy-matches TikTok Studio export columns via `COLMAP` (includes `gmv` now, alongside views/likes/comments/shares/orders)
  - **Manual entry**: `manualLogForm()` — type a single post's stats by hand, including GMV
- Both paths match rows to saved products via the video's `tiktokId` field (a user-entered TikTok post ID, kept purely for matching — nothing to do with the removed API)
- `angleStats()` / `bestAngle()` compute best-performing hook/TOC angle
- `exportCSV()` includes `gmv` column for backup/analysis outside the app

**Learning Tab**
- Static content: `LESSONS` constant array (chapters → sections → blocks: p/list/table/code/rule)
- Sourced once from "TikTok Affiliate Masterclass" Google Doc, baked into `index.html`
- `renderLearningOverview()` shows chapters + progress; `renderLearningChapter()` shows full section
- State: `state.learning` = {sectionId: true} map, persistent in storage

### TikTok API — removed (2026-08-31)

Batch Planner previously had six Netlify functions for TikTok OAuth login, stats sync,
and direct-from-browser video upload. **All six were deleted** (`tiktok-login.js`,
`tiktok-callback.js`, `tiktok-me.js`, `tiktok-stats.js`, `tiktok-upload-init.js`,
`tiktok-logout.js`), along with every UI touchpoint in `index.html` (`state.tt`,
`ttFetch/ttCheck/ttLogout/ttSync/ttUpload/ttPanel`, the "Connect TikTok"/"Send clip to
TikTok" buttons, the `?tt=connected` redirect handler).

**Why**: the upload flow's core assumption — that a browser can `PUT` video bytes
directly to TikTok's Content Posting API — was never verified (see CURRENT.md history:
the verification session hit both a missing TikTok account and an environment that
couldn't reach TikTok's network at all). Rather than resolve that, the user decided to
drop the API integration entirely: post manually via TikTok's own app, bring
performance numbers back in by hand.

**What replaced it**: the CSV-import / manual-log paths that already existed alongside
the API (see Performance Tracking above) are now the *only* way data gets in — nothing
was rebuilt, they just stopped being the fallback and became the primary path. The
video's `tiktokId` field (used to match a CSV row / manual log entry to the right
product) was **kept** — it's a user-typed value, unrelated to the removed OAuth flow.

`privacy.html` already stated "not currently implemented" for TikTok account access —
that line was stale while the API existed and is accurate again now.

### ClipForge AI (`clipforge/`)

See `clipforge/README.md` for architectural details. Key points:
- Frames sent to Gemini, never the video file (memory efficiency)
- Export uses canvas + MediaRecorder, not ffmpeg.wasm (browser-native)
- Has real tests; run after changes: `cd clipforge && node test/run.cjs && node test/server.mjs`

## Critical Constraints & Maintenance

1. **Service Worker Cache**: If you edit `index.html`, bump `CACHE_NAME` in `service-worker.js` (e.g., `v3` → `v4`). Phones with app installed will otherwise keep serving old version indefinitely.

2. **Protected Files** (must not delete or move)
   - `tiktoki9V4P24zCg4MLfNepik5XiPo2NTlZ0Vd.txt` — TikTok domain-ownership verification (breaks URL verification if removed)
   - `privacy.html` / `terms.html` — URLs registered with TikTok app review and linked from footer

4. **App Boundary**: `netlify/functions/lib/` is NOT deployed as a function because it has no entry file. Keep it that way.

## Running / Deploying

- **Local front-end work**: Open `index.html` directly in browser — fully functional, no API/server dependency at all now
- **Local serverless work**: Only relevant for ClipForge (Gemini proxies); needs Netlify CLI (`netlify dev`), check with user before adding setup
- **Deploy**: git-push-to-deploy → Netlify auto-builds (build command empty; publish dir `.`; functions dir `netlify/functions`)

## Roadmap & Known Issues

### Future Enhancements
- Monitor ClipForge Gemini API costs; document frame-sending strategy trade-offs
- If demand ever justifies revisiting a TikTok API integration, re-read the removed section's history in CURRENT.md first — the CORS/OAuth unknowns that caused it to be dropped haven't changed

## Content / Tone

User-facing generated copy (captions, TOC scripts) targets Malaysian creator mixing Bahasa Melayu ("BM Santai"), English, and "Mix".

**Grammar invariant** (critical for caption generation):
- `TAGMETA` pain/ben fields: `pain` = noun phrase, `ben` = predicate
- Hook templates in `makeHook()` assume this shape
- Any edit must preserve grammatical role

**Compliance invariant** (critical — TikTok Community Guidelines / Content Posting policy):
- Every generated caption includes a plain-language paid-promotion/affiliate disclosure line (`disclosureLine()`), placed right under the hook — not buried at the end, not hashtag-only. TikTok's Branded Content policy treats a hashtag alone as insufficient disclosure.
- `proofLine()` (captions) and `tocElement('proof', ...)` (TOC) must never assert unverifiable sales/popularity facts ("many have bought", "repeat buyers love it") — that's a fabricated-social-proof pattern TikTok's policies (and ClipForge's own `gemini-policy-check.js` heuristics, for reference) both flag. Point to TikTok Shop's own real reviews instead, or say nothing.
- `p.limited` (stock-scarcity claim) is acceptable because it's a user-truthful field the creator sets themselves — the generator never invents scarcity/urgency on its own.
- Any new caption/TOC copy must be checked against these three rules before shipping.

---

**Session Discipline**: One task per session. Close session when task is done. Work on designated branch only.
