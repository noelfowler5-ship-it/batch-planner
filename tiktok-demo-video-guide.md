# TikTok Demo Video — how to make it

For app **Ultramain Batch Planner**, submitting Login Kit + Content Posting API + `video.list`.

---

## Read this first

The video must be a **real screen recording of your app actually working with TikTok**.
Reviewers check that the domain on screen matches your registered URL, that real clicks
happen, and that each scope you requested is visibly used.

A mocked-up, edited-together, or AI-generated video is misrepresenting your app. It gets
applications rejected and can cost you the developer account. There is no shortcut here —
but once the integration works, the recording itself takes about ten minutes.

**So the video is not the task. Building the integration is the task.**

---

## Prerequisites, in order

### 1. Set up the Sandbox

First-time apps must be demonstrated in Sandbox, not Production. In the developer portal
there's a **Sandbox** tab next to **Production** at the top of your app page. Create the
sandbox and add your own TikTok account as a test user. The sandbox gives you a separate
client key/secret to use while recording.

### 2. Build the integration

Three pieces, all of which must be visible in the video:

| Scope | What has to work on screen |
|---|---|
| `user.info.basic` | "Log in with TikTok" → your app shows the connected username |
| `video.upload` | Pick a clip + caption in your app → it lands in TikTok |
| `video.list` | Your app pulls your recent post stats and displays them |

The login step needs a small server component — TikTok treats web apps as confidential
clients, so the client secret cannot sit in your static page. Your current Netlify
drag-and-drop deploy is static-only and **cannot host this**. You'll need one of:

- **Connect a GitHub repo to Netlify** — no terminal needed, upload files through
  GitHub's website, Netlify redeploys automatically. Best fit for you.
- Netlify CLI — requires using a terminal.
- Vercel — same idea, also needs GitHub or a terminal.

### 3. Test the whole flow end to end before recording

Every step must work without errors. A video showing a failure will be rejected.

---

## Recording tools (all free, already on Windows 11)

**Clipchamp** — built into Windows 11. Screen record *and* trim in one place.
Search "Clipchamp" in the Start menu. Best all-round choice.

**OBS Studio** (obsproject.com) — free, records the full screen reliably, more control.
Good if Clipchamp gives you trouble.

**Xbox Game Bar** (`Win` + `G`) — fastest, but it records only *one app window* and stops
if you switch apps. Fine here since everything happens in Chrome, but the other two are
safer.

### Settings

- Format: **mp4** (or mov)
- Resolution: 1080p is plenty
- Size limit: **50MB per file**, up to 5 files — a 2-minute 1080p clip is comfortably under
- No music or voiceover needed. Silent is fine.

---

## Shot list — record in this exact order, one continuous take

Keep the **browser address bar visible the whole time.** This is how the reviewer confirms
the domain matches `ultramain-batch-planer.netlify.app`. Do not crop it out.

**1. Open your app** (5s)
Start on `https://ultramain-batch-planer.netlify.app/` with the address bar clearly readable.
Let it sit for a couple of seconds so the reviewer can read the URL.

**2. Start the login** (5s)
Click your "Log in with TikTok" button. Move the mouse deliberately — reviewers need to see
the interaction, not a jump cut.

**3. TikTok's authorization screen** (10s)
The TikTok consent page appears listing the permissions being requested. Pause here for a
few seconds so the requested scopes are readable on screen. Then click Authorize.

**4. Back in your app, logged in** (5s)
Your app shows the connected account — "Connected as @ultramain" or similar. This is your
proof of `user.info.basic`.

**5. Prepare a post** (15s)
Open a product, pick a clip and one of the generated captions. Show the caption text on
screen. This is the part reviewers like — it shows the app has a real purpose.

**6. Send it to TikTok** (15s)
Click your upload button. Show the success state in your app.

**7. Show it arrived** (15s)
Switch to a TikTok tab and show the video sitting in your drafts/inbox. This is your proof
of `video.upload`. (If you later turn Direct Post on, you'd show it posted to the profile
instead.)

**8. Pull the stats** (15s)
Back in your app, trigger the stats refresh. Show views/likes/comments appearing in the
performance table without any CSV import. This is your proof of `video.list`.

Total: roughly 90 seconds.

---

## What gets videos rejected

- Address bar hidden or domain doesn't match the registered URL
- Recorded in Production instead of Sandbox for a first-time app
- A requested scope never shown working — **every** scope must appear
- Jump cuts that hide the actual interaction
- Any error message visible on screen
- Screenshots stitched together instead of a live recording

If you decide you don't need a scope, remove it from the app *before* submitting rather
than leaving it undemonstrated. An unused scope in the list will delay the review.

---

## Final checklist before you upload

- [ ] Recorded in **Sandbox**
- [ ] Address bar readable throughout, domain matches
- [ ] Login → username shown  (`user.info.basic`)
- [ ] Clip + caption → sent → visible in TikTok  (`video.upload`)
- [ ] Stats pulled and displayed  (`video.list`)
- [ ] No errors visible
- [ ] mp4, under 50MB
- [ ] One continuous take, no stitched screenshots
