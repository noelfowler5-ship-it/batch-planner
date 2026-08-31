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

Both share `netlify/functions/` but do NOT share code. Changes to one must not break the other.

## Tech Stack

- **Front end**: vanilla JS (no framework), Tailwind CSS via CDN, service worker for offline
- **Back end**: six Netlify serverless functions (TikTok OAuth/login/stats/upload/logout)
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

**Performance Tracking**
- `state.logs` fed by manual CSV import (fuzzy-match TikTok export columns via `COLMAP`)
- Live sync via `ttSync()` / `ttFetch()` (optional, if TikTok connected)
- `angleStats()` / `bestAngle()` compute best-performing hook/TOC angle

**Learning Tab**
- Static content: `LESSONS` constant array (chapters → sections → blocks: p/list/table/code/rule)
- Sourced once from "TikTok Affiliate Masterclass" Google Doc, baked into `index.html`
- `renderLearningOverview()` shows chapters + progress; `renderLearningChapter()` shows full section
- State: `state.learning` = {sectionId: true} map, persistent in storage

### TikTok Integration (`netlify/functions/*.js`)

Six independent functions, each fully self-contained (repeats ~50 lines of helpers rather than importing shared module).

| File | Path | Purpose |
|---|---|---|
| `tiktok-login.js` | `/api/tiktok/login` | Redirects to TikTok OAuth, sets CSRF `tt_state` cookie |
| `tiktok-callback.js` | `/auth/callback` | Exchanges code for tokens, sets HttpOnly cookies |
| `tiktok-me.js` | `/api/tiktok/me` | Connection status + username |
| `tiktok-stats.js` | `/api/tiktok/stats` | Recent post metrics (sync stats button) |
| `tiktok-upload-init.js` | `/api/tiktok/upload-init` | Returns TikTok `upload_url` |
| `tiktok-logout.js` | `/api/tiktok/logout` | Revokes token, clears cookies |

**Token Model**
- HttpOnly, Secure, SameSite=Lax cookies: `tt_access`, `tt_refresh`, `tt_exp`
- Never touched by front-end JS; never persisted server-side
- `getToken()` transparently refreshes when `tt_exp` near

**Upload Flow** (two-step by design)
- Browser calls `tiktok-upload-init.js` → gets `upload_url` from TikTok
- Browser does direct `PUT` of video bytes to TikTok (not through serverless function)
- Rationale: keeps large files off serverless payload limit
- **Caveat**: If TikTok rejects direct-from-browser PUTs (CORS), route bytes through function instead

**Env Vars** (Netlify site config, never committed)
- `TIKTOK_CLIENT_KEY`
- `TIKTOK_CLIENT_SECRET`
- `TIKTOK_REDIRECT_URI`

### ClipForge AI (`clipforge/`)

See `clipforge/README.md` for architectural details. Key points:
- Frames sent to Gemini, never the video file (memory efficiency)
- Export uses canvas + MediaRecorder, not ffmpeg.wasm (browser-native)
- Has real tests; run after changes: `cd clipforge && node test/run.cjs && node test/server.mjs`

## Critical Constraints & Maintenance

1. **Service Worker Cache**: If you edit `index.html`, bump `CACHE_NAME` in `service-worker.js` (e.g., `v3` → `v4`). Phones with app installed will otherwise keep serving old version indefinitely.

2. **Function Deduplication**: Helper code (`readCookies`, `cookie`, `clear`, `json`, `refreshToken`, `getToken`) is copy-pasted across all six TikTok functions. **A fix to shared logic must be applied to all six files**, not just one.

3. **Protected Files** (must not delete or move)
   - `tiktoki9V4P24zCg4MLfNepik5XiPo2NTlZ0Vd.txt` — TikTok domain-ownership verification (breaks URL verification if removed)
   - `privacy.html` / `terms.html` — URLs registered with TikTok app review and linked from footer

4. **App Boundary**: `netlify/functions/lib/` is NOT deployed as a function because it has no entry file. Keep it that way.

## Running / Deploying

- **Local front-end work**: Open `index.html` directly in browser (TikTok panel disabled outside https)
- **Local serverless work**: Need Netlify CLI (`netlify dev`); check with user before adding setup
- **Deploy**: git-push-to-deploy → Netlify auto-builds (build command empty; publish dir `.`; functions dir `netlify/functions`)

## Roadmap & Known Issues

### To Verify
- **TikTok upload-from-browser CORS**: Confirm browser-direct PUT to TikTok works. If rejected, route bytes through `tiktok-upload-init.js` instead of direct PUT.

### Future Enhancements
- Consider CLI tooling for local Netlify function testing (low priority; currently manual via netlify dev)
- Monitor ClipForge Gemini API costs; document frame-sending strategy trade-offs

## Content / Tone

User-facing generated copy (captions, TOC scripts) targets Malaysian creator mixing Bahasa Melayu ("BM Santai"), English, and "Mix".

**Grammar invariant** (critical for caption generation):
- `TAGMETA` pain/ben fields: `pain` = noun phrase, `ben` = predicate
- Hook templates in `makeHook()` assume this shape
- Any edit must preserve grammatical role

---

**Session Discipline**: One task per session. Close session when task is done. Work on designated branch only.
