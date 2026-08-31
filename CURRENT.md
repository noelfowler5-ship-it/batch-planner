# Batch Planner — Current Sprint

**Status**: Active maintenance + testing

## What's In Flight

### 1. Verify TikTok Upload CORS (HIGH PRIORITY)

**Issue**: Two-step upload flow assumes browser can PUT video bytes directly to TikTok after `tiktok-upload-init.js` returns `upload_url`.

**Test Required**:
- [ ] Confirm browser-direct PUT to TikTok upload_url succeeds (no CORS rejection)
- [ ] Test with actual TikTok auth + small video file
- [ ] Document CORS headers TikTok sends (or doesn't send)

**Success Criteria**:
- Video uploads from browser without error
- No CORS preflight failure
- No need to route bytes through serverless function

**If CORS Rejected**:
- Modify upload flow to route bytes through `tiktok-upload-init.js`
- Test new flow end-to-end
- Update PROJECT.md "Upload Flow" section

**Why This Matters**: If CORS fails silently or TikTok rejects direct PUTs, users can't upload → feature breaks. Better to verify now than in production.

---

## What's Blocked / On Hold

- **ClipForge Gemini costs**: Monitor but no action yet (frame-sending strategy is intentional trade-off)
- **Netlify CLI local setup**: Deferred unless user asks (currently manual testing only)

---

## What's Done (Last Session)

- Scaffolded PROJECT.md and CURRENT.md (this session)
- Created companion sessions for personal-cfo and Signalvest

---

## Next Steps After CORS Verification

1. **If upload works**: Mark complete, close this task
2. **If CORS fails**: Implement serverless byte routing, test, deploy
3. **Either way**: Document findings in README.md or test notes

---

**Branch**: `claude/tiktok-affiliate-manager-setup-5xpu6k`
**Session Discipline**: Report findings when CORS test is complete, then close session.
