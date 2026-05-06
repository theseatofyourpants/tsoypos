/* =========================================================
   tsoypOS front-end — vanilla JS, no build step.
   Talks to the Express API for settings / guestbook / auth.
   ========================================================= */

/* ---------------- small helpers ---------------- */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// Tiny DOM factory. Safely sets text via textContent; never uses innerHTML
// for user-generated content.
function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === false || v == null) continue;
    if (k === "class") node.className = v;
    else if (k === "style" && typeof v === "object") Object.assign(node.style, v);
    else if (k === "html") node.innerHTML = v; // only for trusted strings
    else if (k === "text") node.textContent = v;
    else if (k.startsWith("on") && typeof v === "function") {
      node.addEventListener(k.slice(2).toLowerCase(), v);
    } else if (v === true) node.setAttribute(k, "");
    else node.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    node.appendChild(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return node;
}

function toast(msg, err = false) {
  const t = el("div", { class: "toast" + (err ? " err" : ""), text: msg });
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2400);
}

function timeAgo(iso) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return Math.floor(s / 60) + "m ago";
  if (s < 86400) return Math.floor(s / 3600) + "h ago";
  if (s < 604800) return Math.floor(s / 86400) + "d ago";
  return new Date(iso).toLocaleDateString();
}

/* ---------------- API client ---------------- */
const api = {
  async getSettings() {
    const r = await fetch("/api/settings");
    return r.json();
  },
  async saveSettings(s) {
    const r = await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(s),
    });
    if (!r.ok) {
      let detail = "";
      try { detail = (await r.json()).error || ""; } catch {}
      if (r.status === 401) throw new Error("session expired — log in again");
      throw new Error(detail || `HTTP ${r.status}`);
    }
    return r.json();
  },
  async getGuestbook() {
    const r = await fetch("/api/guestbook");
    return r.json();
  },
  async getGuestbookToken() {
    const r = await fetch("/api/guestbook/token");
    if (!r.ok) throw new Error("token failed");
    return (await r.json()).token;
  },
  async postGuestbook(name, msg, { token, hp } = {}) {
    const r = await fetch("/api/guestbook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, msg, token, hp }),
    });
    if (!r.ok) {
      let detail = "";
      try { detail = (await r.json()).error || ""; } catch {}
      const status = r.status;
      if (status === 429) throw new Error("rate limited");
      throw new Error(detail || "post failed");
    }
    return r.json();
  },
  async deleteGuestbook(id) {
    const r = await fetch("/api/guestbook/" + encodeURIComponent(id), {
      method: "DELETE",
    });
    if (!r.ok) throw new Error("delete failed");
    return r.json();
  },
  async login(password) {
    const r = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    return r;
  },
  async logout() {
    await fetch("/api/logout", { method: "POST" });
  },
  async me() {
    const r = await fetch("/api/me");
    return r.json();
  },
};

/* ---------------- theme presets ---------------- */
const THEMES = {
  matrix: {
    label: "Matrix",
    bg: "#050807", surface: "#0c1410", surfaceAlt: "#0f1d16",
    border: "#184a2e", text: "#c8ffd4", muted: "#5c9c73",
    accent: "#39ff7a", accent2: "#0fa958", danger: "#ff5577",
    chrome: "#0a1b12",
  },
  amber: {
    label: "Amber CRT",
    bg: "#0a0703", surface: "#14100a", surfaceAlt: "#1e1810",
    border: "#4a3418", text: "#ffcf8b", muted: "#a67a3e",
    accent: "#ffae3d", accent2: "#c97c12", danger: "#ff5a3d",
    chrome: "#1a130a",
  },
  synthwave: {
    label: "Synthwave",
    bg: "#0f0420", surface: "#1a0b33", surfaceAlt: "#24104a",
    border: "#4e2380", text: "#f0d9ff", muted: "#9778c4",
    accent: "#ff3cac", accent2: "#00e5ff", danger: "#ff5a7a",
    chrome: "#1d0a38",
  },
  dracula: {
    label: "Dracula",
    bg: "#1a1826", surface: "#282a36", surfaceAlt: "#32344a",
    border: "#44475a", text: "#f8f8f2", muted: "#9c9ab0",
    accent: "#bd93f9", accent2: "#50fa7b", danger: "#ff5555",
    chrome: "#21222c",
  },
  cyberpunk: {
    label: "Cyberpunk",
    bg: "#0a0a18", surface: "#10122a", surfaceAlt: "#161a3d",
    border: "#2d2b6e", text: "#e6fcff", muted: "#6a7ab8",
    accent: "#f9f871", accent2: "#ff00a8", danger: "#ff3860",
    chrome: "#0c0d24",
  },
  paperwhite: {
    label: "Paperwhite",
    bg: "#ecebe4", surface: "#ffffff", surfaceAlt: "#f4f3ea",
    border: "#c9c6b4", text: "#1b1b1a", muted: "#6b6a5f",
    accent: "#d23b2c", accent2: "#1e5bb8", danger: "#a8281d",
    chrome: "#e3e1d3",
  },
};

const COLOR_FIELDS = [
  ["bg", "background"],
  ["surface", "surface"],
  ["surfaceAlt", "surface alt"],
  ["border", "border"],
  ["text", "text"],
  ["muted", "muted"],
  ["accent", "accent"],
  ["accent2", "accent 2"],
  ["danger", "danger"],
  ["chrome", "chrome"],
];

/* ---------------- global state ---------------- */
const state = {
  settings: null,
  isAdmin: false,
  activeView: "home",
  panelOpen: false,
  loginOpen: false,
  panelTab: "theme",
  guestbook: [],
  clock: new Date(),
  serverVersion: null,
};

// Client build marker — lets you verify the browser actually loaded this file
// (not a cached older copy). Check the footer or the browser console.
const CLIENT_BUILD = "app.js v1.0.0";
console.log("tsoypOS client build:", CLIENT_BUILD);

/* ---------------- theme application ---------------- */
function applyThemeToDOM(colors, effects) {
  const r = document.documentElement;
  r.style.setProperty("--bg", colors.bg);
  r.style.setProperty("--surface", colors.surface);
  r.style.setProperty("--surface-alt", colors.surfaceAlt);
  r.style.setProperty("--border", colors.border);
  r.style.setProperty("--text", colors.text);
  r.style.setProperty("--muted", colors.muted);
  r.style.setProperty("--accent", colors.accent);
  r.style.setProperty("--accent-2", colors.accent2);
  r.style.setProperty("--danger", colors.danger);
  r.style.setProperty("--chrome", colors.chrome);
  document.body.classList.toggle("fx-scanlines", !!effects.scanlines);
  document.body.classList.toggle("fx-grain", !!effects.grain);
}

/* Debounced settings save — called as admin tweaks controls. */
let saveTimer = null;
let saving = false;
function scheduleSave() {
  clearTimeout(saveTimer);
  // Flip the footer indicator the moment the user edits something.
  const live = document.querySelector("[data-save-status]");
  if (live) { live.textContent = "● unsaved"; live.style.color = "var(--danger)"; }
  saveTimer = setTimeout(async () => {
    if (saving) { scheduleSave(); return; } // coalesce
    saving = true;
    if (live) { live.textContent = "● saving…"; live.style.color = "var(--muted)"; }
    try {
      await api.saveSettings(state.settings);
      if (live) { live.textContent = "● saved"; live.style.color = "var(--accent)"; }
    } catch (e) {
      console.error("settings save failed:", e);
      toast("save failed: " + (e.message || "unknown error"), true);
      if (live) { live.textContent = "● save failed"; live.style.color = "var(--danger)"; }
    } finally {
      saving = false;
    }
  }, 500);
}

/* ---------------- boot ---------------- */
async function boot() {
  try {
    const [settings, me] = await Promise.all([api.getSettings(), api.me()]);
    state.settings = settings;
    state.isAdmin = !!me.admin;
    state.guestbook = await api.getGuestbook();
    // Version is gated behind admin auth now — only fetch if logged in.
    if (state.isAdmin) await fetchVersion();
  } catch (e) {
    document.getElementById("app").textContent =
      "error: could not reach server. check that the backend is running.";
    return;
  }
  applyThemeToDOM(state.settings.colors, state.settings.effects);
  render();
  setInterval(() => {
    state.clock = new Date();
    const clockEl = $("[data-clock]");
    if (clockEl) clockEl.textContent = state.clock.toLocaleTimeString("en-US", { hour12: false });
  }, 1000);
}

async function fetchVersion() {
  try {
    const r = await fetch("/api/version");
    if (!r.ok) return;
    state.serverVersion = await r.json();
    console.log(
      `%ctsoypOS%c  client loaded, server v${state.serverVersion.version} started ${state.serverVersion.started}`,
      "background:#39ff7a;color:#050807;padding:2px 6px;font-weight:bold",
      "color:#5c9c73"
    );
  } catch {}
}

/* =========================================================
   RENDER
   ========================================================= */

/**
 * Capture transient UI state that the user expects to survive a render —
 * scroll positions of long-scrolling regions, and which element had focus.
 * Without this, every render() call resets the drawer scroll to 0 and the
 * terminal scroll to 0, which makes interacting with anything past the
 * first screen feel broken (every button click bounces you to the top).
 *
 * The matching restore function applies these *after* the new DOM is in
 * place. Restoration is best-effort: if the previously focused element no
 * longer exists, we just don't restore focus.
 */
function captureUIState() {
  const drawerBody = document.querySelector(".drawer-body");
  const termBody = document.querySelector(".term-body");
  const guestList = document.querySelector(".guest-list");
  // Capture a stable identifier for the focused element. We can't keep a
  // reference to the DOM node because render() is about to destroy it.
  // Instead, encode "which input is this" so we can find its replacement.
  const active = document.activeElement;
  let focusKey = null;
  if (active && active !== document.body) {
    // Prefer name + value pair (good for our text inputs), fall back to a
    // tag + closest-row signature. Selection range is captured for inputs.
    const tag = active.tagName;
    const inDrawer = !!active.closest(".drawer");
    const placeholder = active.getAttribute && active.getAttribute("placeholder");
    const value = active.value;
    const selStart = "selectionStart" in active ? active.selectionStart : null;
    const selEnd = "selectionEnd" in active ? active.selectionEnd : null;
    if (inDrawer && placeholder != null) {
      focusKey = { tag, placeholder, value, selStart, selEnd };
    }
  }
  return {
    drawerScroll: drawerBody ? drawerBody.scrollTop : 0,
    termScroll: termBody ? termBody.scrollTop : null,
    guestScroll: guestList ? guestList.scrollTop : null,
    focusKey,
  };
}

function restoreUIState(saved) {
  if (!saved) return;
  const drawerBody = document.querySelector(".drawer-body");
  if (drawerBody && saved.drawerScroll) drawerBody.scrollTop = saved.drawerScroll;
  const termBody = document.querySelector(".term-body");
  if (termBody && saved.termScroll != null) termBody.scrollTop = saved.termScroll;
  const guestList = document.querySelector(".guest-list");
  if (guestList && saved.guestScroll != null) guestList.scrollTop = saved.guestScroll;

  // Refocus the same logical input. We match on placeholder + value because
  // that pair uniquely identifies a row in the cert/project/link list (the
  // value differs per row even when the placeholder is the same).
  const fk = saved.focusKey;
  if (fk) {
    const candidates = document.querySelectorAll(
      `.drawer ${fk.tag.toLowerCase()}[placeholder]`
    );
    for (const node of candidates) {
      if (
        node.getAttribute("placeholder") === fk.placeholder &&
        node.value === fk.value
      ) {
        node.focus();
        if (fk.selStart != null && "setSelectionRange" in node) {
          try { node.setSelectionRange(fk.selStart, fk.selEnd ?? fk.selStart); } catch {}
        }
        break;
      }
    }
  }
}

function render() {
  const saved = captureUIState();
  const app = document.getElementById("app");
  app.textContent = "";
  app.appendChild(renderTopBar());
  app.appendChild(renderLayout());
  app.appendChild(renderFootBar());

  if (state.loginOpen) app.appendChild(renderLoginModal());
  if (state.panelOpen && state.isAdmin) app.appendChild(renderDrawer());

  restoreUIState(saved);
}

/**
 * Refresh only the parts of the page that live OUTSIDE the drawer —
 * topbar, sidebar, main content, footer. Used while the admin is typing
 * in the drawer: we want the public-facing UI to reflect their edits,
 * but we must NOT re-render the drawer itself (doing so destroys the
 * focused <input> and moves the cursor into whatever element gets
 * focus next in DOM order — which was the terminal input).
 */
function renderLiveSurfaces() {
  const saved = captureUIState();
  const app = document.getElementById("app");

  // Detach any overlays (drawer/modal backdrops) so they survive the rebuild.
  const overlays = [...app.children].filter((c) => c.classList.contains("backdrop"));
  overlays.forEach((n) => n.remove());

  // Rebuild the base page.
  app.textContent = "";
  app.appendChild(renderTopBar());
  app.appendChild(renderLayout());
  app.appendChild(renderFootBar());

  // Re-attach overlays on top, in their original order.
  overlays.forEach((n) => app.appendChild(n));

  restoreUIState(saved);
}

function renderTopBar() {
  const s = state.settings.identity;
  return el("div", { class: "topbar" },
    el("div", {
      class: "title" + (state.settings.effects.glow ? " glow" : ""),
      text: `${s.osName} ~ ${s.path}`,
    }),
    el("div", { class: "right" },
      state.isAdmin
        ? el("button", {
            class: "btn-ghost" + (state.panelOpen ? " active" : ""),
            onClick: () => { state.panelOpen = !state.panelOpen; render(); },
          }, "◆ customize")
        : el("button", {
            class: "btn-ghost",
            title: "admin login",
            onClick: () => { state.loginOpen = true; render(); },
          }, "● login"),
      el("span", { "data-clock": "" }, state.clock.toLocaleTimeString("en-US", { hour12: false })),
    ),
  );
}

function renderLayout() {
  return el("div", { class: "layout" },
    renderSidebar(),
    renderMain(),
  );
}

function renderSidebar() {
  const s = state.settings.identity;
  return el("aside", {},
    el("div", { class: "win" },
      el("div", { class: "win-head" },
        el("div", { class: "dots" },
          el("span", { class: "dot", style: { background: "var(--danger)" } }),
          el("span", { class: "dot", style: { background: "var(--accent-2)" } }),
          el("span", { class: "dot", style: { background: "var(--accent)" } }),
        ),
        el("span", {}, "bookmarks"),
      ),
      el("nav", { class: "nav" },
        [
          ["home", "◉"],
          ["projects", "▸"],
          ["certifications", "✦"],
          ["links", "↗"],
        ].map(([k, icon]) =>
          el("button", {
            class: "nav-item" + (state.activeView === k ? " active" : ""),
            onClick: () => { state.activeView = k; render(); },
          },
            el("span", { text: icon }),
            el("span", { text: k }),
          ),
        ),
      ),
    ),
    el("div", { class: "win profile" },
      el("img", {
        class: "avatar",
        src: s.avatar,
        alt: s.displayName,
        onerror: "this.style.display='none'",
      }),
      el("div", {
        class: "display display-name" + (state.settings.effects.glow ? " glow" : ""),
        text: s.displayName,
      }),
      el("div", { class: "pronouns", text: s.pronouns }),
    ),
  );
}

function renderMain() {
  const main = el("main");
  if (state.activeView === "home") main.appendChild(renderHome());
  if (state.activeView === "projects") main.appendChild(renderProjects());
  if (state.activeView === "certifications") main.appendChild(renderCertifications());
  if (state.activeView === "links") main.appendChild(renderLinks());
  main.appendChild(renderTerminal());
  main.appendChild(renderGuestbook());
  return main;
}

function renderHome() {
  const s = state.settings.identity;
  const glow = state.settings.effects.glow ? " glow" : "";
  return el("div", { class: "win card reveal" },
    el("div", { class: "card-heading" },
      el("span", { class: "display prompt" + glow, text: "$ whoami" }),
      el("span", { class: "hint", text: "→ " + s.username }),
    ),
    el("p", { class: "bio", text: s.bio }),
    el("div", { class: "pills" },
      el("span", { class: "pill", text: "status: online" }),
      el("span", { class: "pill", text: "shell: bash" }),
      el("span", { class: "pill", text: `kernel: ${s.osName.toLowerCase()}-linux` }),
    ),
  );
}

function renderProjects() {
  return el("div", { class: "win card reveal" },
    el("div", { class: "card-heading" },
      el("span", { class: "display prompt", text: "$ ls ~/projects" }),
    ),
    el("div", { class: "proj-list" },
      state.settings.projects.map((p) =>
        el("a", { class: "link-item proj-card", href: p.url || "#" },
          el("div", { class: "row" },
            el("span", { class: "name", text: "> " + p.name }),
            p.tag ? el("span", { class: "pill", text: p.tag }) : null,
          ),
          el("span", { class: "desc", text: p.desc || "" }),
        ),
      ),
    ),
  );
}

function renderCertifications() {
  const certs = state.settings.certifications || [];

  // Group by section while preserving the order each cert appears in the
  // array. The admin uses up/down buttons in the customize panel to control
  // cert-within-section order — we don't reshuffle here.
  const groups = new Map();
  for (const c of certs) {
    const key = (c.section || "Other").trim() || "Other";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(c);
  }

  // Section ordering: honor the explicit `certSectionOrder` array first, then
  // fall through to insertion-order for any sections not listed (typically
  // because the admin just added a new section and hasn't reordered yet).
  // Filtering through `groups.has` drops any stale entries from sectionOrder
  // that no longer have certs, so deleting all certs in a section auto-cleans.
  const explicitOrder = (state.settings.certSectionOrder || []).filter((s) =>
    groups.has(s)
  );
  const knownSections = new Set(explicitOrder);
  const remainingSections = [...groups.keys()].filter((s) => !knownSections.has(s));
  const orderedSections = [...explicitOrder, ...remainingSections];

  // Within a section: in-progress first, then earned. Both groups internally
  // preserve the array order the admin chose. Using a stable sort matters
  // here — Array.prototype.sort is stable in modern JS, but I'm being
  // explicit about the intent in case someone later swaps it for something
  // else.
  const sortWithinSection = (entries) => {
    const inProgress = entries.filter((c) => c.inProgress);
    const earned = entries.filter((c) => !c.inProgress);
    return [...inProgress, ...earned];
  };

  const wrap = el("div", { class: "win card reveal" },
    el("div", { class: "card-heading" },
      el("span", { class: "display prompt", text: "$ ls ~/certifications" }),
      el("span", { class: "hint", text: `→ ${certs.length} entries · ${groups.size} sections` }),
    ),
  );

  if (certs.length === 0) {
    wrap.appendChild(el("p", { class: "muted", style: { fontSize: "13px" } },
      "no certifications yet. add them via the customize panel."));
    return wrap;
  }

  for (const section of orderedSections) {
    const entries = sortWithinSection(groups.get(section));
    const sectionEl = el("section", { class: "cert-section" });
    sectionEl.appendChild(el("h3", { class: "cert-section-title" },
      el("span", { class: "cert-section-marker", text: "##" }),
      el("span", { text: section }),
      el("span", { class: "cert-section-count muted", text: `(${entries.length})` }),
    ));
    const list = el("div", { class: "cert-list" });
    for (const c of entries) list.appendChild(renderCertCard(c));
    sectionEl.appendChild(list);
    wrap.appendChild(sectionEl);
  }
  return wrap;
}

function renderCertCard(c) {
  return el("div", { class: "cert-card" + (c.inProgress ? " in-progress" : "") },
    el("div", { class: "cert-card-head" },
      el("div", { class: "cert-shorthand display", text: c.short || "?" }),
      el("div", { class: "cert-meta" },
        el("div", { class: "cert-vendor", text: c.vendor || "" }),
        c.full ? el("div", { class: "cert-full", text: c.full }) : null,
      ),
      c.inProgress
        ? el("span", { class: "pill cert-progress", text: "in progress" })
        : el("span", { class: "pill cert-earned", text: "earned" }),
    ),
    c.desc ? el("p", { class: "cert-desc", text: c.desc }) : null,
  );
}

function renderLinks() {
  return el("div", { class: "win card reveal" },
    el("div", { class: "card-heading" },
      el("span", { class: "display prompt", text: "$ cat ~/links" }),
    ),
    el("div", { class: "link-grid" },
      state.settings.links.map((l) =>
        el("a", { class: "link-item", href: l.url || "#", target: "_blank", rel: "noopener" },
          el("span", { class: "caret", text: "▸" }),
          el("span", { text: l.label }),
        ),
      ),
    ),
  );
}

/* ---------------- terminal ---------------- */
const termState = {
  history: [],
  cmdHistory: [],
  cmdIdx: -1,
  initialized: false,
};

function renderTerminal() {
  const s = state.settings.identity;
  const promptStr = `${s.username}@${s.hostname}:~${s.prompt} `;

  if (!termState.initialized) {
    termState.history = [
      { kind: "sys", text: `${s.osName} v2.4.1 — type 'help' for commands` },
    ];
    termState.initialized = true;
  }

  const body = el("div", { class: "term-body" });
  const input = el("input", {
    class: "term-input",
    autocomplete: "off",
    spellcheck: "false",
  });

  const refreshBody = (focusInput = false) => {
    body.textContent = "";
    for (const line of termState.history) {
      body.appendChild(el("div", { class: "term-line " + line.kind, text: line.text }));
    }
    const inputRow = el("div", { class: "term-input-row" },
      el("span", { class: "term-prompt", text: promptStr }),
      input,
    );
    body.appendChild(inputRow);
    body.scrollTop = body.scrollHeight;
    // Only grab focus when the user has explicitly interacted with the
    // terminal (ran a command, clicked it). Auto-focusing on every re-render
    // stomps on whatever input the user is currently typing in elsewhere
    // (e.g. the customize drawer).
    if (focusInput) input.focus();
  };

  const print = (text, kind = "out") => {
    termState.history.push({ kind, text });
  };

  const run = (raw) => {
    const cmd = raw.trim();
    termState.history.push({ kind: "in", text: promptStr + cmd });
    if (!cmd) return;
    termState.cmdHistory.push(cmd);
    termState.cmdIdx = -1;

    const [base, ...args] = cmd.split(/\s+/);
    switch (base) {
      case "help":
        print(
          "commands:\n" +
          "  help          show this\n" +
          "  whoami        current user\n" +
          "  about         bio\n" +
          "  ls            list bookmarks\n" +
          "  cd <view>     navigate (home|projects|certifications|links)\n" +
          "  projects      list projects\n" +
          "  certs         list certifications\n" +
          "  links         list links\n" +
          "  neofetch      system info\n" +
          "  theme <n>     switch theme (admin only)\n" +
          "  date          current date\n" +
          "  echo <msg>    echo\n" +
          "  login         open admin login\n" +
          "  logout        end admin session\n" +
          "  clear         clear terminal"
        );
        break;
      case "whoami":
        print(`${state.settings.identity.username} (${state.settings.identity.pronouns})${state.isAdmin ? "  [admin]" : ""}`);
        break;
      case "about":
      case "bio":
        print(state.settings.identity.bio);
        break;
      case "ls":
        print("home/  projects/  certifications/  links/");
        break;
      case "cd":
        if (["home", "projects", "certifications", "links"].includes(args[0])) {
          state.activeView = args[0];
          print(`→ switched to ${args[0]}`, "ok");
          setTimeout(render, 0);
        } else {
          print(`cd: no such view: ${args[0] || "(nothing)"}`, "err");
        }
        break;
      case "projects":
        print(state.settings.projects.map((p) => `  ${p.name.padEnd(20)} ${p.desc}`).join("\n"));
        break;
      case "certs":
      case "certifications":
        const certList = state.settings.certifications || [];
        if (!certList.length) {
          print("(no certifications listed)");
        } else {
          // Format: shorthand padded to 14 chars, then status, then full name.
          // Use a fixed width for the in-progress marker so the columns line up
          // regardless of which entries are earned vs. in-progress.
          print(certList.map((c) => {
            const status = c.inProgress ? "[in progress]" : "[earned]     ";
            return `  ${(c.short || "?").padEnd(14)} ${status}  ${c.full || ""}`;
          }).join("\n"));
        }
        break;
      case "links":
        print(state.settings.links.map((l) => `  ${l.label.padEnd(12)} ${l.url}`).join("\n"));
        break;
      case "neofetch":
        print(
          `       .=+=.       ${state.settings.identity.username}@${state.settings.identity.hostname}\n` +
          `      ( o_o )      -----------------\n` +
          `    __( ~~~ )__    OS:     ${state.settings.identity.osName}\n` +
          `   (__\\_____/__)   shell:  bash 5.2\n` +
          `                  theme:  ${state.settings.themeKey}\n` +
          `                  uptime: ${Math.floor(performance.now() / 1000)}s\n` +
          `                  admin:  ${state.isAdmin ? "yes" : "no"}`
        );
        break;
      case "theme":
        if (!state.isAdmin) {
          print("permission denied: admin only.", "err");
          break;
        }
        if (THEMES[args[0]]) {
          state.settings.themeKey = args[0];
          state.settings.colors = { ...THEMES[args[0]] };
          applyThemeToDOM(state.settings.colors, state.settings.effects);
          scheduleSave();
          print(`→ theme set to ${args[0]}`, "ok");
          setTimeout(render, 0);
        } else {
          print(`available themes: ${Object.keys(THEMES).join(", ")}`, args[0] ? "err" : "out");
        }
        break;
      case "date":
        print(new Date().toString());
        break;
      case "echo":
        print(args.join(" "));
        break;
      case "login":
        state.loginOpen = true;
        setTimeout(render, 0);
        break;
      case "logout":
        api.logout().then(() => {
          state.isAdmin = false;
          state.panelOpen = false;
          print("→ logged out", "ok");
          setTimeout(render, 0);
        });
        break;
      case "clear":
        termState.history = [];
        break;
      case "sudo":
        print("nice try.", "err");
        break;
      default:
        print(`${base}: command not found`, "err");
    }
  };

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      const v = input.value;
      input.value = "";
      run(v);
      refreshBody(true); // user explicitly ran a command — keep the focus here
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (!termState.cmdHistory.length) return;
      const next = termState.cmdIdx === -1
        ? termState.cmdHistory.length - 1
        : Math.max(0, termState.cmdIdx - 1);
      termState.cmdIdx = next;
      input.value = termState.cmdHistory[next];
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (termState.cmdIdx === -1) return;
      const next = termState.cmdIdx + 1;
      if (next >= termState.cmdHistory.length) {
        termState.cmdIdx = -1;
        input.value = "";
      } else {
        termState.cmdIdx = next;
        input.value = termState.cmdHistory[next];
      }
    }
  });

  const wrap = el("div", { class: "term reveal", onClick: () => input.focus() },
    el("div", { class: "term-head" },
      el("span", { text: "▶ terminal" }),
      el("span", { text: `${s.username}@${s.hostname}` }),
    ),
    body,
  );

  // first paint
  queueMicrotask(refreshBody);
  return wrap;
}

/* ---------------- guestbook ---------------- */
function renderGuestbook() {
  const list = el("div", { class: "guest-list" });
  for (const m of state.guestbook) {
    const entry = el("div", { class: "guest-msg" },
      el("div", { class: "meta" },
        el("span", { class: "handle", text: "~" + m.name }),
        el("span", { text: timeAgo(m.ts) }),
      ),
      el("div", { class: "body", text: m.msg }),
      state.isAdmin ? el("button", {
        class: "delete-btn",
        onClick: async () => {
          if (!confirm("delete this entry?")) return;
          try {
            await api.deleteGuestbook(m.id);
            state.guestbook = state.guestbook.filter((x) => x.id !== m.id);
            render();
          } catch { toast("delete failed", true); }
        },
        text: "del",
      }) : null,
    );
    list.appendChild(entry);
  }
  if (!state.guestbook.length) {
    list.appendChild(el("div", { class: "muted", style: { padding: "12px", fontSize: "13px" } },
      "no messages yet. break the silence."));
  }

  const nameInput = el("input", {
    class: "text-input", placeholder: "handle", maxlength: "40",
  });
  const msgInput = el("textarea", {
    class: "text-input", placeholder: "leave a message for the void…",
    rows: "2", maxlength: "400",
  });

  // Honeypot field: hidden from real users via off-screen positioning,
  // tabindex -1, and aria-hidden. Naive bots fill every <input> they find,
  // so a non-empty value is a strong "this is automated" signal. Using
  // display:none would let sophisticated bots skip it; positioning it
  // off-screen makes it harder to detect programmatically.
  const honeypot = el("input", {
    type: "text",
    name: "homepage",
    tabindex: "-1",
    autocomplete: "off",
    "aria-hidden": "true",
    style: {
      position: "absolute",
      left: "-9999px",
      top: "-9999px",
      width: "1px",
      height: "1px",
      opacity: "0",
      pointerEvents: "none",
    },
  });

  // Fetch the submission token on first interaction. Doing this lazily
  // (on focus rather than at render) means we don't issue tokens to readers
  // who never intend to post — keeps the in-memory used-token set smaller
  // and avoids hammering the token endpoint with idle-tab traffic.
  let tokenPromise = null;
  const ensureToken = () => {
    if (!tokenPromise) tokenPromise = api.getGuestbookToken().catch(() => null);
    return tokenPromise;
  };
  nameInput.addEventListener("focus", ensureToken, { once: true });
  msgInput.addEventListener("focus", ensureToken, { once: true });

  const postBtn = el("button", { class: "btn-primary" }, "▶ post to the void");
  postBtn.addEventListener("click", async () => {
    const name = nameInput.value.trim();
    const msg = msgInput.value.trim();
    if (!name || !msg) { toast("fill both fields", true); return; }
    postBtn.disabled = true;
    try {
      // Make sure we have a token (covers users who clicked submit without
      // ever focusing a field — e.g. via JS).
      const token = await ensureToken();
      const entry = await api.postGuestbook(name, msg, {
        token,
        hp: honeypot.value,
      });
      state.guestbook.unshift(entry);
      nameInput.value = "";
      msgInput.value = "";
      // Token is now burned — invalidate so a fresh one is fetched next time.
      tokenPromise = null;
      render();
      toast("posted");
    } catch (e) {
      const msg = String(e.message || "failed");
      toast(msg, true);
      // If the token failed (expired, reused, mismatch), refresh it so
      // the next attempt has a chance.
      if (msg.includes("token") || msg.includes("network changed") || msg.includes("slow down")) {
        tokenPromise = null;
      }
    } finally {
      postBtn.disabled = false;
    }
  });

  return el("div", { class: "win card" },
    el("div", { class: "row-between mb-12" },
      el("span", { class: "display", style: { fontSize: "22px", color: "var(--accent)" }, text: "# guestbook" }),
      el("span", { class: "muted", style: { fontSize: "11px" }, text: state.guestbook.length + " entries" }),
    ),
    list,
    el("div", { style: { display: "grid", gap: "8px", position: "relative" } },
      nameInput, msgInput, honeypot, postBtn,
    ),
  );
}

/* ---------------- login modal ---------------- */
function renderLoginModal() {
  const input = el("input", {
    class: "text-input", type: "password", placeholder: "admin password",
    autofocus: true,
  });
  const errorLine = el("div", {
    class: "muted",
    style: { fontSize: "11px", color: "var(--danger)", display: "none" },
  });

  const submit = async () => {
    if (!input.value) return;
    const r = await api.login(input.value);
    if (r.ok) {
      state.isAdmin = true;
      state.loginOpen = false;
      state.panelOpen = true;
      await fetchVersion();
      toast("authenticated");
      render();
    } else if (r.status === 429) {
      errorLine.textContent = "too many attempts — wait a minute.";
      errorLine.style.display = "block";
    } else {
      errorLine.textContent = "invalid password.";
      errorLine.style.display = "block";
      input.select();
    }
  };
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });

  const close = () => { state.loginOpen = false; render(); };

  return el("div", { class: "backdrop", onClick: close },
    el("div", {
      class: "modal",
      onClick: (e) => e.stopPropagation(),
    },
      el("div", { class: "modal-head" },
        el("span", { text: "◉ admin login" }),
        el("button", { class: "btn-ghost", onClick: close }, "esc"),
      ),
      el("div", { class: "modal-body" },
        el("label", { class: "field", text: "password" }),
        input,
        errorLine,
        el("button", { class: "btn-primary", onClick: submit }, "▶ authenticate"),
        el("div", { class: "muted", style: { fontSize: "11px", lineHeight: "1.5" } },
          "set via the ADMIN_PASSWORD env var on the server."),
      ),
    ),
  );
}

/* ---------------- customize drawer ---------------- */
function renderDrawer() {
  const close = () => { state.panelOpen = false; render(); };

  const logout = async () => {
    await api.logout();
    state.isAdmin = false;
    state.panelOpen = false;
    toast("logged out");
    render();
  };

  const tabs = [
    ["theme", "theme"],
    ["identity", "identity"],
    ["content", "content"],
    ["effects", "fx"],
  ];

  const tabNav = el("div", { class: "drawer-tabs" },
    tabs.map(([k, label]) =>
      el("button", {
        class: state.panelTab === k ? "active" : "",
        onClick: () => { state.panelTab = k; render(); },
      }, label),
    ),
  );

  let body;
  if (state.panelTab === "theme") body = renderTabTheme();
  else if (state.panelTab === "identity") body = renderTabIdentity();
  else if (state.panelTab === "content") body = renderTabContent();
  else body = renderTabEffects();

  return el("div", { class: "backdrop", onClick: close },
    el("div", {
      class: "drawer",
      onClick: (e) => e.stopPropagation(),
    },
      el("div", { class: "drawer-head" },
        el("span", {
          class: "display",
          style: { fontSize: "22px", color: "var(--accent)" },
          text: "◆ customize",
        }),
        el("div", { style: { display: "flex", gap: "6px" } },
          el("button", { class: "btn-ghost", onClick: logout }, "logout"),
          el("button", { class: "btn-ghost", onClick: close }, "✕"),
        ),
      ),
      tabNav,
      el("div", { class: "drawer-body" }, body),
      el("div", { class: "drawer-foot" },
        el("span", { text: "changes save automatically" }),
        el("span", {
          "data-save-status": "",
          style: { color: "var(--accent)" },
          text: "● ready",
        }),
      ),
    ),
  );
}

function renderTabTheme() {
  const wrap = el("div");

  wrap.appendChild(el("label", { class: "field", text: "presets" }));
  const presets = el("div", { class: "grid-2", style: { marginBottom: "20px" } });
  for (const [key, theme] of Object.entries(THEMES)) {
    const isActive = state.settings.themeKey === key;
    presets.appendChild(el("button", {
      class: "preset-btn",
      style: {
        background: theme.surface,
        color: theme.accent,
        border: `1px solid ${isActive ? theme.accent : theme.border}`,
      },
      onClick: () => {
        state.settings.themeKey = key;
        state.settings.colors = { ...theme };
        applyThemeToDOM(state.settings.colors, state.settings.effects);
        scheduleSave();
        render();
      },
    },
      el("span", { class: "label", text: theme.label }),
      el("div", { class: "swatches" },
        [theme.accent, theme.accent2, theme.text, theme.muted].map((c) =>
          el("span", { class: "sw", style: { background: c, border: `1px solid ${theme.border}` } }),
        ),
      ),
    ));
  }
  wrap.appendChild(presets);

  wrap.appendChild(el("label", { class: "field", text: "custom colors" }));
  const colorGrid = el("div", { class: "grid-2" });
  for (const [key, label] of COLOR_FIELDS) {
    const cp = el("input", {
      type: "color", value: state.settings.colors[key],
    });
    const tx = el("input", {
      class: "text-input", type: "text",
      value: state.settings.colors[key],
      style: { fontSize: "10px" },
    });
    const sync = (v) => {
      if (!/^#[0-9a-fA-F]{6}$/.test(v)) return;
      state.settings.colors[key] = v;
      state.settings.themeKey = "custom";
      applyThemeToDOM(state.settings.colors, state.settings.effects);
      scheduleSave();
    };
    cp.addEventListener("input", (e) => { tx.value = e.target.value; sync(e.target.value); });
    tx.addEventListener("input", (e) => { cp.value = e.target.value; sync(e.target.value); });
    colorGrid.appendChild(el("div", {},
      el("span", { class: "field", text: label }),
      el("div", { class: "color-row" }, cp, tx),
    ));
  }
  wrap.appendChild(colorGrid);
  return wrap;
}

function renderTabIdentity() {
  const s = state.settings.identity;
  const wrap = el("div", { style: { display: "grid", gap: "14px" } });
  const fields = [
    ["osName", "os name"],
    ["displayName", "display name"],
    ["pronouns", "pronouns"],
    ["username", "username (shell)"],
    ["hostname", "hostname"],
    ["path", "path"],
    ["prompt", "prompt char"],
    ["avatar", "avatar url"],
  ];
  // Update state + debounce-save on every keystroke, but DON'T re-render —
  // re-rendering the whole tree blows away focus and cursor position.
  // The sidebar/topbar/etc. repaint when the user tabs out (blur) or the drawer closes.
  for (const [key, label] of fields) {
    const input = el("input", { class: "text-input", value: s[key] || "" });
    input.addEventListener("input", (e) => {
      state.settings.identity[key] = e.target.value;
      scheduleSave();
    });
    input.addEventListener("blur", () => {
      // Refresh the rest of the UI once the user is done typing in this field.
      renderLiveSurfaces();
    });
    wrap.appendChild(el("div", {},
      el("span", { class: "field", text: label }), input,
    ));
  }
  const bio = el("textarea", {
    class: "text-input", rows: "4",
    style: { resize: "vertical" },
  });
  bio.value = s.bio || "";
  bio.addEventListener("input", (e) => {
    state.settings.identity.bio = e.target.value;
    scheduleSave();
  });
  bio.addEventListener("blur", () => renderLiveSurfaces());
  wrap.appendChild(el("div", {},
    el("span", { class: "field", text: "bio" }), bio,
  ));
  return wrap;
}

function renderTabContent() {
  const wrap = el("div", { style: { display: "grid", gap: "20px" } });

  /* ---- projects ---- */
  const projSection = el("div");
  projSection.appendChild(el("div", { class: "row-between mb-12" },
    el("span", { class: "field", style: { marginBottom: 0 }, text: "projects" }),
    el("button", {
      class: "btn-ghost",
      onClick: () => {
        state.settings.projects.push({ name: "new project", desc: "", url: "#", tag: "" });
        scheduleSave();
        render();
      },
    }, "+ add"),
  ));
  for (let i = 0; i < state.settings.projects.length; i++) {
    const p = state.settings.projects[i];
    const row = el("div", {
      style: {
        display: "grid", gap: "6px",
        padding: "8px",
        border: "1px solid var(--border)",
        background: "var(--surface-alt)",
        marginBottom: "8px",
      },
    });
    const name = el("input", { class: "text-input", placeholder: "name", value: p.name });
    const desc = el("input", { class: "text-input", placeholder: "description", value: p.desc });
    const url = el("input", { class: "text-input", placeholder: "url", value: p.url });
    const tag = el("input", { class: "text-input", placeholder: "tag (e.g. wip)", value: p.tag });
    [["name", name], ["desc", desc], ["url", url], ["tag", tag]].forEach(([k, inp]) => {
      inp.addEventListener("input", (e) => {
        state.settings.projects[i][k] = e.target.value;
        scheduleSave();
      });
      inp.addEventListener("blur", () => renderLiveSurfaces());
    });
    const del = el("button", {
      class: "btn-ghost",
      style: { alignSelf: "flex-end" },
      onClick: () => {
        if (confirm("delete this project?")) {
          state.settings.projects.splice(i, 1);
          scheduleSave();
          render();
        }
      },
    }, "remove");
    row.appendChild(name);
    row.appendChild(desc);
    row.appendChild(url);
    row.appendChild(tag);
    row.appendChild(del);
    projSection.appendChild(row);
  }
  wrap.appendChild(projSection);

  /* ---- links ---- */
  const linkSection = el("div");
  linkSection.appendChild(el("div", { class: "row-between mb-12" },
    el("span", { class: "field", style: { marginBottom: 0 }, text: "links" }),
    el("button", {
      class: "btn-ghost",
      onClick: () => {
        state.settings.links.push({ label: "new link", url: "#" });
        scheduleSave();
        render();
      },
    }, "+ add"),
  ));
  for (let i = 0; i < state.settings.links.length; i++) {
    const l = state.settings.links[i];
    const row = el("div", {
      style: {
        display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: "6px",
        marginBottom: "6px", alignItems: "center",
      },
    });
    const label = el("input", { class: "text-input", placeholder: "label", value: l.label });
    const url = el("input", { class: "text-input", placeholder: "url", value: l.url });
    label.addEventListener("input", (e) => { state.settings.links[i].label = e.target.value; scheduleSave(); });
    url.addEventListener("input", (e) => { state.settings.links[i].url = e.target.value; scheduleSave(); });
    label.addEventListener("blur", () => renderLiveSurfaces());
    url.addEventListener("blur", () => renderLiveSurfaces());
    const del = el("button", {
      class: "btn-ghost",
      onClick: () => {
        state.settings.links.splice(i, 1);
        scheduleSave();
        render();
      },
    }, "✕");
    row.appendChild(label);
    row.appendChild(url);
    row.appendChild(del);
    linkSection.appendChild(row);
  }
  wrap.appendChild(linkSection);

  /* ---- certifications ---- */
  // Backwards-compat: older saved settings may not have these fields, so
  // initialize lazily rather than failing on read.
  if (!Array.isArray(state.settings.certifications)) {
    state.settings.certifications = [];
  }
  if (!Array.isArray(state.settings.certSectionOrder)) {
    state.settings.certSectionOrder = [];
  }
  const certs = state.settings.certifications;

  const certSection = el("div");
  certSection.appendChild(el("div", { class: "row-between mb-12" },
    el("span", { class: "field", style: { marginBottom: 0 }, text: "certifications" }),
    el("button", {
      class: "btn-ghost",
      onClick: () => {
        const lastSection = certs.length ? certs[certs.length - 1].section || "" : "";
        certs.push({
          id: "cert-" + Math.random().toString(36).slice(2, 9),
          section: lastSection,
          vendor: "",
          short: "",
          full: "",
          desc: "",
          inProgress: false,
        });
        // If this is a brand-new section name, append it to the explicit order.
        if (lastSection && !state.settings.certSectionOrder.includes(lastSection)) {
          state.settings.certSectionOrder.push(lastSection);
        }
        scheduleSave();
        render();
      },
    }, "+ add"),
  ));

  // ---- section ordering controls ----
  // Build the canonical, deduplicated list of sections in display order.
  // This needs to mirror the public view's logic so what the admin sees in
  // the reorder controls matches what they see on the page.
  const presentSections = [...new Set(certs.map((c) => (c.section || "Other").trim() || "Other"))];
  const explicitOrder = state.settings.certSectionOrder.filter((s) => presentSections.includes(s));
  const remainingSections = presentSections.filter((s) => !explicitOrder.includes(s));
  const allSections = [...explicitOrder, ...remainingSections];

  // Auto-heal: if remainingSections has anything, the explicit order is out of
  // date relative to actual data. Persist the merged order so next render the
  // section is fully managed by the ordering UI. Done via scheduleSave to
  // avoid render loops.
  if (remainingSections.length) {
    state.settings.certSectionOrder = allSections;
    scheduleSave();
  }

  if (allSections.length > 1) {
    const orderBox = el("div", {
      style: {
        background: "var(--surface-alt)",
        border: "1px solid var(--border)",
        padding: "10px",
        marginBottom: "12px",
      },
    });
    orderBox.appendChild(el("div", {
      class: "field",
      style: { marginBottom: "6px" },
      text: "section order",
    }));
    for (let i = 0; i < allSections.length; i++) {
      const s = allSections[i];
      const isFirst = i === 0;
      const isLast = i === allSections.length - 1;
      const move = (dir) => {
        const arr = state.settings.certSectionOrder;
        const idx = arr.indexOf(s);
        if (idx === -1) return;
        const target = idx + dir;
        if (target < 0 || target >= arr.length) return;
        // Swap-in-place keeps the implementation simple and is fine for the
        // small N of sections an admin will realistically have.
        [arr[idx], arr[target]] = [arr[target], arr[idx]];
        scheduleSave();
        render();
      };
      const row = el("div", {
        style: {
          display: "grid",
          gridTemplateColumns: "1fr auto auto",
          gap: "4px",
          alignItems: "center",
          padding: "4px 0",
        },
      },
        el("span", {
          style: { fontSize: "12px", color: "var(--text)" },
          text: s,
        }),
        el("button", {
          class: "btn-ghost",
          disabled: isFirst,
          style: { padding: "2px 8px", opacity: isFirst ? "0.3" : "1" },
          onClick: () => move(-1),
          title: "move up",
        }, "▲"),
        el("button", {
          class: "btn-ghost",
          disabled: isLast,
          style: { padding: "2px 8px", opacity: isLast ? "0.3" : "1" },
          onClick: () => move(1),
          title: "move down",
        }, "▼"),
      );
      orderBox.appendChild(row);
    }
    certSection.appendChild(orderBox);
  }

  // ---- per-cert edit rows, grouped by section ----
  // Datalist for section autocomplete (same as before).
  const datalistId = "cert-sections-list";
  const datalist = el("datalist", { id: datalistId });
  for (const s of allSections) datalist.appendChild(el("option", { value: s }));
  certSection.appendChild(datalist);

  // Helper: move a cert up or down within its status group (in-progress
  // separately from earned), since the public view sorts in-progress first
  // regardless of array position. Letting up/down freely cross the
  // boundary would be confusing — the cert would seem to "jump" past the
  // status divider on the rendered page.
  const moveCertWithinGroup = (certId, dir) => {
    const idx = certs.findIndex((c) => c.id === certId);
    if (idx === -1) return;
    const cert = certs[idx];
    // Find the next index in the same section AND same in-progress status,
    // walking in the requested direction.
    let target = idx + dir;
    while (target >= 0 && target < certs.length) {
      const candidate = certs[target];
      const sameSection =
        (candidate.section || "Other").trim() === (cert.section || "Other").trim();
      const sameStatus = !!candidate.inProgress === !!cert.inProgress;
      if (sameSection && sameStatus) break;
      target += dir;
    }
    if (target < 0 || target >= certs.length) return;
    // Swap the two array positions. Other entries between idx and target
    // stay where they are — they're in different sections or status groups
    // and shouldn't move when this cert moves.
    [certs[idx], certs[target]] = [certs[target], certs[idx]];
    scheduleSave();
    render();
  };

  // Render edit rows grouped by section header. The visual grouping makes
  // it clear which up/down arrows are scoped to which section.
  for (const sectionName of allSections) {
    // Same in-progress-first sort the public view uses, so the admin is
    // editing the same order they see on the page.
    const inSection = certs.filter((c) => ((c.section || "Other").trim() || "Other") === sectionName);
    const inProgress = inSection.filter((c) => c.inProgress);
    const earned = inSection.filter((c) => !c.inProgress);
    const ordered = [...inProgress, ...earned];

    certSection.appendChild(el("div", {
      style: {
        fontSize: "10px",
        color: "var(--muted)",
        textTransform: "uppercase",
        letterSpacing: "0.15em",
        marginTop: "16px",
        marginBottom: "6px",
        paddingBottom: "4px",
        borderBottom: "1px dashed var(--border)",
      },
      text: `## ${sectionName}  (${inSection.length})`,
    }));

    for (let groupIdx = 0; groupIdx < ordered.length; groupIdx++) {
      const c = ordered[groupIdx];
      const i = certs.indexOf(c); // real array index for field updates
      const isFirstInGroup = groupIdx === 0 || ordered[groupIdx - 1].inProgress !== c.inProgress;
      const isLastInGroup = groupIdx === ordered.length - 1 || ordered[groupIdx + 1].inProgress !== c.inProgress;

      const row = el("div", {
        class: "cert-edit-row" + (c.inProgress ? " in-progress" : ""),
      });

      const section = el("input", {
        class: "text-input",
        placeholder: "section (e.g. Security, Microsoft)",
        list: datalistId,
        value: c.section || "",
      });
      const vendorInp = el("input", {
        class: "text-input",
        placeholder: "vendor (e.g. CompTIA)",
        value: c.vendor || "",
      });
      const shortInp = el("input", {
        class: "text-input",
        placeholder: "short name (e.g. Security+)",
        value: c.short || "",
      });
      const fullInp = el("input", {
        class: "text-input",
        placeholder: "full name (e.g. CompTIA Security+)",
        value: c.full || "",
      });
      const descInp = el("textarea", {
        class: "text-input",
        placeholder: "short description",
        rows: "2",
        style: { resize: "vertical" },
      });
      descInp.value = c.desc || "";

      const fields = [
        ["section", section],
        ["vendor", vendorInp],
        ["short", shortInp],
        ["full", fullInp],
        ["desc", descInp],
      ];
      for (const [k, inp] of fields) {
        inp.addEventListener("input", (e) => {
          certs[i][k] = e.target.value;
          // If section was edited to a new value, tag it onto the order
          // list so it gets a slot in the reorder UI on next render.
          if (k === "section") {
            const v = e.target.value.trim();
            if (v && !state.settings.certSectionOrder.includes(v)) {
              state.settings.certSectionOrder.push(v);
            }
          }
          scheduleSave();
        });
        inp.addEventListener("blur", () => renderLiveSurfaces());
      }

      const inProg = el("input", { type: "checkbox" });
      inProg.checked = !!c.inProgress;
      inProg.addEventListener("change", (e) => {
        certs[i].inProgress = e.target.checked;
        scheduleSave();
        render();
      });

      const upBtn = el("button", {
        class: "btn-ghost",
        disabled: isFirstInGroup,
        style: { padding: "2px 8px", opacity: isFirstInGroup ? "0.3" : "1" },
        onClick: () => moveCertWithinGroup(c.id, -1),
        title: "move up within section",
      }, "▲");
      const downBtn = el("button", {
        class: "btn-ghost",
        disabled: isLastInGroup,
        style: { padding: "2px 8px", opacity: isLastInGroup ? "0.3" : "1" },
        onClick: () => moveCertWithinGroup(c.id, 1),
        title: "move down within section",
      }, "▼");

      const del = el("button", {
        class: "btn-ghost",
        onClick: () => {
          if (confirm(`delete certification "${c.short || c.full || "untitled"}"?`)) {
            certs.splice(i, 1);
            scheduleSave();
            render();
          }
        },
      }, "remove");

      row.appendChild(el("div", { class: "pair" }, section, vendorInp));
      row.appendChild(el("div", { class: "pair" }, shortInp, fullInp));
      row.appendChild(descInp);
      row.appendChild(el("div", { class: "row-actions" },
        el("label", { class: "inline" },
          inProg,
          el("span", { text: "in progress" }),
        ),
        el("div", { style: { display: "flex", gap: "4px", alignItems: "center" } },
          upBtn,
          downBtn,
          del,
        ),
      ));
      certSection.appendChild(row);
    }
  }
  wrap.appendChild(certSection);

  return wrap;
}

function renderTabEffects() {
  const wrap = el("div", { style: { display: "grid", gap: "10px" } });
  const opts = [
    ["scanlines", "CRT scanlines"],
    ["glow", "text glow"],
    ["grain", "film grain"],
  ];
  for (const [key, label] of opts) {
    const cb = el("input", { type: "checkbox" });
    cb.checked = !!state.settings.effects[key];
    cb.addEventListener("change", (e) => {
      state.settings.effects[key] = e.target.checked;
      applyThemeToDOM(state.settings.colors, state.settings.effects);
      scheduleSave();
      render();
    });
    wrap.appendChild(el("label", { class: "toggle-row" },
      el("span", { text: label }), cb,
    ));
  }
  return wrap;
}

/* ---------------- footer ---------------- */
function renderFootBar() {
  const s = state.settings.identity;
  const v = state.serverVersion;
  // Only admins see build/version info — public visitors see the plain
  // identity footer. This matches the /api/version endpoint being gated.
  const versionText = state.isAdmin && v
    ? `${CLIENT_BUILD} · server v${v.version}`
    : `theme: ${state.settings.themeKey} · ${new Date().toLocaleDateString()}`;
  return el("footer", { class: "footbar" },
    el("span", { text: `${s.username}@${s.hostname}` }),
    el("span", {
      title: state.isAdmin && v ? `server started: ${v.started}` : "",
      text: versionText,
    }),
  );
}

/* ---------------- keyboard shortcuts ---------------- */
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (state.panelOpen) { state.panelOpen = false; render(); }
    else if (state.loginOpen) { state.loginOpen = false; render(); }
  }
  // Ctrl/Cmd+K → login or customize
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
    e.preventDefault();
    if (state.isAdmin) state.panelOpen = !state.panelOpen;
    else state.loginOpen = true;
    render();
  }
});

/* ---------------- go ---------------- */
boot();
