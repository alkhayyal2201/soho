/* Soho Auth — shared session helper (no signup; accounts are created by admins).
   Session: { token, user:{username,displayName,role,admin,mustChangePassword} }
   stored in localStorage under 'soho_session'. */
var SohoAuth = (function () {
  var KEY = "soho_session";

  function get() {
    try {
      return JSON.parse(localStorage.getItem(KEY) || "null");
    } catch (e) {
      return null;
    }
  }
  function set(s) {
    if (s) localStorage.setItem(KEY, JSON.stringify(s));
    else localStorage.removeItem(KEY);
  }
  function headers() {
    var s = get();
    var h = { "Content-Type": "application/json" };
    if (s && s.token) h["Authorization"] = "Bearer " + s.token;
    return h;
  }
  function api(action, data) {
    data = data || {};
    data.action = action;
    return fetch("/api/users", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(data),
    }).then(function (r) {
      return r.json().then(function (j) {
        if (!r.ok) throw new Error((j && j.error) || "HTTP " + r.status);
        return j;
      });
    });
  }
  function loginUrl() {
    var page = (location.pathname.split("/").pop() || "index.html") + location.search;
    return "login.html?next=" + encodeURIComponent(page);
  }
  // Returns session or redirects to login. Call first on protected pages.
  function requireAuth() {
    var s = get();
    if (!s || !s.token) {
      location.href = loginUrl();
      return null;
    }
    return s;
  }
  // Returns session if admin, else bounces (non-admins -> index).
  function requireAdmin() {
    var s = requireAuth();
    if (!s) return null;
    if (!s.user || !s.user.admin) {
      location.href = "index.html";
      return null;
    }
    return s;
  }
  // Refresh cached profile flags from server (role/admin/mustChange).
  function refreshMe() {
    return api("me").then(function (j) {
      var s = get();
      if (s) {
        s.user = j.user;
        set(s);
      }
      return j.user;
    });
  }
  function displayName() {
    var s = get();
    return s && s.user ? s.user.displayName || s.user.username : "";
  }
  function isAdmin() {
    var s = get();
    return !!(s && s.user && s.user.admin);
  }
  function logout() {
    set(null);
    location.href = "login.html";
  }
  // Renders "Name (role) | Users | Logout" chip into #userChip.
  function renderChip() {
    var el = document.getElementById("userChip");
    if (!el) return;
    var s = get();
    if (!s || !s.user) return;
    var u = s.user;
    var badge = u.admin
      ? '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold tracking-wider uppercase bg-charcoal-300 text-white">Admin</span>'
      : "";
    var role = u.role === "manager" ? "Manager" : "Staff";
    var usersLink = u.admin
      ? '<a href="users.html" class="underline decoration-gold-300 underline-offset-2">Users</a><span class="opacity-40">·</span>'
      : "";
    el.innerHTML =
      '<span class="font-medium">' +
      esc(u.displayName || u.username) +
      "</span>" +
      '<span class="opacity-60">' +
      role +
      "</span>" +
      badge +
      usersLink +
      '<a href="#" id="logoutLink" class="underline decoration-gold-300 underline-offset-2">Logout</a>';
    var lo = document.getElementById("logoutLink");
    if (lo)
      lo.onclick = function (e) {
        e.preventDefault();
        logout();
      };
  }
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
  return {
    get: get,
    set: set,
    api: api,
    headers: headers,
    requireAuth: requireAuth,
    requireAdmin: requireAdmin,
    refreshMe: refreshMe,
    displayName: displayName,
    isAdmin: isAdmin,
    logout: logout,
    renderChip: renderChip,
  };
})();
