# Ultramain Batch Planner

Personal weekly TikTok planner for @ultramain, plus the TikTok API integration.

The site itself is plain files in this folder. The TikTok connection runs as six small
serverless functions in `netlify/functions/`.

---

## Why this folder is different from the old one

Netlify's drag-and-drop only publishes static files — it cannot run server code. The
TikTok login needs server code, because TikTok requires the client secret to be kept on a
server and never in a web page. So this folder gets published a different way: through
GitHub. After the one-time setup, updating the site is easier than dragging files.

---

## Setup — do these once, in order

### A. Put this folder on GitHub (no terminal needed)

1. Make a free account at **github.com** if you don't have one
2. Click **+** (top right) → **New repository**
3. Name it `batch-planner`, choose **Private**, click **Create repository**
4. On the next page click **uploading an existing file**
5. Open this `batch-planner-repo` folder on your computer, select **everything inside
   it**, and drag it onto the GitHub page.
   Important: drag the *contents*, not the folder itself, and make sure the
   `netlify` folder comes with it.
6. Click **Commit changes**

You should end up seeing `index.html`, `netlify.toml` and a `netlify` folder listed.

### B. Connect GitHub to your existing Netlify site

1. Go to **app.netlify.com** → your `ultramain-batch-planer` site
2. **Site configuration** → **Build & deploy** → **Continuous deployment**
3. Click **Link repository**, choose GitHub, authorise it, pick `batch-planner`
4. Build command: **leave empty**. Publish directory: **`.`** (a single dot)
5. Deploy

Your URL stays exactly the same. From now on, any file you change on GitHub redeploys the
site automatically.

### C. Add your TikTok keys as environment variables

**Never put the client secret in a file.** It goes only here, where it stays on the server.

1. Netlify → your site → **Site configuration** → **Environment variables**
2. Add these three:

| Key | Value |
|---|---|
| `TIKTOK_CLIENT_KEY` | your client key from the TikTok developer portal |
| `TIKTOK_CLIENT_SECRET` | your client secret from the same page |
| `TIKTOK_REDIRECT_URI` | `https://ultramain-batch-planer.netlify.app/auth/callback` |

3. Redeploy (Deploys → Trigger deploy → Clear cache and deploy site)

While testing in **Sandbox**, use the sandbox's own client key and secret, not the
production ones.

### D. Check the redirect URI matches

In the TikTok developer portal, Login Kit → Redirect URI must be exactly:

```
https://ultramain-batch-planer.netlify.app/auth/callback
```

If this doesn't match character for character, login fails with a "redirect_uri" error.

### E. Try it

Open your site → **Performance** tab → **Log in with TikTok**.

If it works you'll come back to the app with a green "TikTok connected" card showing your
username. Then **Sync stats from TikTok** replaces the weekly CSV export, and each day in
Plan Week gets a **Send clip to TikTok** button.

---

## What each function does

| File | URL | Purpose |
|---|---|---|
| `tiktok-login.js` | `/api/tiktok/login` | Sends you to TikTok to authorise |
| `tiktok-callback.js` | `/auth/callback` | Swaps the code for a token, stores it in a secure cookie |
| `tiktok-me.js` | `/api/tiktok/me` | Reports whether you're connected, and as who |
| `tiktok-upload-init.js` | `/api/tiktok/upload-init` | Asks TikTok where to send a video |
| `tiktok-stats.js` | `/api/tiktok/stats` | Reads your recent post metrics |
| `tiktok-logout.js` | `/api/tiktok/logout` | Revokes the token and clears the cookie |

Tokens live in HttpOnly cookies — the page's JavaScript can't read them, and they're
never stored on any server. Access tokens refresh automatically when they expire.

---

## The one thing to test first

The upload works like this: the function asks TikTok for an upload URL, then **your
browser sends the video bytes straight to TikTok**. That keeps large videos out of the
serverless function, which has a small size limit.

The unknown is whether TikTok's upload endpoint accepts a request sent directly from a
browser, or only from a server. If the browser is refused you'll see a CORS error in the
console when you hit **Send clip to TikTok**.

If that happens, the fix is to route the bytes through the function instead. Your clips
are 10-17 seconds so they're small enough for that to work. Tell me and I'll switch it —
it's a change to one file.

Everything else — login, connection status, stats sync — is a normal server-to-server
call and has no such uncertainty.

---

## Updating the app later

Edit the file on GitHub (click the file → pencil icon → Commit), or drag a replacement
onto the repo. Netlify redeploys within a minute.

If you change `index.html`, bump `CACHE_NAME` in `service-worker.js` (e.g. `v3` → `v4`),
otherwise phones with the app installed keep serving the old cached version.

---

## Files that must not be deleted

- `tiktoki9V4P24zCg4MLfNepik5XiPo2NTlZ0Vd.txt` — proves to TikTok you own the domain.
  If this disappears from the site, your URL verification breaks.
- `privacy.html` and `terms.html` — their URLs are registered with TikTok, and the app
  footer links to them, which the review requires.
