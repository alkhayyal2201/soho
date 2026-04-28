import { getStore } from "@netlify/blobs";

const KEY = "calendar";

export default async (req) => {
  const store = getStore("soho-calendar");

  if (req.method === "GET") {
    let data = await store.get(KEY, { type: "json" });
    if (!data) {
      const seedUrl = new URL("/data.json", req.url).toString();
      const r = await fetch(seedUrl);
      if (!r.ok) {
        return new Response("Seed data.json missing", { status: 500 });
      }
      data = await r.json();
      await store.setJSON(KEY, data);
    }
    return new Response(JSON.stringify(data), {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    });
  }

  if (req.method === "PUT") {
    const text = await req.text();
    let parsed;
    try { parsed = JSON.parse(text); }
    catch { return new Response("Invalid JSON", { status: 400 }); }
    if (!Array.isArray(parsed)) {
      return new Response("Expected JSON array", { status: 400 });
    }
    await store.setJSON(KEY, parsed);
    return new Response("OK");
  }

  return new Response("Method not allowed", { status: 405 });
};

export const config = { path: "/api/data" };
