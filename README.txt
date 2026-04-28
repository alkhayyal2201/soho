Soho Training Calendar — Netlify App with Autosave
====================================================

Files:
  index.html                       — the app
  data.json                        — seed content (used only on first deploy)
  _headers                         — tells Netlify not to cache data.json
  netlify.toml                     — points Netlify at the function
  netlify/functions/data.mjs       — serverless GET/PUT for live calendar data

How content is stored
---------------------
- Live data lives in Netlify Blobs (a key-value store that comes free with
  every Netlify site). The serverless function at /api/data reads and writes it.
- On first request after deploy (or when the blob is empty), the function
  seeds itself from the bundled data.json.
- After that, data.json is no longer the source of truth — the blob is.
- File attachments are still stored in the visitor's IndexedDB (browser-only,
  not shared between visitors).

Editing
-------
1. Open the deployed site, click Edit.
2. Toggle training days, edit sessions, etc. There is NO save button —
   every change is autosaved (~600ms after you stop) to the blob via PUT.
3. Other visitors will see the change on their next page load.

A small "Saving…" / "Saved" indicator appears in the top bar while editing.

Deploy to Netlify (drag-and-drop)
---------------------------------
1. Go to https://app.netlify.com/drop
2. Drag this entire folder (soho-calendar) onto the page.
3. Netlify gives you a URL.
4. Visit it. The function auto-seeds from data.json on first GET.

If you re-drag the folder later, your existing edits stay intact —
the blob is owned by the site, not the deploy bundle. (Replacing data.json
won't reset live data; the blob already has its own copy.)

Resetting live data
-------------------
If you want to wipe live data and re-seed from data.json:
- Easiest: in the Netlify dashboard, go to your site → Storage → Blobs,
  open the "soho-calendar" store, and delete the "calendar" key.
- Next page load will re-seed from data.json.

Local preview (limited)
-----------------------
A plain `python3 -m http.server` will not work — the function isn't served.
Use the Netlify CLI:
   npm install -g netlify-cli
   netlify dev
This starts a local server (default http://localhost:8888) that runs the
function alongside the static files.
