import { getStore } from "@netlify/blobs";

const KEY = "exams";

// GET  -> list all exams (seeds from bundled exams.json on first run)
// PUT  -> replace full exams array (admin save, body = JSON array)
// POST -> append single exam (body = exam object, id auto-generated if missing)
export default async (req) => {
  const store = getStore("soho-calendar");

  if (req.method === "GET") {
    let data = await store.get(KEY, { type: "json" });
    if (!data) {
      const seedUrl = new URL("/exams.json", req.url).toString();
      const r = await fetch(seedUrl);
      if (!r.ok) {
        return new Response("Seed exams.json missing", { status: 500 });
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
    try {
      parsed = JSON.parse(text);
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }
    if (!Array.isArray(parsed)) {
      return new Response("Expected JSON array", { status: 400 });
    }
    const check = validateExams(parsed);
    if (check) return new Response(check, { status: 400 });
    await store.setJSON(KEY, parsed);
    return new Response("OK");
  }

  if (req.method === "POST") {
    const text = await req.text();
    let exam;
    try {
      exam = JSON.parse(text);
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }
    const check = validateExams([exam]);
    if (check) return new Response(check, { status: 400 });
    let data = (await store.get(KEY, { type: "json" })) || [];
    if (!exam.id) {
      exam.id =
        "exam-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    }
    if (data.some((e) => e.id === exam.id)) {
      return new Response("Exam id already exists", { status: 409 });
    }
    data.push(exam);
    await store.setJSON(KEY, data);
    return new Response(JSON.stringify(exam), {
      headers: { "Content-Type": "application/json" },
    });
  }

  if (req.method === "DELETE") {
    const url = new URL(req.url);
    const id = url.searchParams.get("id");
    if (!id) return new Response("Missing ?id=", { status: 400 });
    let data = (await store.get(KEY, { type: "json" })) || [];
    data = data.filter((e) => e.id !== id);
    await store.setJSON(KEY, data);
    return new Response("OK");
  }

  return new Response("Method not allowed", { status: 405 });
};

function validateExams(arr) {
  for (const e of arr) {
    if (!e || typeof e.title !== "string" || !e.title.trim())
      return "Each exam needs a title";
    if (!Array.isArray(e.questions) || e.questions.length === 0)
      return `Exam "${e.title}" needs at least 1 question`;
    for (const q of e.questions) {
      if (!q.q || !q.type) return `Exam "${e.title}" has a question missing q/type`;
      if (!["mcq", "tf", "short"].includes(q.type))
        return `Unknown question type "${q.type}"`;
      if (q.type === "mcq") {
        if (!Array.isArray(q.options) || q.options.length < 2)
          return `MCQ "${q.q}" needs 2+ options`;
        if (typeof q.answer !== "number" || q.answer < 0 || q.answer >= q.options.length)
          return `MCQ "${q.q}" has invalid answer index`;
      }
      if (q.type === "tf" && typeof q.answer !== "boolean")
        return `True/False "${q.q}" answer must be true/false`;
      if (q.type === "short" && typeof q.modelAnswer !== "string")
        return `Short answer "${q.q}" needs a modelAnswer`;
    }
  }
  return null;
}

export const config = { path: "/api/exams" };
