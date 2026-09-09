/* ============================================================
   PromptForge — app.js
   Local-first SPA: state, persistence, routing, all views.
   Vanilla JS, no dependencies. Data in localStorage.
   ============================================================ */
(function () {
  "use strict";

  const STORE_NAME = "promptforge.db.v1";
  const SEED_FLAG = "promptforge.seeded.v1";

  // ---------- Utilities ----------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const uid = (p = "id") => p + "_" + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
  const esc = (s) => String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  const escAttr = esc;

  function timeAgo(ts) {
    const d = (Date.now() - ts) / 1000;
    if (d < 60) return "just now";
    if (d < 3600) return Math.floor(d / 60) + "m ago";
    if (d < 86400) return Math.floor(d / 3600) + "h ago";
    if (d < 86400 * 30) return Math.floor(d / 86400) + "d ago";
    return new Date(ts).toLocaleDateString();
  }
  function fmtDate(ts) { return new Date(ts).toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" }); }

  // Extract {{variables}} from a body (named, alphanumeric + underscore + dash)
  function extractVars(body) {
    const re = /\{\{\s*([a-zA-Z_][\w-]*)\s*\}\}/g;
    const set = new Set();
    let m;
    while ((m = re.exec(body || ""))) set.add(m[1]);
    return Array.from(set);
  }

  // Resolve variables, returns { text, missing[] }
  function resolveVars(body, inputs) {
    const vars = extractVars(body);
    const missing = [];
    const map = inputs || {};
    const text = body.replace(/\{\{\s*([a-zA-Z_][\w-]*)\s*\}\}/g, (full, name) => {
      const val = map[name];
      if (val == null || val === "") { missing.push(name); return full; }
      return val;
    });
    return { text, missing };
  }

  // Highlight vars in a body for display
  function highlightVars(body) {
    return esc(body).replace(/\{\{\s*([a-zA-Z_][\w-]*)\s*\}\}/g, '<span class="var">{{$1}}</span>');
  }

  // ---------- Persistence ----------
  function loadDB() {
    try {
      const raw = localStorage.getItem(STORE_NAME);
      if (raw) return JSON.parse(raw);
    } catch (e) { console.warn("load failed", e); }
    return null;
  }
  function saveDB() {
    try { localStorage.setItem(STORE_NAME, JSON.stringify(state.db)); }
    catch (e) { toast("Could not save to browser storage", "err"); }
  }

  function freshSeed() {
    return JSON.parse(JSON.stringify(window.PF_SEED));
  }

  let state = {
    db: null,
    route: { name: "browse", params: {} },
    ui: { search: "", sort: "best", category: "all", tag: null },
  };

  function init() {
    const existing = loadDB();
    if (existing && localStorage.getItem(SEED_FLAG)) {
      state.db = existing;
    } else {
      state.db = freshSeed();
      localStorage.setItem(SEED_FLAG, "1");
      saveDB();
    }
    bindGlobal();
    startParticles();
    startRevealObserver();
    window.addEventListener("hashchange", router);
    router();
  }

  // ---------- Lookups ----------
  function userById(id) { return state.db.users.find(u => u.id === id) || { id: id, name: "Unknown", handle: "?", color: "#888" }; }
  function currentUser() { return userById(state.db.currentUserId); }
  function promptById(id) { return state.db.prompts.find(p => p.id === id); }
  function versionById(id) { return state.db.versions.find(v => v.id === id); }
  function versionsForPrompt(pid) { return state.db.versions.filter(v => v.promptId === pid).sort((a, b) => b.versionNumber - a.versionNumber); }
  function commentsForPrompt(pid) { return state.db.comments.filter(c => c.promptId === pid).sort((a, b) => a.createdAt - b.createdAt); }
  function testsForPrompt(pid) { return state.db.testCases.filter(t => t.promptId === pid); }
  function currentVersionBody(p) { const v = versionById(p.currentVersionId); return v ? v.body : ""; }
  function contributorsForPrompt(pid) {
    const vers = versionsForPrompt(pid);
    const ids = new Set(vers.map(v => v.authorId));
    state.db.comments.filter(c => c.promptId === pid).forEach(c => ids.add(c.authorId));
    return Array.from(ids).map(userById);
  }
  function isFavorite(pid) {
    const f = state.db.favorites[currentUser().id] || [];
    return f.includes(pid);
  }
  function allCategories() { return Array.from(new Set(state.db.prompts.map(p => p.category))).sort(); }
  function allTags() {
    const t = new Set();
    state.db.prompts.forEach(p => p.tags.forEach(x => t.add(x)));
    return Array.from(t).sort();
  }
  function isAdmin() { return currentUser().role === "admin"; }

  // ---------- Toast + Modal ----------
  function toast(msg, kind = "ok") {
    const host = $("#toast-host");
    const el = document.createElement("div");
    el.className = "toast " + (kind === "err" ? "err" : "ok");
    el.textContent = msg;
    host.appendChild(el);
    setTimeout(() => { el.style.opacity = "0"; el.style.transform = "translateY(8px)"; setTimeout(() => el.remove(), 250); }, 2600);
  }

  function openModal(html) {
    const host = $("#modal-host");
    host.innerHTML = `<div class="modal" role="dialog" aria-modal="true">${html}</div>`;
    host.classList.add("open");
    host.setAttribute("aria-hidden", "false");
    const close = () => closeModal();
    host.querySelector(".close") && host.querySelector(".close").addEventListener("click", close);
    host.addEventListener("click", (e) => { if (e.target === host) close(); }, { once: true });
    document.addEventListener("keydown", function esc(e) { if (e.key === "Escape") { closeModal(); document.removeEventListener("keydown", esc); } });
  }
  function closeModal() {
    const host = $("#modal-host");
    host.classList.remove("open");
    host.setAttribute("aria-hidden", "true");
    host.innerHTML = "";
  }

  // ---------- Router ----------
  function parseHash() {
    const h = location.hash.replace(/^#\/?/, "") || "browse";
    const parts = h.split("/");
    const name = parts[0] || "browse";
    const params = {};
    if (parts[1]) params.id = decodeURIComponent(parts[1]);
    if (name === "folder" && parts[1]) params.id = decodeURIComponent(parts[1]);
    return { name, params };
  }

  function go(path) { location.hash = "#/" + path; }

  function router() {
    state.route = parseHash();
    renderTopbar();
    renderSubnav();
    const main = $("#main");
    main.scrollTop = 0;
    window.scrollTo(0, 0);
    const v = VIEWS[state.route.name] || VIEWS.browse;
    main.innerHTML = v(state.route.params) || "";
    afterRender();
  }

  const VIEWS = {};

  // ---------- Topbar ----------
  function renderTopbar() {
    const u = currentUser();
    const bar = $("#topbar");
    bar.innerHTML = `
      <a class="brand" href="#/browse" aria-label="PromptForge home">
        <span class="logo">PF</span>
        <span class="name">PromptForge</span>
        <span class="tag">local-first</span>
      </a>
      <div class="topbar-search">
        <input id="globalSearch" type="search" placeholder="Search prompts, tags, authors..." value="${esc(state.ui.search)}" aria-label="Search prompts" />
      </div>
      <div class="user-switch">
        <label class="muted" style="font-size:.74rem" for="userPick">View as</label>
        <select id="userPick" aria-label="Switch mock user">
          ${state.db.users.map(x => `<option value="${x.id}" ${x.id === u.id ? "selected" : ""}>${esc(x.name)} (${x.role})</option>`).join("")}
        </select>
        <span class="avatar" style="background:${u.color}" title="${esc(u.name)}">${esc(u.name.slice(0, 1))}</span>
      </div>`;
    $("#globalSearch").addEventListener("input", (e) => {
      state.ui.search = e.target.value;
      if (state.route.name !== "browse") go("browse");
      else router();
    });
    $("#userPick").addEventListener("change", (e) => {
      state.db.currentUserId = e.target.value;
      saveDB();
      router();
    });
  }

  // ---------- Subnav ----------
  function renderSubnav() {
    const nav = $("#subnav");
    const u = currentUser();
    const pendingCount = state.db.prompts.filter(p => p.moderationState === "pending").length;
    const flaggedCount = state.db.prompts.filter(p => p.moderationState === "flagged").length;
    const modCount = pendingCount + flaggedCount;
    const mineCount = state.db.prompts.filter(p => p.authorId === u.id).length;
    const favCount = (state.db.favorites[u.id] || []).length;
    const items = [
      ["browse", "Browse", false],
      ["mine", `My Prompts`, false, mineCount],
      ["favorites", "Favorites", false, favCount],
      ["folders", "Folders", false],
      ["new", "New Prompt", false],
    ];
    if (u.role === "admin") items.push(["admin", "Moderation", false, modCount]);
    nav.innerHTML = items.map(([name, label, , count]) => {
      const active = state.route.name === name ? "active" : "";
      const badge = count != null && count > 0 ? `<span class="badge-count">${count}</span>` : "";
      return `<a href="#/${name}" class="${active}">${esc(label)}${badge}</a>`;
    }).join("") + `<span class="spacer"></span><span class="muted" style="font-size:.78rem;align-self:center">${state.db.prompts.length} prompts &middot; ${state.db.versions.length} versions</span>`;
  }

  // ---------- After-render hooks (FX) ----------
  function afterRender() {
    if (revealObs) $$(".reveal").forEach(el => revealObs.observe(el));
    $$(".magnetic-btn").forEach(bindMagnetic);
    $$(".card").forEach(bindCardSpotlight);
    const name = state.route.name;
    if (name === "prompt") bindDetail(state.route.params.id);
    else if (name === "new") bindEditor(null);
    else if (name === "edit") bindEditor(state.route.params.id);
    else if (name === "folders") bindFolders();
    else if (name === "folder") bindFolder(state.route.params.id);
    else if (name === "admin") bindAdmin();
  }

  let revealObs = null;
  function startRevealObserver() {
    revealObs = new IntersectionObserver((entries) => {
      entries.forEach(en => { if (en.isIntersecting) { en.target.classList.add("is-visible"); revealObs.unobserve(en.target); } });
    }, { threshold: 0.12 });
  }

  function bindMagnetic(btn) {
    if (btn.dataset.mag) return; btn.dataset.mag = "1";
    btn.addEventListener("pointermove", (e) => {
      const r = btn.getBoundingClientRect();
      const x = e.clientX - (r.left + r.width / 2);
      const y = e.clientY - (r.top + r.height / 2);
      btn.style.transform = `translate(${x * 0.22}px, ${y * 0.22}px)`;
    });
    btn.addEventListener("pointerleave", () => { btn.style.transform = "translate(0,0)"; });
  }

  function bindCardSpotlight(card) {
    if (card.dataset.spot) return; card.dataset.spot = "1";
    card.addEventListener("pointermove", (e) => {
      const r = card.getBoundingClientRect();
      card.style.setProperty("--tpx", ((e.clientX - r.left) / r.width * 100) + "%");
      card.style.setProperty("--tpy", ((e.clientY - r.top) / r.height * 100) + "%");
    });
  }

  // ---------- Particles ----------
  function startParticles() {
    const host = $("#particles");
    if (!host) return;
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    for (let i = 0; i < 22; i++) {
      const p = document.createElement("span");
      p.className = "particle";
      p.style.left = (Math.random() * 100) + "%";
      const dur = 6 + Math.random() * 8;
      p.style.animationDuration = dur + "s";
      p.style.animationDelay = (-Math.random() * dur) + "s";
      p.style.opacity = (0.3 + Math.random() * 0.5).toFixed(2);
      const size = 2 + Math.random() * 3;
      p.style.width = size + "px"; p.style.height = size + "px";
      host.appendChild(p);
    }
  }

  function bindGlobal() {
    document.addEventListener("keydown", (e) => {
      if (e.key === "/" && document.activeElement.tagName !== "INPUT" && document.activeElement.tagName !== "TEXTAREA") {
        e.preventDefault();
        const s = $("#globalSearch"); if (s) s.focus();
      }
    });
    document.addEventListener("click", onGlobalClick);
  }

  function onGlobalClick(e) {
    const t = e.target.closest("[data-act],[data-sort],[data-cat],[data-tag],[data-cleartag],[data-upvote],[data-nav]");
    if (!t) return;
    if (t.dataset.upvote != null) { e.preventDefault(); toggleUpvote(t.dataset.upvote); return; }
    if (t.dataset.tag != null && t.classList.contains("tag")) {
      e.preventDefault();
      state.ui.tag = state.ui.tag === t.dataset.tag ? null : t.dataset.tag;
      if (state.route.name !== "browse") go("browse"); else router();
      return;
    }
    if (t.dataset.cleartag != null) { state.ui.tag = null; router(); return; }
    if (t.dataset.cat != null) { state.ui.category = t.dataset.cat; router(); return; }
    if (t.dataset.sort != null) { state.ui.sort = t.dataset.sort; router(); return; }
    if (t.dataset.nav != null) { go(t.dataset.nav); return; }
    const act = t.dataset.act;
    if (act === "new") { go("new"); return; }
    if (act === "export") { exportJSON(); return; }
    if (act === "import") { importJSON(); return; }
    if (act === "reseed") { confirmReseed(); return; }
  }

  function toggleUpvote(pid) {
    const p = promptById(pid); if (!p) return;
    const me = currentUser().id;
    const i = p.upvotes.indexOf(me);
    if (i >= 0) p.upvotes.splice(i, 1); else p.upvotes.push(me);
    saveDB(); router();
  }

  function exportJSON() {
    const blob = new Blob([JSON.stringify(state.db, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "promptforge-export-" + new Date().toISOString().slice(0, 10) + ".json";
    a.click(); URL.revokeObjectURL(a.href);
    toast("Exported " + state.db.prompts.length + " prompts to JSON");
  }

  function importJSON() {
    openModal(`
      <button class="close" aria-label="Close">&times;</button>
      <h3>Import JSON</h3>
      <p class="muted" style="font-size:.86rem">Paste exported PromptForge JSON, or pick a file. Merges prompts by id; replaces users, folders, and favorites.</p>
      <div class="field"><label for="impFile">File</label><input type="file" id="impFile" accept="application/json" /></div>
      <div class="field"><label for="impText">Or paste JSON</label><textarea id="impText" style="min-height:160px"></textarea></div>
      <div class="flex"><button class="btn btn-primary" id="impGo">Import</button></div>
    `);
    $("#impFile").addEventListener("change", (e) => {
      const f = e.target.files[0]; if (!f) return;
      const r = new FileReader();
      r.onload = () => { $("#impText").value = r.result; };
      r.readAsText(f);
    });
    $("#impGo").addEventListener("click", () => {
      try {
        const data = JSON.parse($("#impText").value || "{}");
        if (!data.prompts || !data.users) throw new Error("Not a PromptForge export");
        mergeImport(data); closeModal();
        toast("Imported " + data.prompts.length + " prompts"); router();
      } catch (err) { toast("Import failed: " + err.message, "err"); }
    });
  }

  function mergeImport(data) {
    const byId = new Map(state.db.prompts.map(p => [p.id, p]));
    data.prompts.forEach(p => byId.set(p.id, p));
    state.db.prompts = Array.from(byId.values());
    const vById = new Map(state.db.versions.map(v => [v.id, v]));
    (data.versions || []).forEach(v => vById.set(v.id, v));
    state.db.versions = Array.from(vById.values());
    if (data.users) state.db.users = data.users;
    if (data.folders) state.db.folders = data.folders;
    if (data.favorites) state.db.favorites = data.favorites;
    if (data.testCases) {
      const tById = new Map(state.db.testCases.map(t => [t.id, t]));
      data.testCases.forEach(t => tById.set(t.id, t));
      state.db.testCases = Array.from(tById.values());
    }
    saveDB();
  }

  function confirmReseed() {
    openModal(`
      <button class="close" aria-label="Close">&times;</button>
      <h3>Reset demo data?</h3>
      <p>This wipes all local prompts, versions, test cases, and folders, and restores the original seed dataset. This cannot be undone.</p>
      <div class="flex" style="justify-content:flex-end">
        <button class="btn btn-ghost" id="rsCancel">Cancel</button>
        <button class="btn btn-danger" id="rsGo">Reset everything</button>
      </div>
    `);
    $("#rsCancel").addEventListener("click", closeModal);
    $("#rsGo").addEventListener("click", () => {
      state.db = freshSeed(); saveDB(); closeModal();
      toast("Demo data reset"); router();
    });
  }

  // continued in next chunk...

  // ---------- Shared render helpers ----------
  function promptCard(p) {
    const author = userById(p.authorId);
    const body = currentVersionBody(p);
    const vers = versionsForPrompt(p.id);
    const comments = commentsForPrompt(p.id);
    const upvoted = p.upvotes.includes(currentUser().id);
    const showMod = p.moderationState !== "approved" && (isAdmin() || p.authorId === currentUser().id);
    const preview = (body || "").slice(0, 180) + ((body || "").length > 180 ? "..." : "");
    return `
      <article class="card reveal" data-id="${p.id}">
        <div class="flex between" style="align-items:flex-start">
          <a href="#/prompt/${encodeURIComponent(p.id)}" class="card-title" style="text-decoration:none;color:#eaf9fb">${esc(p.title)}</a>
          ${showMod ? `<span class="mod mod-${p.moderationState}">${p.moderationState}</span>` : ""}
        </div>
        <div class="card-meta">
          <span class="chip cat">${esc(p.category)}</span>
          ${p.tags.slice(0, 3).map(t => `<span class="chip tag" data-tag="${escAttr(t)}">${esc(t)}</span>`).join("")}
        </div>
        <div class="card-body">${highlightVars(preview)}</div>
        <div class="divider" style="margin:.7rem 0"></div>
        <div class="flex between" style="align-items:center">
          <div class="flex center gap-sm">
            <span class="avatar" style="background:${author.color};width:22px;height:22px;font-size:.7rem">${esc(author.name.slice(0, 1))}</span>
            <span class="muted" style="font-size:.78rem">${esc(author.name)}</span>
          </div>
          <div class="flex center gap-sm" style="font-size:.78rem;color:var(--color-text-dim)">
            <span class="upvote ${upvoted ? "on" : ""}" data-upvote="${p.id}" title="Upvote">▲ ${p.upvotes.length}</span>
            <span title="Versions">⎘ ${vers.length}</span>
            <span title="Comments">💬 ${comments.length}</span>
          </div>
        </div>
      </article>`;
  }

  function emptyState(icon, title, msg, cta) {
    return `<div class="empty"><div class="icon">${icon}</div><h3>${esc(title)}</h3><p>${esc(msg)}</p>${cta || ""}</div>`;
  }

  // ---------- Browse view ----------
  VIEWS.browse = function () {
    const cats = allCategories();
    const tags = allTags();
    let list = state.db.prompts.slice();

    // public browse hides non-approved (even from admins on this surface)
    list = list.filter(p => p.moderationState === "approved");

    // search
    const q = state.ui.search.trim().toLowerCase();
    if (q) {
      list = list.filter(p => {
        const author = userById(p.authorId).name.toLowerCase();
        const body = currentVersionBody(p).toLowerCase();
        return p.title.toLowerCase().includes(q)
          || body.includes(q)
          || p.category.toLowerCase().includes(q)
          || p.tags.some(t => t.toLowerCase().includes(q))
          || author.includes(q);
      });
    }
    // category filter
    if (state.ui.category && state.ui.category !== "all") list = list.filter(p => p.category === state.ui.category);
    // tag filter
    if (state.ui.tag) list = list.filter(p => p.tags.includes(state.ui.tag));

    // sort
    if (state.ui.sort === "new") list.sort((a, b) => b.updatedAt - a.updatedAt);
    else if (state.ui.sort === "hot") list.sort((a, b) => (b.upvotes.length + commentsForPrompt(b.id).length * 2) - (a.upvotes.length + commentsForPrompt(a.id).length * 2));
    else list.sort((a, b) => b.upvotes.length - a.upvotes.length); // best

    const featured = state.db.prompts.filter(p => p.featured && p.moderationState === "approved").slice(0, 3);

    return `
      <section class="hero">
        <h1>Engineer prompts like <span class="grad">software</span>, not sticky notes.</h1>
        <p>Versioned prompts, named variables, side-by-side test cases against mock model responses, and a moderation queue. Everything lives in your browser. No accounts, no server.</p>
        <div class="flex wrap mt">
          <button class="btn btn-primary magnetic-btn" data-act="new">+ New Prompt</button>
          <button class="btn btn-ghost" data-act="export">Export JSON</button>
          <button class="btn btn-ghost" data-act="import">Import JSON</button>
          <button class="btn btn-ghost" data-act="reseed">Reset demo data</button>
        </div>
        <div class="marquee-wrap" aria-hidden="true">
          <div class="marquee">
            ${`<span><b>${state.db.prompts.length}</b> prompts</span><span><b>${state.db.versions.length}</b> versions tracked</span><span><b>${state.db.users.length}</b> mock users</span><span><b>${state.db.testCases.length}</b> test cases</span><span>Press <span class="kbd">/</span> to search</span>`.repeat(2)}
          </div>
        </div>
      </section>

      ${featured.length ? `
      <section class="mt2">
        <h2 class="section-title">Featured</h2>
        <p class="section-sub">Editor picks from the approved library.</p>
        <div class="grid cols-3">${featured.map(promptCard).join("")}</div>
      </section>` : ""}

      <section class="mt2">
        <div class="flex between wrap" style="align-items:center;margin-bottom:1rem">
          <h2 class="section-title" style="margin:0">Browse</h2>
          <div class="tabs">
            <button class="tab ${state.ui.sort === "best" ? "active" : ""}" data-sort="best">Best</button>
            <button class="tab ${state.ui.sort === "new" ? "active" : ""}" data-sort="new">New</button>
            <button class="tab ${state.ui.sort === "hot" ? "active" : ""}" data-sort="hot">Hot</button>
          </div>
        </div>

        <div class="filter-bar mb">
          <div class="filter-group">
            <span class="filter-label">Category</span>
            <button class="chip ${state.ui.category === "all" || !state.ui.category ? "active" : ""}" data-cat="all">All</button>
            ${cats.map(c => `<button class="chip cat ${state.ui.category === c ? "active" : ""}" data-cat="${escAttr(c)}">${esc(c)}</button>`).join("")}
          </div>
        </div>
        ${state.ui.tag ? `<div class="mb"><span class="muted" style="font-size:.82rem">Tag filter:</span> <span class="chip tag active">${esc(state.ui.tag)}</span> <button class="btn btn-sm btn-ghost" data-cleartag>clear</button></div>` : ""}
        ${tags.length ? `<div class="filter-bar mb"><span class="filter-label">Tags</span>${tags.slice(0, 14).map(t => `<button class="chip tag ${state.ui.tag === t ? "active" : ""}" data-tag="${escAttr(t)}">${esc(t)}</button>`).join("")}</div>` : ""}

        <div class="grid cols-3">
          ${list.length ? list.map(promptCard).join("") : emptyState("🔍", "No prompts match", "Try clearing filters or searching a different term.")}
        </div>
      </section>`;
  };

  // continued in next chunk...

  // ---------- Mock model response ----------
  function mockModel(body, inputs) {
    const { text } = resolveVars(body, inputs);
    const firstLine = text.split("\n")[0].slice(0, 60);
    const canned = [
      "[mock gpt-4o] Understood. Here is a response based on: " + firstLine + "...",
      "[mock claude] I would approach this by reasoning about: " + firstLine + ".",
      "[mock gemini] Draft response: " + firstLine + " (truncated for demo).",
    ];
    // deterministic pick
    let h = 0; for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) >>> 0;
    return canned[h % canned.length];
  }

  // ---------- Detail view ----------
  VIEWS.prompt = function (params) {
    const p = promptById(params.id);
    if (!p) return emptyState("❓", "Prompt not found", "This prompt may have been deleted.", `<button class="btn btn-ghost" data-nav="browse">Back to browse</button>`);
    const author = userById(p.authorId);
    const vers = versionsForPrompt(p.id);
    const comments = commentsForPrompt(p.id);
    const contribs = contributorsForPrompt(p.id);
    const tests = testsForPrompt(p.id);
    const body = currentVersionBody(p);
    const vars = extractVars(body);
    const canEdit = isAdmin() || p.authorId === currentUser().id;
    const fav = isFavorite(p.id);
    const upvoted = p.upvotes.includes(currentUser().id);

    return `
      <div class="flex between wrap mb">
        <div>
          <a href="#/browse" class="muted" style="font-size:.82rem">← Browse</a>
          <h1 class="section-title" style="margin-top:.3rem">${esc(p.title)} <span class="mod mod-${p.moderationState}" style="margin-left:.4rem">${p.moderationState}</span></h1>
          <div class="card-meta">
            <span class="chip cat">${esc(p.category)}</span>
            ${p.tags.map(t => `<span class="chip tag" data-tag="${escAttr(t)}">${esc(t)}</span>`).join("")}
            <span>by <b style="color:${author.color}">${esc(author.name)}</b></span>
            <span>updated ${timeAgo(p.updatedAt)}</span>
          </div>
        </div>
        <div class="flex wrap gap-sm">
          <button class="btn btn-ghost" data-fav="${p.id}">${fav ? "★ Favorited" : "☆ Favorite"}</button>
          <button class="upvote ${upvoted ? "on" : ""}" data-upvote="${p.id}" style="border:1px solid rgba(102,252,241,.25);border-radius:8px;padding:.5rem .7rem">▲ ${p.upvotes.length}</button>
          ${canEdit ? `<button class="btn btn-primary" data-edit="${p.id}">Edit / New version</button>` : ""}
          ${isAdmin() && p.moderationState !== "approved" ? `<button class="btn btn-warn" data-approve="${p.id}">Approve</button>` : ""}
          ${isAdmin() && p.moderationState !== "flagged" ? `<button class="btn btn-ghost" data-flag="${p.id}">Flag</button>` : ""}
        </div>
      </div>

      <div class="detail-grid">
        <div class="stack">
          <section class="panel" style="padding:1.1rem">
            <div class="flex between"><h2 class="section-title" style="margin:0;font-size:1.1rem">Prompt body</h2><span class="muted" style="font-size:.78rem">v${(versionById(p.currentVersionId)||{}).versionNumber || 1}</span></div>
            <div class="codeblock mt">${highlightVars(body)}</div>
          </section>

          <section class="panel" style="padding:1.1rem">
            <h2 class="section-title" style="margin:0 0 .6rem;font-size:1.1rem">Fill variables &amp; preview</h2>
            ${vars.length ? `
              <div class="field-grid" id="varForm">
                ${vars.map(vname => `
                  <div class="field">
                    <label>${esc(vname)}</label>
                    <textarea data-var="${escAttr(vname)}" rows="2" placeholder="Value for ${esc(vname)}"></textarea>
                  </div>`).join("")}
              </div>
              <div class="flex gap-sm mb">
                <button class="btn btn-ghost btn-sm" id="fillSample">Fill sample values</button>
                <button class="btn btn-ghost btn-sm" id="clearVars">Clear</button>
              </div>
            ` : `<p class="muted" style="font-size:.86rem">This prompt has no variables. Copy the body directly.</p>`}

            <div class="flex between" style="align-items:center;margin-top:.4rem">
              <span class="muted" style="font-size:.8rem" id="resolveStatus">Resolve to preview &amp; copy.</span>
              <button class="btn btn-primary magnetic-btn" id="copyBtn" disabled>Copy final text</button>
            </div>
            <div class="codeblock mt" id="previewBox" style="min-height:60px;color:var(--color-text-dim)">${vars.length ? "Fill the variables to see the resolved prompt." : esc(body)}</div>
          </section>

          <section class="panel" style="padding:1.1rem">
            <h2 class="section-title" style="margin:0 0 .6rem;font-size:1.1rem">Test cases <span class="muted" style="font-size:.78rem;font-weight:400">(mock model responses, side-by-side by version)</span></h2>
            ${tests.length ? renderTestsTable(tests, vers) : `<p class="muted" style="font-size:.86rem">No test cases yet. ${canEdit ? "Add one from the editor." : ""}</p>`}
            ${canEdit ? `<button class="btn btn-ghost btn-sm mt" data-addtest="${p.id}">+ Add test case</button>` : ""}
          </section>

          <section class="panel" style="padding:1.1rem">
            <h2 class="section-title" style="margin:0 0 .6rem;font-size:1.1rem">Comments (${comments.length})</h2>
            ${comments.length ? comments.map(c => {
              const cu = userById(c.authorId);
              return `<div style="padding:.6rem 0;border-bottom:1px solid rgba(102,252,241,.08)">
                <div class="flex center gap-sm"><span class="avatar" style="background:${cu.color};width:22px;height:22px;font-size:.7rem">${esc(cu.name.slice(0,1))}</span><b style="font-size:.84rem;color:${cu.color}">${esc(cu.name)}</b><span class="muted" style="font-size:.74rem">${timeAgo(c.createdAt)}</span></div>
                <p style="margin:.3rem 0 0;font-size:.88rem">${esc(c.body)}</p>
              </div>`;
            }).join("") : `<p class="muted" style="font-size:.86rem">No comments yet.</p>`}
            <div class="field mt" style="margin-bottom:0">
              <textarea id="newComment" rows="2" placeholder="Add a comment..."></textarea>
              <div><button class="btn btn-primary btn-sm" id="postComment">Post comment</button></div>
            </div>
          </section>
        </div>

        <aside class="stack">
          <section class="panel attribution" style="padding:1.1rem">
            <h2 class="section-title" style="margin:0 0 .6rem;font-size:1.05rem">Attribution</h2>
            <div class="muted" style="font-size:.78rem;margin-bottom:.4rem">Original author</div>
            <div class="contrib">
              <span class="avatar lg" style="background:${author.color}">${esc(author.name.slice(0,1))}</span>
              <div><div style="font-weight:600;color:#eaf9fb">${esc(author.name)}</div><div class="muted" style="font-size:.76rem">@${esc(author.handle)}</div></div>
            </div>
            <div class="muted" style="font-size:.78rem;margin:.6rem 0 .4rem">Contributors (${contribs.length})</div>
            ${contribs.filter(c => c.id !== author.id).map(c => `
              <div class="contrib">
                <span class="avatar" style="background:${c.color};width:26px;height:26px;font-size:.72rem">${esc(c.name.slice(0,1))}</span>
                <div><div style="font-size:.84rem;color:#eaf9fb">${esc(c.name)}</div><div class="muted" style="font-size:.72rem">@${esc(c.handle)}</div></div>
              </div>`).join("") || `<span class="muted" style="font-size:.8rem">No other contributors yet.</span>`}
          </section>

          <section class="panel" style="padding:1.1rem">
            <h2 class="section-title" style="margin:0 0 .6rem;font-size:1.05rem">Version history (${vers.length})</h2>
            ${vers.map(vr => {
              const vu = userById(vr.authorId);
              return `<div class="version-item ${vr.id === p.currentVersionId ? "active" : ""}" data-version="${vr.id}">
                <div class="flex between"><b style="font-size:.84rem">v${vr.versionNumber}</b><span class="muted" style="font-size:.72rem">${timeAgo(vr.createdAt)}</span></div>
                <div class="muted" style="font-size:.78rem">${esc(vu.name)}</div>
                <div style="font-size:.8rem;margin-top:.2rem">${esc(vr.changeNote)}</div>
              </div>`;
            }).join("")}
          </section>

          <section class="panel" style="padding:1.1rem">
            <h2 class="section-title" style="margin:0 0 .4rem;font-size:1.05rem">Stats</h2>
            <div class="stat" style="flex-direction:column;gap:.4rem">
              <span>▲ Upvotes: <b>${p.upvotes.length}</b></span>
              <span>⎘ Versions: <b>${vers.length}</b></span>
              <span>💬 Comments: <b>${comments.length}</b></span>
              <span>🧪 Test cases: <b>${tests.length}</b></span>
              <span>📁 Folders: <b>${state.db.folders.filter(f => f.promptIds.includes(p.id)).length}</b></span>
            </div>
          </section>
        </aside>
      </div>`;
  };

  function renderTestsTable(tests, vers) {
    const versForTable = vers.slice().reverse(); // oldest -> newest
    return `
      <div class="table-wrap">
        <table class="tbl">
          <thead>
            <tr>
              <th>Test case</th>
              <th>Expected</th>
              ${versForTable.map(vr => `<th>v${vr.versionNumber}</th>`).join("")}
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${tests.map(t => `
              <tr>
                <td><b style="color:#eaf9fb">${esc(t.name)}</b><div class="muted" style="font-size:.72rem">${esc(t.notes || "")}</div></td>
                <td style="max-width:240px;font-size:.8rem">${esc(t.expected)}</td>
                ${versForTable.map(vr => {
                  const r = t.results && t.results[vr.id];
                  if (!r) return `<td><span class="pill unset">—</span></td>`;
                  return `<td title="${escAttr(r.response)}"><span class="pill ${r.pass ? "pass" : "fail"}">${r.pass ? "PASS" : "FAIL"}</span><div class="muted" style="font-size:.72rem;margin-top:.2rem;max-width:180px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(r.response)}</div></td>`;
                }).join("")}
                <td><button class="btn btn-sm btn-ghost" data-runtest="${t.id}">Re-run</button></td>
              </tr>`).join("")}
          </tbody>
        </table>
      </div>`;
  }

  // continued in next chunk...

  // ---------- Editor view (new / edit) ----------
  VIEWS.new = function () { return editorHTML(null); };
  VIEWS.edit = function (params) {
    const p = promptById(params.id);
    if (!p) return emptyState("❓", "Prompt not found", "", `<button class="btn btn-ghost" data-nav="browse">Back</button>`);
    if (!isAdmin() && p.authorId !== currentUser().id) return emptyState("🔒", "Not yours", "Only the author or an admin can edit this prompt.", `<button class="btn btn-ghost" data-nav="prompt/${encodeURIComponent(p.id)}">Back to prompt</button>`);
    return editorHTML(p);
  };

  function editorHTML(p) {
    const editing = !!p;
    const body = editing ? currentVersionBody(p) : "";
    const title = editing ? p.title : "";
    const category = editing ? p.category : "";
    const tags = editing ? p.tags.join(", ") : "";
    const note = editing ? "" : "";
    const moderation = editing ? p.moderationState : "draft";
    const vars = extractVars(body);
    return `
      <div class="flex between wrap mb">
        <div>
          <a href="${editing ? `#/prompt/${encodeURIComponent(p.id)}` : "#/browse"}" class="muted" style="font-size:.82rem">← ${editing ? "Back to prompt" : "Back to browse"}</a>
          <h1 class="section-title" style="margin-top:.3rem">${editing ? "New version: " + esc(p.title) : "New prompt"}</h1>
          <p class="section-sub">${editing ? "Saving creates a new version. The previous body is preserved in history." : "Drafts are private. Submit for review to surface them in the moderation queue."}</p>
        </div>
      </div>

      <div class="detail-grid">
        <div class="stack">
          <section class="panel" style="padding:1.1rem">
            <div class="field">
              <label>Title <span class="req">*</span></label>
              <input id="f_title" value="${escAttr(title)}" placeholder="e.g. Senior Code Reviewer" ${editing ? "readonly" : ""} />
            </div>
            <div class="flex wrap" style="gap:1rem">
              <div class="field" style="flex:1;min-width:180px">
                <label>Category <span class="req">*</span></label>
                <input id="f_category" value="${escAttr(category)}" placeholder="Engineering / Writing / Marketing..." list="catList" />
                <datalist id="catList">${allCategories().map(c => `<option value="${escAttr(c)}">`).join("")}</datalist>
              </div>
              <div class="field" style="flex:1;min-width:180px">
                <label>Tags</label>
                <input id="f_tags" value="${escAttr(tags)}" placeholder="comma, separated" />
                <span class="hint">Comma separated.</span>
              </div>
            </div>
            <div class="field">
              <label>Prompt body <span class="req">*</span></label>
              <textarea id="f_body" rows="10" placeholder="Write your prompt. Use {{variables}} for fill-in fields.">${esc(body)}</textarea>
              <span class="hint">Variables look like <span class="help-vars">{{name}}</span>. Detected: <span id="detectedVars" class="help-vars">${vars.length ? vars.join(", ") : "none"}</span></span>
            </div>
            <div class="field">
              <label>Change note</label>
              <input id="f_note" value="${escAttr(note)}" placeholder="What changed in this version?" />
            </div>
            ${editing ? `<div class="field">
              <label>Moderation state</label>
              <select id="f_moderation">
                ${["draft","pending","approved","flagged"].map(s => `<option value="${s}" ${s===moderation?"selected":""}>${s}</option>`).join("")}
              </select>
              <span class="hint">Admins can move prompts between states. Pending items appear in the moderation queue.</span>
            </div>` : `<div class="field">
              <label>Submit for review?</label>
              <select id="f_moderation">
                <option value="draft" selected>Save as draft (private)</option>
                <option value="pending">Submit for review (public after approval)</option>
              </select>
            </div>`}
            <div class="flex wrap gap-sm">
              <button class="btn btn-primary magnetic-btn" id="savePrompt">${editing ? "Save new version" : "Create prompt"}</button>
              <button class="btn btn-ghost" id="cancelEdit">Cancel</button>
              ${editing ? `<button class="btn btn-ghost" id="seedTests">Seed sample test cases</button>` : ""}
            </div>
          </section>
        </div>

        <aside class="stack">
          <section class="panel" style="padding:1.1rem">
            <h2 class="section-title" style="margin:0 0 .4rem;font-size:1.05rem">Live preview</h2>
            <p class="muted" style="font-size:.8rem;margin-bottom:.6rem">Variables resolve as you type (sample values shown).</p>
            <div class="codeblock" id="livePreview" style="min-height:120px"></div>
          </section>
          <section class="panel" style="padding:1.1rem">
            <h2 class="section-title" style="margin:0 0 .4rem;font-size:1.05rem">Tips</h2>
            <ul style="margin:.4rem 0 0 1.1rem;font-size:.86rem;color:var(--color-text-dim);line-height:1.7">
              <li>Use named variables <span class="help-vars">{{repo}}</span> so the fill-form is generated automatically.</li>
              <li>Each save is a new version. Old versions stay visible and comparable.</li>
              <li>Add test cases with expected outcomes, then compare pass/fail across versions.</li>
              <li>Pending prompts are hidden from public browse until an admin approves them.</li>
            </ul>
          </section>
        </aside>
      </div>`;
  }

  // ---------- My prompts ----------
  VIEWS.mine = function () {
    const me = currentUser();
    const list = state.db.prompts.filter(p => p.authorId === me.id).sort((a, b) => b.updatedAt - a.updatedAt);
    return `
      <h1 class="section-title">My prompts</h1>
      <p class="section-sub">Authored by ${esc(me.name)}. Drafts and pending items are visible here even though they are hidden from public browse.</p>
      <div class="flex wrap mb">
        <button class="btn btn-primary magnetic-btn" data-act="new">+ New prompt</button>
      </div>
      ${list.length ? `<div class="grid cols-3">${list.map(promptCard).join("")}</div>` : emptyState("📝", "No prompts yet", "Create your first prompt. It saves as a draft you can submit for review.", `<button class="btn btn-primary" data-act="new">+ New prompt</button>`)}`;
  };

  // ---------- Favorites ----------
  VIEWS.favorites = function () {
    const me = currentUser();
    const favIds = state.db.favorites[me.id] || [];
    const list = state.db.prompts.filter(p => favIds.includes(p.id) && p.moderationState === "approved");
    return `
      <h1 class="section-title">Favorites</h1>
      <p class="section-sub">Starred by ${esc(me.name)}. Stored per user in your browser.</p>
      ${list.length ? `<div class="grid cols-3">${list.map(promptCard).join("")}</div>` : emptyState("☆", "No favorites yet", "Star a prompt from its detail page to pin it here.")}`;
  };

  // ---------- Folders ----------
  VIEWS.folders = function () {
    const me = currentUser();
    const mine = state.db.folders.filter(f => f.ownerId === me.id);
    return `
      <div class="flex between wrap mb">
        <div><h1 class="section-title" style="margin:0">Folders</h1><p class="section-sub" style="margin:.2rem 0 0">Collections owned by ${esc(me.name)}.</p></div>
        <button class="btn btn-primary magnetic-btn" data-newfolder>+ New folder</button>
      </div>
      ${mine.length ? `<div class="grid cols-2">${mine.map(f => {
        const prompts = f.promptIds.map(promptById).filter(Boolean);
        return `<article class="card reveal" data-folder="${f.id}">
          <div class="flex between"><a href="#/folder/${encodeURIComponent(f.id)}" class="card-title" style="text-decoration:none;color:#eaf9fb">📁 ${esc(f.name)}</a>
          <span class="muted" style="font-size:.78rem">${prompts.length} prompts</span></div>
          <div class="card-meta mt">${prompts.slice(0,3).map(p => `<span class="chip">${esc(p.title)}</span>`).join("") || "<span class=\"muted\">empty</span>"}</div>
          <div class="flex gap-sm mt"><button class="btn btn-sm btn-ghost" data-folderopen="${f.id}">Open</button><button class="btn btn-sm btn-ghost" data-folderrename="${f.id}">Rename</button><button class="btn btn-sm btn-danger" data-folderdel="${f.id}">Delete</button></div>
        </article>`;
      }).join("")}</div>` : emptyState("📁", "No folders yet", "Group prompts into collections for a workflow or team.", `<button class="btn btn-primary" data-newfolder>+ New folder</button>`)}`;
  };

  VIEWS.folder = function (params) {
    const f = state.db.folders.find(x => x.id === params.id);
    if (!f) return emptyState("❓", "Folder not found", "", `<button class="btn btn-ghost" data-nav="folders">Back</button>`);
    const prompts = f.promptIds.map(promptById).filter(Boolean);
    const approved = prompts.filter(p => p.moderationState === "approved");
    const addable = state.db.prompts.filter(p => p.moderationState === "approved" && !f.promptIds.includes(p.id));
    return `
      <a href="#/folders" class="muted" style="font-size:.82rem">← Folders</a>
      <h1 class="section-title" style="margin-top:.3rem">📁 ${esc(f.name)}</h1>
      <p class="section-sub">${approved.length} approved prompts in this collection.</p>
      <div class="flex wrap mb">
        <select id="addPromptToFolder">
          <option value="">+ Add a prompt...</option>
          ${addable.map(p => `<option value="${p.id}">${esc(p.title)}</option>`).join("")}
        </select>
      </div>
      ${approved.length ? `<div class="grid cols-3">${approved.map(promptCard).join("")}</div>` : emptyState("📁", "Empty folder", "Add approved prompts using the selector above.")}`;
  };

  // ---------- Admin / Moderation ----------
  VIEWS.admin = function () {
    if (!isAdmin()) return emptyState("🔒", "Admins only", "Switch to an admin mock user (top-right) to see the moderation queue.", `<button class="btn btn-ghost" data-nav="browse">Back to browse</button>`);
    const queue = state.db.prompts.filter(p => p.moderationState === "pending" || p.moderationState === "flagged").sort((a, b) => b.updatedAt - a.updatedAt);
    const drafts = state.db.prompts.filter(p => p.moderationState === "draft");
    const approved = state.db.prompts.filter(p => p.moderationState === "approved");
    return `
      <h1 class="section-title">Moderation queue</h1>
      <p class="section-sub">${queue.length} items awaiting action. ${approved.length} approved, ${drafts.length} drafts.</p>
      ${queue.length ? `<div class="grid cols-2">${queue.map(p => {
        const author = userById(p.authorId);
        const body = currentVersionBody(p);
        return `<article class="card reveal">
          <div class="flex between"><a href="#/prompt/${encodeURIComponent(p.id)}" class="card-title" style="text-decoration:none;color:#eaf9fb">${esc(p.title)}</a><span class="mod mod-${p.moderationState}">${p.moderationState}</span></div>
          <div class="card-meta"><span class="chip cat">${esc(p.category)}</span><span>by <b style="color:${author.color}">${esc(author.name)}</b></span><span>${timeAgo(p.updatedAt)}</span></div>
          <div class="card-body">${highlightVars((body||"").slice(0,160))}</div>
          <div class="flex gap-sm mt">
            <button class="btn btn-sm btn-warn" data-approve="${p.id}">Approve</button>
            <button class="btn btn-sm btn-danger" data-reject="${p.id}">Reject → draft</button>
            ${p.moderationState !== "flagged" ? `<button class="btn btn-sm btn-ghost" data-flag="${p.id}">Flag</button>` : ""}
            <a class="btn btn-sm btn-ghost" href="#/prompt/${encodeURIComponent(p.id)}">Open</a>
          </div>
        </article>`;
      }).join("")}</div>` : emptyState("✅", "Queue is empty", "No pending or flagged prompts. The library is clean.")}
    `;
  };

  // continued in next chunk...

  // ---------- Detail bindings ----------
  function bindDetail(pid) {
    const p = promptById(pid); if (!p) return;
    const body = currentVersionBody(p);
    const vars = extractVars(body);

    // favorite
    $$(`[data-fav="${pid}"]`).forEach(b => b.addEventListener("click", () => {
      const me = currentUser().id;
      state.db.favorites[me] = state.db.favorites[me] || [];
      const i = state.db.favorites[me].indexOf(pid);
      if (i >= 0) state.db.favorites[me].splice(i, 1); else state.db.favorites[me].push(pid);
      saveDB(); router();
    }));
    // edit / approve / flag / reject
    $$(`[data-edit="${pid}"]`).forEach(b => b.addEventListener("click", () => go("edit/" + encodeURIComponent(pid))));
    $$(`[data-approve="${pid}"]`).forEach(b => b.addEventListener("click", () => setMod(pid, "approved")));
    $$(`[data-flag="${pid}"]`).forEach(b => b.addEventListener("click", () => setMod(pid, "flagged")));
    $$(`[data-addtest="${pid}"]`).forEach(b => b.addEventListener("click", () => addTestCase(pid)));
    $$(`[data-runtest]`).forEach(b => b.addEventListener("click", () => runTest(b.dataset.runtest)));

    // version switch (view only; clicking shows that version body in a modal)
    $$(`[data-version]`).forEach(b => b.addEventListener("click", () => {
      const v = versionById(b.dataset.version);
      if (!v) return;
      const vu = userById(v.authorId);
      openModal(`
        <button class="close" aria-label="Close">&times;</button>
        <h3>v${v.versionNumber} &middot; ${esc(p.title)}</h3>
        <div class="muted" style="font-size:.8rem;margin-bottom:.6rem">${esc(vu.name)} &middot; ${fmtDate(v.createdAt)} &middot; ${esc(v.changeNote || "no note")}</div>
        <div class="codeblock">${highlightVars(v.body)}</div>
      `);
    }));

    // variable form + preview + copy
    const previewBox = $("#previewBox");
    const copyBtn = $("#copyBtn");
    const status = $("#resolveStatus");
    const getInputs = () => {
      const map = {};
      $$("[data-var]").forEach(el => { map[el.dataset.var] = el.value; });
      return map;
    };
    const update = () => {
      if (!vars.length) {
        previewBox.innerHTML = esc(body);
        previewBox.style.color = "";
        status.textContent = "No variables. Ready to copy.";
        copyBtn.disabled = false;
        copyBtn.dataset.text = body;
        return;
      }
      const inputs = getInputs();
      const { text, missing } = resolveVars(body, inputs);
      const html = esc(text).replace(/\{\{\s*([a-zA-Z_][\w-]*)\s*\}\}/g, '<span class="missing">{{$1}}</span>');
      previewBox.innerHTML = html;
      previewBox.style.color = "";
      if (missing.length) {
        status.textContent = "Missing: " + missing.join(", ");
        status.style.color = "var(--color-scam)";
        copyBtn.disabled = true;
        delete copyBtn.dataset.text;
      } else {
        status.textContent = "Resolved. Ready to copy.";
        status.style.color = "var(--color-cash)";
        copyBtn.disabled = false;
        copyBtn.dataset.text = text;
      }
    };
    if ($("#varForm")) {
      $$("[data-var]").forEach(el => el.addEventListener("input", update));
      $("#fillSample").addEventListener("click", () => {
        $$("[data-var]").forEach(el => { el.value = "sample_" + el.dataset.var; });
        update();
      });
      $("#clearVars").addEventListener("click", () => {
        $$("[data-var]").forEach(el => { el.value = ""; });
        update();
      });
    }
    if (copyBtn) {
      copyBtn.addEventListener("click", () => {
        const text = copyBtn.dataset.text;
        if (text == null) return;
        navigator.clipboard.writeText(text).then(
          () => toast("Copied resolved prompt to clipboard"),
          () => { fallbackCopy(text); toast("Copied resolved prompt"); }
        );
      });
    }
    update();

    // comment
    const postBtn = $("#postComment");
    if (postBtn) postBtn.addEventListener("click", () => {
      const ta = $("#newComment");
      const v = (ta.value || "").trim();
      if (!v) return toast("Comment is empty", "err");
      state.db.comments.push({ id: uid("c"), promptId: pid, authorId: currentUser().id, body: v, createdAt: Date.now() });
      saveDB(); router();
      toast("Comment posted");
    });
  }

  function fallbackCopy(text) {
    const ta = document.createElement("textarea");
    ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    try { document.execCommand("copy"); } catch (e) {}
    ta.remove();
  }

  function setMod(pid, state_) {
    const p = promptById(pid); if (!p) return;
    p.moderationState = state_;
    p.updatedAt = Date.now();
    saveDB(); router();
    toast("Prompt " + state_);
  }

  function addTestCase(pid) {
    const p = promptById(pid); if (!p) return;
    const vars = extractVars(currentVersionBody(p));
    const sampleInputs = {}; vars.forEach(v => sampleInputs[v] = "sample_" + v);
    openModal(`
      <button class="close" aria-label="Close">&times;</button>
      <h3>Add test case</h3>
      <div class="field"><label>Test name <span class="req">*</span></label><input id="t_name" placeholder="e.g. Catches the missing-return bug" /></div>
      <div class="field"><label>Expected outcome <span class="req">*</span></label><textarea id="t_expected" rows="2"></textarea></div>
      <div class="field"><label>Notes</label><textarea id="t_notes" rows="2"></textarea></div>
      ${vars.length ? `<div class="field"><label>Variable inputs (sample)</label>
        ${vars.map(v => `<div class="field" style="margin-bottom:.5rem"><label>${esc(v)}</label><input data-tvar="${escAttr(v)}" value="${escAttr(sampleInputs[v])}" /></div>`).join("")}
      </div>` : ""}
      <div class="flex" style="justify-content:flex-end"><button class="btn btn-ghost" id="t_cancel">Cancel</button><button class="btn btn-primary" id="t_save">Save &amp; run</button></div>
    `);
    $("#t_cancel").addEventListener("click", closeModal);
    $("#t_save").addEventListener("click", () => {
      const name = $("#t_name").value.trim();
      const expected = $("#t_expected").value.trim();
      if (!name || !expected) return toast("Name and expected outcome are required", "err");
      const inputs = {}; $$("[data-tvar]").forEach(el => inputs[el.dataset.tvar] = el.value);
      const t = { id: uid("t"), promptId: pid, name, expected, notes: $("#t_notes").value.trim(), inputs, results: {} };
      // run against every version
      versionsForPrompt(pid).forEach(vr => {
        const resp = mockModel(vr.body, inputs);
        t.results[vr.id] = { response: resp, pass: null, notes: "" };
      });
      state.db.testCases.push(t);
      saveDB(); closeModal(); router();
      toast("Test case added and run across versions");
    });
  }

  function runTest(tid) {
    const t = state.db.testCases.find(x => x.id === tid); if (!t) return;
    const p = promptById(t.promptId); if (!p) return;
    versionsForPrompt(p.id).forEach(vr => {
      const resp = mockModel(vr.body, t.inputs || {});
      const existing = t.results && t.results[vr.id];
      t.results[vr.id] = { response: resp, pass: existing ? existing.pass : null, notes: existing ? existing.notes : "" };
    });
    saveDB(); router();
    toast("Re-ran test against all versions");
  }

  // ---------- Editor bindings ----------
  function bindEditor(pid) {
    const p = pid ? promptById(pid) : null;
    const titleEl = $("#f_title");
    const catEl = $("#f_category");
    const tagsEl = $("#f_tags");
    const bodyEl = $("#f_body");
    const noteEl = $("#f_note");
    const modEl = $("#f_moderation");
    const live = $("#livePreview");
    const detected = $("#detectedVars");

    const updateLive = () => {
      const body = bodyEl.value;
      const vars = extractVars(body);
      detected.textContent = vars.length ? vars.join(", ") : "none";
      const sample = {}; vars.forEach(v => sample[v] = "«" + v + "»");
      const { text, missing } = resolveVars(body, sample);
      const html = esc(text).replace(/\{\{\s*([a-zA-Z_][\w-]*)\s*\}\}/g, '<span class="missing">{{$1}}</span>');
      live.innerHTML = html || '<span class="muted">Type a prompt to see the preview...</span>';
    };
    bodyEl.addEventListener("input", updateLive);
    updateLive();

    $("#cancelEdit").addEventListener("click", () => {
      if (p) go("prompt/" + encodeURIComponent(p.id)); else go("browse");
    });

    if ($("#seedTests")) $("#seedTests").addEventListener("click", () => seedSampleTests(p));

    $("#savePrompt").addEventListener("click", () => {
      const title = titleEl.value.trim();
      const category = catEl.value.trim();
      const body = bodyEl.value.trim();
      if (!title || !category || !body) return toast("Title, category, and body are required", "err");
      const tags = tagsEl.value.split(",").map(s => s.trim()).filter(Boolean);
      const mod = modEl.value;
      const note = noteEl.value.trim() || (p ? "Revision" : "Initial version");
      const now_ = Date.now();

      if (p) {
        // new version
        const nextN = Math.max.apply(null, versionsForPrompt(p.id).map(v => v.versionNumber)) + 1;
        const vid = uid(p.id + "_v");
        state.db.versions.push({ id: vid, promptId: p.id, versionNumber: nextN, body, authorId: currentUser().id, changeNote: note, createdAt: now_ });
        p.currentVersionId = vid;
        p.tags = tags;
        p.moderationState = mod;
        p.updatedAt = now_;
        saveDB();
        toast("Saved as v" + nextN);
        go("prompt/" + encodeURIComponent(p.id));
      } else {
        const pid = uid("p");
        const vid = pid + "_v1";
        state.db.prompts.push({
          id: pid, title, category, tags, authorId: currentUser().id,
          currentVersionId: vid, moderationState: mod, upvotes: [],
          createdAt: now_, updatedAt: now_, featured: false,
        });
        state.db.versions.push({ id: vid, promptId: pid, versionNumber: 1, body, authorId: currentUser().id, changeNote: note, createdAt: now_ });
        saveDB();
        toast("Prompt created");
        go("prompt/" + encodeURIComponent(pid));
      }
    });
  }

  function seedSampleTests(p) {
    if (!p) return;
    const body = currentVersionBody(p);
    const vars = extractVars(body);
    const inputs = {}; vars.forEach(v => inputs[v] = "sample_" + v);
    const t1 = { id: uid("t"), promptId: p.id, name: "Sample: basic correctness", expected: "Produces a coherent, on-task response.", notes: "Auto-seeded sample test case.", inputs, results: {} };
    const t2 = { id: uid("t"), promptId: p.id, name: "Sample: respects variable context", expected: "Response references the provided variable values.", notes: "Auto-seeded.", inputs, results: {} };
    versionsForPrompt(p.id).forEach(vr => {
      t1.results[vr.id] = { response: mockModel(vr.body, inputs), pass: null, notes: "" };
      t2.results[vr.id] = { response: mockModel(vr.body, inputs), pass: null, notes: "" };
    });
    state.db.testCases.push(t1, t2);
    saveDB();
    toast("Seeded 2 sample test cases");
    go("prompt/" + encodeURIComponent(p.id));
  }

  // ---------- Folder bindings ----------
  function bindFolders() {
    const me = currentUser().id;
    $$("[data-newfolder]").forEach(b => b.addEventListener("click", () => {
      openModal(`
        <button class="close" aria-label="Close">&times;</button>
        <h3>New folder</h3>
        <div class="field"><label>Folder name <span class="req">*</span></label><input id="fld_name" placeholder="e.g. Onboarding prompts" /></div>
        <div class="flex" style="justify-content:flex-end"><button class="btn btn-primary" id="fld_save">Create</button></div>
      `);
      $("#fld_save").addEventListener("click", () => {
        const name = $("#fld_name").value.trim();
        if (!name) return toast("Name required", "err");
        state.db.folders.push({ id: uid("f"), ownerId: me, name, promptIds: [] });
        saveDB(); closeModal(); router();
        toast("Folder created");
      });
    }));
    $$("[data-folderopen]").forEach(b => b.addEventListener("click", () => go("folder/" + encodeURIComponent(b.dataset.folderopen))));
    $$("[data-folderrename]").forEach(b => b.addEventListener("click", () => {
      const f = state.db.folders.find(x => x.id === b.dataset.folderrename); if (!f) return;
      openModal(`
        <button class="close" aria-label="Close">&times;</button>
        <h3>Rename folder</h3>
        <div class="field"><label>Name</label><input id="rn_name" value="${escAttr(f.name)}" /></div>
        <div class="flex" style="justify-content:flex-end"><button class="btn btn-primary" id="rn_save">Save</button></div>
      `);
      $("#rn_save").addEventListener("click", () => {
        f.name = $("#rn_name").value.trim() || f.name;
        saveDB(); closeModal(); router();
      });
    }));
    $$("[data-folderdel]").forEach(b => b.addEventListener("click", () => {
      const id = b.dataset.folderdel;
      state.db.folders = state.db.folders.filter(x => x.id !== id);
      saveDB(); router();
      toast("Folder deleted");
    }));
  }

  function bindFolder(fid) {
    const sel = $("#addPromptToFolder");
    if (sel) sel.addEventListener("change", () => {
      const pid = sel.value; if (!pid) return;
      const f = state.db.folders.find(x => x.id === fid); if (!f) return;
      if (!f.promptIds.includes(pid)) f.promptIds.push(pid);
      saveDB(); router();
      toast("Added to folder");
    });
  }

  // ---------- Admin bindings ----------
  function bindAdmin() {
    $$("[data-approve]").forEach(b => b.addEventListener("click", () => setMod(b.dataset.approve, "approved")));
    $$("[data-reject]").forEach(b => b.addEventListener("click", () => setMod(b.dataset.reject, "draft")));
    $$("[data-flag]").forEach(b => b.addEventListener("click", () => setMod(b.dataset.flag, "flagged")));
  }

  // continued in next chunk...
  window.PF = { state, go, toast, openModal, closeModal, uid, esc, extractVars, resolveVars, highlightVars, timeAgo, fmtDate, saveDB, init };
  init();
})();
