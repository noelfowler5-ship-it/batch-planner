# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A personal weekly TikTok content planner for one creator (@ultramain, kitchen-gadget
affiliate niche). It's a static, no-build, no-framework PWA (`index.html`) plus six small
Netlify serverless functions (`netlify/functions/`) that handle TikTok OAuth/API access
the browser can't do safely (client secret must stay server-side).

There is no test suite, no linter, and no build step. `package.json` only exists to mark
`"type": "module"` for the Netlify functions.

## Running / deploying

There's no local dev server config in this repo. In practice:
- Open `index.html` directly in a browser for pure front-end work (planner, captions, TOC
  generator, localStorage/IndexedDB) — the TikTok panel simply stays disabled since
  `location.protocol` won't be http(s).
- To exercise the Netlify functions locally you'd need the Netlify CLI (`netlify dev`),
  which is not currently set up in this repo — check with the user before adding tooling.
- Deployment is **git-push-to-deploy**: pushing to the connected GitHub branch triggers a
  Netlify build automatically (build command is empty; publish dir is `.`; functions dir is
  `netlify/functions`, per `netlify.toml`). There is no CI.

**If you edit `index.html`, bump `CACHE_NAME` in `service-worker.js`** (e.g. `v3` → `v4`).
The service worker aggressively caches app files for offline/installed use; without a cache
bump, phones with the app installed keep serving the old version indefinitely.

## Architecture

### Front end: `index.html` (single file, ~1700 lines)

Vanilla JS, no framework, Tailwind via CDN (`<script src="https://cdn.tailwindcss.com">`).
Everything — markup, one `<style>` block, and one big `<script>` — lives in this one file.
When making changes, search within it rather than expecting a multi-file layout.

**State & persistence**
- `state` (in-memory) holds `products`, `logs`, `plans`, `settings`, plus UI state
  (`tab`, `sort`, `subtab`). Loaded from `localStorage` via `K` keys (`ttbp_products`,
  `ttbp_logs`, `ttbp_plans`, `ttbp_settings`) using `load()`/`save()`/`saveAll()`.
- Video **files** (blobs + thumbnails) go in IndexedDB (`ttbp-db` / `videos` store,
  `openDB()`/`idbGet()`/`idbPut()`), not localStorage — that's why `attachFile()` and
  `getThumb()` are async.
- Data model: `products` (top-level, one per affiliate product) each hold `videos[]`
  (individual clips: file ref, TikTok post id, `timesPosted`, `history[]`, per-language
  caches). `newProduct()`/`newVideo()` show the canonical shape.

**Rendering pattern**
- No virtual DOM / reactivity. Each tab has a `render<Tab>()` function
  (`renderPlan`, `renderPerf`, `renderProducts`) that builds an HTML string and sets
  `innerHTML`. `render()` dispatches on `state.tab`; `switchTab()` toggles visible
  `#view-*` sections and calls `render()`.
- All interactivity is a **single delegated click listener** on `document` keyed off
  `data-action` attributes (see the big `switch (a)` around line 1468) — there are no
  per-element `addEventListener` calls in the rendered markup. When adding a new button,
  give it `data-action="..."` (+ `data-*` params) and add a `case` in that switch, rather
  than wiring a listener by hand.
- Modals are generic: `openModal(html)` / `closeModal()` inject into one modal container;
  form-building functions like `productForm()`, `videoForm()`, `manualLogForm()`,
  `slotSwapForm()`, `helpModal()` just return HTML strings for it.

**Content generation engine** (this is most of the domain logic):
- Caption generation: `TAGMETA` maps preset benefit tags → BM/EN pain point + benefit
  phrasing; `makeHook()`/`generateCaptions()`/`captionsFor()` combine these with `HOOKS`
  (question/pov/price) and cache results on the product (`captionCache`) per language.
- TOC (talking-over-camera / voiceover script) generation: `sceneCount()`/`sceneTimes()`
  derive a scene plan from clip duration (`TOC_SEC_PER_SCENE`), `TOC_PLANS` supplies
  per-hook-angle scene templates, `generateTOC()`/`tocFor()` assemble and cache per video
  (`tocCache`). **Captions are resolved before TOC** because TOC hook lines mirror the
  caption hook — see the comment above `tocFor()`.
- Editing a tag's `pain`/`ben` phrasing must preserve grammatical shape: `pain` values are
  noun phrases, `ben` values are predicates (see comment above `TAGMETA`) — the hook
  templates in `makeHook()` assume this.

**Weekly planning**: `buildPlan()` picks which product/video goes in each day's slot using
`videoScore()` (recency, an anti-repeat `REUSE_PENALTY`, and `BACKTOBACK_PENALTY` for
avoiding the same product two days running). `getPlan(weekKey, create)` lazily builds/fetches
a plan for a given ISO week (`currentWeekKey()`, `mondayOf()`).

**Performance tracking**: two paths feed `state.logs` — manual weekly CSV import
(`parseCSV`/`mapHeaders`/`COLMAP` fuzzy-matches TikTok's export column names) and, if
connected, live sync via `ttSync()`/`ttFetch()` hitting the Netlify functions.
`angleStats()`/`bestAngle()` compute which hook/TOC angle performs best.

### Back end: `netlify/functions/*.js` (TikTok integration)

Six independent Netlify Edge/serverless functions, each declaring its own URL path via
`export const config = { path: '...' }`. **Each file is fully self-contained and repeats
the same ~50 lines of helpers** (`readCookies`, `cookie`, `clear`, `json`, `refreshToken`,
`getToken`) rather than importing a shared module. This is deliberate simplicity for a
6-function project, but it means **a fix to the shared logic (e.g. token refresh, cookie
flags) must be applied to all six files**, not just one.

| File | Path | Purpose |
|---|---|---|
| `tiktok-login.js` | `/api/tiktok/login` | Redirects to TikTok OAuth, sets CSRF `tt_state` cookie |
| `tiktok-callback.js` | `/auth/callback` | Exchanges code for tokens, sets HttpOnly cookies |
| `tiktok-me.js` | `/api/tiktok/me` | Connection status + username |
| `tiktok-stats.js` | `/api/tiktok/stats` | Recent post metrics (used by "Sync stats") |
| `tiktok-upload-init.js` | `/api/tiktok/upload-init` | Returns a TikTok upload URL |
| `tiktok-logout.js` | `/api/tiktok/logout` | Revokes token, clears cookies |

Key conventions:
- Tokens live only in **HttpOnly, Secure, SameSite=Lax cookies** (`tt_access`,
  `tt_refresh`, `tt_exp`) — never touched by front-end JS, never persisted server-side.
  `getToken()` transparently refreshes when `tt_exp` is near.
- Required env vars: `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`, `TIKTOK_REDIRECT_URI`
  (set in Netlify site config, never committed).
- Video upload is a two-step flow by design: `tiktok-upload-init.js` only asks TikTok for
  an `upload_url`; the actual video bytes go **browser → TikTok directly** (`ttUpload()` in
  `index.html` does a `PUT`), keeping large files off the serverless function's payload
  limit. If TikTok ever rejects direct-from-browser PUTs (CORS), the fix is routing bytes
  through the function instead — see README "The one thing to test first".

## Files that must not be deleted or moved

- `tiktoki9V4P24zCg4MLfNepik5XiPo2NTlZ0Vd.txt` — TikTok domain-ownership verification file.
  Removing it breaks TikTok URL verification.
- `privacy.html` / `terms.html` — URLs are registered with TikTok's app review and linked
  from the app footer.

## Language / content conventions

User-facing generated copy (captions, TOC scripts) targets a Malaysian creator and mixes
Bahasa Melayu ("BM Santai"), English, and "Mix", selectable via `LANGS`/`state.settings.lang`.
Keep new vocabulary/phrasing consistent with the existing `TAGMETA`/`FALLBACK`/`HOOKS`
tone (casual, benefit-and-pain-point driven, TikTok-native).
