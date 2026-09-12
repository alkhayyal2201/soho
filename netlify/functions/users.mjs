import { getStore } from "@netlify/blobs";
import crypto from "node:crypto";

const KEY = "users";
const TOKEN_DAYS = 7;

// Seed admins (temporary passwords — must be changed on first login).
// Hashes only; plaintext temps are handed to the people, never stored here.
const SEED = [
  {
    username: "bayram",
    displayName: "Bayram",
    role: "manager",
    admin: true,
    mustChangePassword: true,
    passhash:
      "scrypt$8051a4e0655cd5a355e3b6d39957e9e9$c612f15da70d7c669bd346db955a06ffd82905f593d78180859bd3bf361e6491812a56f910501367ceb365b374da834ecc75ac673967144c80fca23f97c5807d",
  },
  {
    username: "amen",
    displayName: "Amen",
    role: "user",
    admin: true,
    mustChangePassword: true,
    passhash:
      "scrypt$53e3af44e14062f56631afaea25b25fa$2ee59c71877756b609c08e0edfc98c6185aa9283b89e6641a9fa2d33e81f9e258726806ff3f59315470ea465c78301ea8b906ad576ae0d8e084abcb8149f855d",
  },
  {
    username: "maryam",
    displayName: "Maryam",
    role: "user",
    admin: true,
    mustChangePassword: true,
    passhash:
      "scrypt$a56c8f4d460b36af4242880b1e129c7b$f705b14daf267719ab20966a82c575e41740f0d81c97e8390b884734928a7f5502ed530eecf515b572ec9f8c89814aa9a90ae301c4a3becb719c44efda3acf42",
  },
  {
    username: "osama",
    displayName: "Osama",
    role: "user",
    admin: true,
    mustChangePassword: true,
    passhash:
      "scrypt$3d72e91d40057f70ce8fc20a0a35c1b0$43c2853d9d0309e06c2af3883205175b9c4a4da1eaeac96923452a855921395238843c5a446b73eafeb02c1fb875efec2001fd27ae5c2428c1dafccdfac18ee8",
  },
];

/* ---------- password hashing (scrypt) ---------- */
function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(pw, salt, 64).toString("hex");
  return `scrypt$${salt}$${hash}`;
}
function verifyPassword(pw, stored) {
  try {
    const [tag, salt, hash] = String(stored).split("$");
    if (tag !== "scrypt" || !salt || !hash) return false;
    const check = crypto.scryptSync(pw, salt, 64);
    const ref = Buffer.from(hash, "hex");
    return check.length === ref.length && crypto.timingSafeEqual(check, ref);
  } catch {
    return false;
  }
}

/* ---------- tokens (HMAC-signed, no server session needed) ---------- */
// Secret comes from the Netlify AUTH_SECRET env var (production context).
function secret() {
  return (
    process.env.AUTH_SECRET ||
    "soho-dev-secret-CHANGE-ME-in-netlify-env"
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
function signToken(user) {
  const payload = {
    u: user.username,
    a: user.admin ? 1 : 0,
    exp: Date.now() + TOKEN_DAYS * 864e5,
  };
  const body = b64u(JSON.stringify(payload));
  const sig = b64u(
    crypto.createHmac("sha256", secret()).update(body).digest()
  );
  return body + "." + sig;
}
function readToken(req) {
  const h = req.headers.get("authorization") || "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
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

/* ---------- store helpers ---------- */
async function loadUsers() {
  const store = getStore("soho-calendar");
  let users = await store.get(KEY, { type: "json" });
  if (!users) {
    users = SEED.map((u) => ({ ...u, createdAt: new Date().toISOString() }));
    await store.setJSON(KEY, users);
  }
  return { store, users };
}
function pub(u) {
  return {
    username: u.username,
    displayName: u.displayName,
    role: u.role,
    admin: !!u.admin,
    mustChangePassword: !!u.mustChangePassword,
    createdAt: u.createdAt || null,
  };
}
const norm = (s) => String(s || "").trim().toLowerCase();
function validUsername(u) {
  return /^[a-z0-9._-]{3,30}$/.test(u);
}
const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

export default async (req) => {
  const url = new URL(req.url);

  // Admin user list via GET (Authorization: Bearer <token>)
  if (req.method === "GET") {
    const tok = verifyToken(readToken(req));
    if (!tok) return json({ error: "Unauthorized" }, 401);
    const { users } = await loadUsers();
    const me = users.find((u) => u.username === tok.u);
    if (!me || !me.admin) return json({ error: "Admin only" }, 403);
    return json(users.map(pub));
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
  const action = body.action;

  /* ----- public: login ----- */
  if (action === "login") {
    const username = norm(body.username);
    const { users } = await loadUsers();
    const user = users.find((u) => u.username === username);
    // Generic error either way (don't reveal which usernames exist)
    if (!user || !verifyPassword(String(body.password || ""), user.passhash)) {
      return json({ error: "Invalid username or password" }, 401);
    }
    return json({ token: signToken(user), user: pub(user) });
  }

  // Everything below needs a valid session token
  const tok = verifyToken(readToken(req));
  if (!tok) return json({ error: "Unauthorized" }, 401);
  const { store, users } = await loadUsers();
  const me = users.find((u) => u.username === tok.u);
  if (!me) return json({ error: "Account no longer exists" }, 401);
  const save = () => store.setJSON(KEY, users);

  /* ----- logged in: who am I (refresh flags) ----- */
  if (action === "me") {
    return json({ user: pub(me) });
  }

  /* ----- logged in: change own password ----- */
  if (action === "change-password") {
    const np = String(body.newPassword || "");
    if (np.length < 6)
      return json({ error: "New password must be at least 6 characters" }, 400);
    // Users who must change (first login) already proved identity by logging
    // in; everyone else must confirm the current password.
    if (!me.mustChangePassword) {
      if (!verifyPassword(String(body.currentPassword || ""), me.passhash)) {
        return json({ error: "Current password is incorrect" }, 403);
      }
    }
    me.passhash = hashPassword(np);
    me.mustChangePassword = false;
    await save();
    return json({ ok: true });
  }

  /* ----- admin only below ----- */
  if (!me.admin) return json({ error: "Admin only" }, 403);
  const adminCount = () => users.filter((u) => u.admin).length;

  if (action === "list") {
    return json(users.map(pub));
  }

  if (action === "create") {
    const username = norm(body.username);
    const pw = String(body.password || "");
    if (!validUsername(username))
      return json(
        { error: "Username: 3–30 chars, letters/numbers/._-" },
        400
      );
    if (users.some((u) => u.username === username))
      return json({ error: "Username already exists" }, 409);
    if (pw.length < 6)
      return json({ error: "Password must be at least 6 characters" }, 400);
    const user = {
      username,
      displayName: String(body.displayName || username).trim() || username,
      role: body.role === "manager" ? "manager" : "user",
      admin: body.admin !== false,
      mustChangePassword: true,
      passhash: hashPassword(pw),
      createdAt: new Date().toISOString(),
    };
    users.push(user);
    await save();
    return json({ ok: true, user: pub(user) });
  }

  if (action === "update") {
    const username = norm(body.username);
    const user = users.find((u) => u.username === username);
    if (!user) return json({ error: "User not found" }, 404);
    if (body.displayName !== undefined) {
      user.displayName = String(body.displayName).trim() || user.displayName;
    }
    if (body.role !== undefined) {
      user.role = body.role === "manager" ? "manager" : "user";
    }
    if (body.admin !== undefined) {
      const wantAdmin = body.admin === true;
      if (user.admin && !wantAdmin) {
        if (user.username === me.username)
          return json({ error: "You cannot remove your own admin rights" }, 400);
        if (adminCount() <= 1)
          return json({ error: "Cannot remove the last admin" }, 400);
      }
      user.admin = wantAdmin;
    }
    await save();
    return json({ ok: true, user: pub(user) });
  }

  if (action === "set-password") {
    const username = norm(body.username);
    const np = String(body.newPassword || "");
    const user = users.find((u) => u.username === username);
    if (!user) return json({ error: "User not found" }, 404);
    if (np.length < 6)
      return json({ error: "Password must be at least 6 characters" }, 400);
    user.passhash = hashPassword(np);
    user.mustChangePassword = !!body.requireChange;
    await save();
    return json({ ok: true });
  }

  if (action === "delete") {
    const username = norm(body.username);
    const idx = users.findIndex((u) => u.username === username);
    if (idx < 0) return json({ error: "User not found" }, 404);
    if (users[idx].username === me.username)
      return json({ error: "You cannot delete your own account" }, 400);
    if (users[idx].admin && adminCount() <= 1)
      return json({ error: "Cannot delete the last admin" }, 400);
    users.splice(idx, 1);
    await save();
    return json({ ok: true });
  }

  return json({ error: "Unknown action" }, 400);
};

export const config = { path: "/api/users" };
