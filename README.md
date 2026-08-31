# Ultramain Batch Planner

Personal weekly TikTok planner for @ultramain — plan a week of posts, generate captions
and on-screen TOC scripts, and track performance from your own manually-exported data.

The site is plain static files (`index.html`, no build step). There is no TikTok API
integration — you post manually via TikTok's own app/website, then bring your performance
numbers back in yourself (CSV import or a quick manual-entry form). `netlify/functions/`
only hosts ClipForge's Gemini proxies now (a separate app in this repo — see its own
README); Batch Planner itself makes no server calls.

---

## Deploying

Git-push-to-deploy on Netlify: push to the connected branch and Netlify rebuilds
automatically (build command empty, publish dir `.`).

If you change `index.html`, bump `CACHE_NAME` in `service-worker.js` (e.g. `v3` → `v4`),
otherwise phones with the app installed keep serving the old cached version.

---

## Bringing your performance data in

TikTok has no supported way for a personal, non-business app to pull post metrics or
push uploads on your behalf without going through their formal API review — so this app
doesn't try. Instead, from the **Performance** tab:

- **⬆ Import CSV** — export your weekly analytics from TikTok Studio (Analytics →
  Download data) and import the file directly. Matches rows to your saved products by
  TikTok Video ID; anything unmatched prompts you to pick the product by hand.
- **✎ Log manually** — type in a single post's views/likes/comments/shares/orders/GMV
  without a CSV at all.

Both paths feed the same performance log that drives the hook/TOC-angle stats and the
weekly planner's anti-repeat scoring.

---

## Files that must not be deleted

- `tiktoki9V4P24zCg4MLfNepik5XiPo2NTlZ0Vd.txt` — proves to TikTok you own the domain.
  If this disappears from the site, your URL verification breaks.
- `privacy.html` and `terms.html` — their URLs are registered with TikTok, and the app
  footer links to them, which the review requires.
