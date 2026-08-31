# Batch Planner — Current Sprint

**Status**: TikTok API integration removed; manual-data + compliance work done this session

## What Happened This Session

### 1. TikTok upload-flow verification — blocked, then redirected (resolved)

The original task was to verify the two-step TikTok upload flow (browser-direct `PUT`
of video bytes to TikTok after `tiktok-upload-init.js` returns an `upload_url`) end to
end, live.

**Could not be completed as asked** — two independent hard blockers, not a choice to skip:
- This session had no TikTok account connected and no OAuth credentials (`TIKTOK_CLIENT_KEY`/`SECRET` unset, no live deployed URL with an active session).
- This session's network egress is blocked to all TikTok domains outright (`open.tiktokapis.com`, `developers.tiktok.com` — confirmed via direct `curl`, proxy returned 403 before ever reaching TikTok).

Secondary evidence gathered instead (official TikTok docs + developer reports): the
Content Posting API's media-transfer guide documents the `upload_url` `PUT` exclusively
via server-side `curl` examples; no CORS or browser-compatibility language appears
anywhere in TikTok's docs. Consistent with — but not proof of — the CORS-rejection risk
already flagged before this session started.

**Resolution**: rather than keep chasing verification, the user decided to **drop the
TikTok API integration entirely** — see below.

### 2. Removed the entire TikTok API integration (DONE)

- Deleted all six Netlify functions: `tiktok-login.js`, `tiktok-callback.js`, `tiktok-me.js`, `tiktok-stats.js`, `tiktok-upload-init.js`, `tiktok-logout.js`
- Removed every UI/JS touchpoint in `index.html`: `state.tt`, `ttFetch/ttCheck/ttLogout/ttSync/ttUpload/ttPanel`, "Connect TikTok"/"Sync stats"/"Send clip to TikTok" buttons, the `?tt=connected` redirect handler, the "Auto-sync from TikTok — coming soon" placeholder button
- **Kept** the video's `tiktokId` field, `findByTiktokId()`, `historyForDate()`, CSV import, and `manualLogForm()` — these were always the manual data path (not API-dependent) and are now the *only* path
- Rewrote README.md (was entirely OAuth setup instructions, now describes the manual-only data flow)
- Confirmed `privacy.html` already said "not currently implemented" for TikTok account access — now accurate again, no edit needed
- Bumped `CACHE_NAME` in `service-worker.js` (`v4` → `v5`)
- Verified `clipforge/` untouched (separate app, out of scope)
- Verified inline `<script>` in `index.html` still parses (Node `new Function()` check, both blocks OK)

### 3. Added GMV to the manual/CSV data pipeline (DONE)

User specifically wanted GMV and conversion-related metrics, uploaded manually:
- `COLMAP`: added `gmv` fuzzy-match candidates (gmv, est gmv, estimated gmv, total gmv, gross merchandise value)
- `handleCSV()`: parses and stores `gmv` per row, both new entries and dupe-merge
- `manualLogForm()`: added a "GMV RM (optional)" input field, threaded through submit handler
- `renderPerf()`: added a "GMV per post" stat line (only shown when `totalGmv > 0`), alongside the existing "Orders per post" line
- `exportCSV()`: added `gmv` column
- `sampleCSV()`: sample download now includes `orders` and `gmv` columns so the expected format is visible

### 4. Compliance pass on caption/TOC generators (DONE)

User asked that the caption generator, TOC generator, "and etc" not violate TikTok's
Community Guidelines / Content Posting rules. Two concrete issues found and fixed:

- **Missing paid-promotion disclosure**: generated captions had no affiliate/ad
  disclosure at all. Added `disclosureLine(lang)` — a plain-language sentence (not
  hashtag-only, which TikTok's Branded Content policy treats as insufficient),
  inserted as the second line of every generated caption (right under the hook, before
  the reader has to tap "more"). All three languages covered (BM/EN/Mix).
- **Fabricated social-proof claims**: `proofLine()` (captions) and `tocElement('proof', ...)`
  (TOC) asserted unverifiable facts — "Ramai yang dah beli & repeat order" / "Repeat
  buyers love it" / "Bukan barang baru — memang laris" — with nothing backing them.
  Replaced with honest alternatives that redirect to TikTok Shop's own real review data
  instead of asserting sales/popularity facts. The `p.limited` (stock scarcity) branch
  was left untouched since it's a user-truthful field, not a generator-invented claim.
- Reviewed `TAGMETA` pain/benefit phrasing and `makeHook()` — no medical/miracle/unverifiable
  claims found there; no changes needed.
- Did NOT touch `clipforge/gemini-policy-check.js` (separate app, out of scope) — its
  flag categories (FAKED_PROMOTION, UNDISCLOSED_AD, FAKE_TESTIMONIAL, UNVERIFIABLE_CLAIM)
  were used as a reference checklist for this review, credited in PROJECT.md.

All four items committed and pushed together (see git log on this branch).

---

## What's Blocked / On Hold

- **ClipForge Gemini costs**: Monitor but no action yet (frame-sending strategy is intentional trade-off) — unrelated to this session's work.

---

## Next Steps

Nothing queued. If a future session wants to revisit TikTok API integration, the CORS
verification blocker documented above (missing account + blocked network) needs a
different environment or the user's own manual test — don't just re-attempt it here.

---

**Branch**: `claude/tiktok-affiliate-manager-setup-5xpu6k`
**Session Discipline**: This task is complete. Close session.
