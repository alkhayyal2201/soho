import { getStore } from "@netlify/blobs";
import crypto from "node:crypto";

// Shared team attachments, stored in Netlify Blobs (visible to every user).
// Chunked upload keeps each request well under the function payload limit.
const MAX_FILE = 50 * 1024 * 1024; // 50 MB
const MAX_CHUNK_B64 = 6 * 1024 * 1024; // ~4.5 MB raw per chunk request
const UPLOAD_TTL = 2 * 3600 * 1000; // stale uploads cleaned after 2h

const metaKey = (month) => `files_${month}`;
const binKey = (id) => `filebin_${id}`;
const upKey = (id) => `up_${id}`;
const chunkKey = (id, i) => `up_${id}_c${i}`;

/* ---------- session tokens (same scheme as users.mjs) ---------- */
function secret() {
  return (
    process.env.AUTH_SECRET || "soho-dev-secret-CHANGE-ME-in-netlify-env"
  );
}
function b64u(buf) {
  return Buffer.from(buf)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
function unb64u(s) {
  s = String(s).replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  return Buffer.from(s, "base64").toString("utf8");
}
function verifyToken(tok) {
  try {
    const [body, sig] = String(tok).split(".");
    if (!body || !sig) return null;
    const want = b64u(
      crypto.createHmac("sha256", secret()).update(body).digest()
    );
    const a = Buffer.from(sig);
    const b = Buffer.from(want);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    const p = JSON.parse(unb64u(body));
    if (!p.u || !p.exp || p.exp < Date.now()) return null;
    return p;
  } catch {
    return null;
  }
}

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
// Storage reads can trail writes briefly; wait until a just-written meta
// list becomes visible (bounded) so the next user action sees fresh state.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitForMeta(store, month, id, wantPresent) {
  for (let t = 0; t < 5; t++) {
    const list = (await store.get(metaKey(month), { type: "json" })) || [];
    const found = list.some((x) => x.id === id);
    if (found === wantPresent) return;
    await sleep(1000);
  }
}
const MONTHS = new Set(Array.from({ length: 12 }, (_, i) => String(i)));

export default async (req) => {
  const store = getStore("soho-calendar");
  const url = new URL(req.url);

  // ---- all file endpoints need a logged-in user ----
  const h = req.headers.get("authorization") || "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  const tok = verifyToken(m ? m[1].trim() : null);
  if (!tok) return json({ error: "Unauthorized — please sign in" }, 401);

  /* ---------- GET ---------- */
  if (req.method === "GET") {
    const id = url.searchParams.get("id");
    // Download bytes
    if (id) {
      const safe = String(id).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40);
      const data = await store.get(binKey(safe), { type: "arrayBuffer" });
      if (!data) return json({ error: "File not found" }, 404);
      // Look up original name/type from meta lists
      let name = safe,
        type = "application/octet-stream";
      for (let mi = 0; mi < 12; mi++) {
        const list = (await store.get(metaKey(mi), { type: "json" })) || [];
        const f = list.find((x) => x.id === safe);
        if (f) {
          name = f.name;
          type = f.type || type;
          break;
        }
      }
      return new Response(data, {
        headers: {
          "Content-Type": type,
          "Content-Disposition":
            "attachment; filename*=UTF-8''" + encodeURIComponent(name),
          "Cache-Control": "no-store",
        },
      });
    }
    // List month
    const month = url.searchParams.get("month");
    if (month === null || !MONTHS.has(month)) {
      return json({ error: "Missing ?month=0..11 or ?id=" }, 400);
    }
    const list = (await store.get(metaKey(month), { type: "json" })) || [];
    return json(list);
  }

  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }
  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  /* ---------- POST init ---------- */
  if (body.action === "init") {
    const month = String(body.month ?? "");
    const name = String(body.name || "").slice(0, 150);
    const size = Math.floor(Number(body.size) || 0);
    const type = String(body.type || "application/octet-stream").slice(0, 100);
    if (!MONTHS.has(month)) return json({ error: "Invalid month" }, 400);
    if (!name) return json({ error: "Missing file name" }, 400);
    if (!(size > 0) || size > MAX_FILE)
      return json({ error: "File must be 1 byte – 50 MB" }, 400);
    // opportunistic cleanup of stale uploads
    try {
      const { blobs } = await store.list({ prefix: "up_" });
      const now = Date.now();
      for (const b of blobs || []) {
        if (/_c\d+$/.test(b.key)) continue;
        const st = await store.get(b.key, { type: "json" });
        if (st && now - (st.createdAt || 0) > UPLOAD_TTL) {
          const { blobs: chunks } = await store.list({
            prefix: b.key + "_c",
          });
          for (const c of chunks || []) await store.delete(c.key);
          await store.delete(b.key);
        }
      }
    } catch {
      /* best effort */
    }
    const id =
      "f" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    const uploadId =
      "u" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    const chunks = Math.max(1, Math.ceil(size / (3 * 1024 * 1024)));
    await store.setJSON(upKey(uploadId), {
      id,
      month,
      name,
      size,
      type,
      by: tok.u,
      byName: String(body.byName || tok.u).slice(0, 60),
      date: new Date().toLocaleDateString(),
      chunks,
      createdAt: Date.now(),
    });
    return json({ uploadId, fileId: id, chunks });
  }

  /* ---------- POST chunk ---------- */
  if (body.action === "chunk") {
    const uploadId = String(body.uploadId || "").replace(/[^a-zA-Z0-9]/g, "");
    const index = Math.floor(Number(body.index));
    const data = String(body.data || "");
    const st = await store.get(upKey(uploadId), { type: "json" });
    if (!st) return json({ error: "Upload expired — please retry" }, 404);
    if (!(index >= 0 && index < st.chunks))
      return json({ error: "Bad chunk index" }, 400);
    if (!data || data.length > MAX_CHUNK_B64)
      return json({ error: "Bad chunk data" }, 400);
    if (st.by !== tok.u) return json({ error: "Not your upload" }, 403);
    await store.set(chunkKey(uploadId, index), Buffer.from(data, "base64"));
    return json({ ok: true, index });
  }

  /* ---------- POST complete ---------- */
  if (body.action === "complete") {
    const uploadId = String(body.uploadId || "").replace(/[^a-zA-Z0-9]/g, "");
    const st = await store.get(upKey(uploadId), { type: "json" });
    if (!st) return json({ error: "Upload expired — please retry" }, 404);
    if (st.by !== tok.u) return json({ error: "Not your upload" }, 403);
    const parts = [];
    for (let i = 0; i < st.chunks; i++) {
      const c = await store.get(chunkKey(uploadId, i), { type: "arrayBuffer" });
      if (!c) return json({ error: `Missing chunk ${i + 1}/${st.chunks}` }, 400);
      parts.push(Buffer.from(c));
    }
    const buf = Buffer.concat(parts);
    if (buf.length !== st.size) {
      return json(
        { error: `Size mismatch (got ${buf.length}, want ${st.size})` },
        400
      );
    }
    await store.set(binKey(st.id), buf);
    const list = (await store.get(metaKey(st.month), { type: "json" })) || [];
    const meta = {
      id: st.id,
      name: st.name,
      size: st.size,
      type: st.type,
      date: st.date,
      by: st.by,
      byName: st.byName,
    };
    list.unshift(meta);
    await store.setJSON(metaKey(st.month), list);
    await waitForMeta(store, st.month, st.id, true);
    for (let i = 0; i < st.chunks; i++) {
      try {
        await store.delete(chunkKey(uploadId, i));
      } catch {
        /* ignore */
      }
    }
    try {
      await store.delete(upKey(uploadId));
    } catch {
      /* ignore */
    }
    return json({ ok: true, file: meta });
  }

  /* ---------- POST delete ---------- */
  if (body.action === "delete") {
    const id = String(body.id || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40);
    if (!id) return json({ error: "Missing id" }, 400);
    const months = [];
    if (body.month !== undefined && MONTHS.has(String(body.month))) {
      months.push(String(body.month));
    } else {
      for (let mi = 0; mi < 12; mi++) months.push(String(mi));
    }
    let removed = null;
    let removedMonth = null;
    for (let attempt = 0; attempt < 3 && !removed; attempt++) {
      if (attempt > 0) await sleep(1500);
      for (const mm of months) {
        const list = (await store.get(metaKey(mm), { type: "json" })) || [];
        const ix = list.findIndex((x) => x.id === id);
        if (ix >= 0) {
          removed = list[ix];
          removedMonth = mm;
          list.splice(ix, 1);
          await store.setJSON(metaKey(mm), list);
          break;
        }
      }
    }
    if (!removed) return json({ error: "File not found" }, 404);
    await waitForMeta(store, removedMonth, id, false);
    try {
      await store.delete(binKey(id));
    } catch {
      /* ignore */
    }
    return json({ ok: true });
  }

  return json({ error: "Unknown action" }, 400);
};

export const config = { path: "/api/files" };
