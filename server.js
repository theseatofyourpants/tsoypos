/**
 * tsoypOS — single-file Express server
 *
 * Endpoints:
 *   GET    /api/settings        public — site config
 *   PUT    /api/settings        admin  — update config
 *   GET    /api/guestbook       public — list entries
 *   GET    /api/guestbook/token public — get an anti-bot token (one-time use)
 *   POST   /api/guestbook       public — add entry (rate-limited + token-gated)
 *   DELETE /api/guestbook/:id   admin  — delete entry
 *   POST   /api/login           public — password login
 *   POST   /api/logout          public — clear session
 *   GET    /api/me              public — { admin: bool }
 *   GET    /api/health          public — minimal liveness check
 *   GET    /api/version         admin  — version + start time
 *
 * Env vars (see .env.example):
 *   ADMIN_PASSWORD   required — plaintext admin password
 *   COOKIE_SECURE    required when behind HTTPS (set to "true")
 *   SESSION_SECRET   optional — auto-generated & persisted if not set
 *   PORT             optional — defaults to 3000
 *   DATA_DIR         optional — defaults to ./data
 *   NODE_ENV         set to "production" to enable secure-cookie defaults
 */

// Require deps with a friendly failure mode. If the image was built without
// reinstalling node_modules after a package.json change, the bare
// `require("helmet")` crash produces a stack trace that doesn't make it
// obvious *why* the module is missing. This wrapper does.
function safeRequire(name) {
  try {
    return require(name);
  } catch (err) {
    if (err.code === "MODULE_NOT_FOUND" && err.message.includes(name)) {
      console.error("");
      console.error(`FATAL: required module '${name}' is not installed.`);
      console.error("");
      console.error("This means the Docker image was built before this dep was");
      console.error("added to package.json, OR Docker reused a cached npm-install");
      console.error("layer. Fix one of these ways:");
      console.error("");
      console.error("  1. Container Manager → Project → tsoypos → Build, then");
      console.error("     check the Build log for an '=== installed top-level");
      console.error(`     deps ===' line. If '${name}' isn't listed, the cache`);
      console.error("     was reused — see option 2 or 3.");
      console.error("");
      console.error("  2. Stop the project, then via SSH:");
      console.error("       cd /volume1/docker/tsoypos");
      console.error("       sudo docker compose build --no-cache");
      console.error("       sudo docker compose up -d");
      console.error("");
      console.error("  3. Container Manager → Image → delete the tsoypos image");
      console.error("     entirely → then Project → tsoypos → Build (forces a");
      console.error("     fresh build with no cached layers).");
      console.error("");
      process.exit(1);
    }
    throw err;
  }
}

const express = safeRequire("express");
const session = safeRequire("express-session");
const helmet = safeRequire("helmet");
const sanitizeHtml = safeRequire("sanitize-html");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const PORT = parseInt(process.env.PORT || "3000", 10);
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const PROD = process.env.NODE_ENV === "production";

// Session cookie: `secure: true` requires HTTPS and the browser will silently
// reject the cookie on plain HTTP. That breaks LAN access via http://<nas>:3000.
// Only enable it when you know you're behind HTTPS (reverse proxy, Cloudflare
// Tunnel, etc.). Default is OFF so login works out of the box on a LAN.
const SECURE_COOKIE = process.env.COOKIE_SECURE === "true";

const STARTED_AT = new Date().toISOString();
const VERSION = "1.0.0"; // bump this when you change the code so the UI reflects it

if (!ADMIN_PASSWORD) {
  console.error("FATAL: ADMIN_PASSWORD env var is required.");
  console.error("       Set it in .env or pass via docker-compose / systemd.");
  process.exit(1);
}
if (ADMIN_PASSWORD.length < 10) {
  console.warn("WARN: ADMIN_PASSWORD is shorter than 10 chars. Use something stronger.");
}

/* ------------------------------------------------------------------ */
/*  Persistent storage (plain JSON files, no DB needed)                */
/* ------------------------------------------------------------------ */
fs.mkdirSync(DATA_DIR, { recursive: true });

// Proactively verify the data directory is writable. Catching this at boot
// with a clear message is far better than mysterious PUT /api/settings
// failures later. Most common cause on Synology: bind-mounted host folder
// was created by a DSM user whose UID doesn't match the container.
try {
  const probe = path.join(DATA_DIR, ".write-probe");
  fs.writeFileSync(probe, "ok");
  fs.unlinkSync(probe);
} catch (err) {
  console.error("");
  console.error("FATAL: cannot write to DATA_DIR:", DATA_DIR);
  console.error("       error:", err.code || err.message);
  console.error("");
  console.error("       On Synology: in File Station, right-click the data/ folder,");
  console.error("       Properties → Permission → give the container's user write access.");
  console.error("       Quickest workaround: `chmod -R 777 /volume1/docker/tsoypos/data`");
  console.error("       (via SSH, or Task Scheduler → user-defined script as root).");
  console.error("");
  process.exit(1);
}

const SETTINGS_FILE = path.join(DATA_DIR, "settings.json");
const GUESTBOOK_FILE = path.join(DATA_DIR, "guestbook.json");
const SECRET_FILE = path.join(DATA_DIR, "session.secret");

// Load or generate a session secret that survives restarts.
let SESSION_SECRET = process.env.SESSION_SECRET;
if (!SESSION_SECRET) {
  try {
    SESSION_SECRET = fs.readFileSync(SECRET_FILE, "utf8").trim();
  } catch {
    SESSION_SECRET = crypto.randomBytes(48).toString("hex");
    fs.writeFileSync(SECRET_FILE, SESSION_SECRET, { mode: 0o600 });
    console.log("Generated new session secret at", SECRET_FILE);
  }
}

function readJSON(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

// Atomic write: tmp file + rename → no partial writes on crash.
function writeJSON(file, data) {
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

const DEFAULT_SETTINGS = {
  identity: {
    displayName: "guest",
    pronouns: "they/them",
    username: "guest",
    hostname: "tsoypos",
    osName: "tsoypOS",
    path: "/home/guest",
    bio: "this is your homepage. log in and replace this with your own.\ncustomize identity, theme, and content via the panel.",
    // Empty avatar by default — render falls back to hiding the broken-image
    // icon (handled by the `onerror` attribute on the avatar img). The new
    // admin sets their own URL via the customize drawer.
    avatar: "",
    prompt: "$",
  },
  projects: [
    { name: "example-project", desc: "describe a project here. add as many as you like.", url: "#", tag: "demo" },
  ],
  links: [
    { label: "github", url: "https://github.com" },
    { label: "email", url: "mailto:hi@example.com" },
    { label: "rss", url: "/feed.xml" },
    { label: "matrix", url: "#" },
  ],
  certifications: [
    {
      id: "sec-1",
      section: "Security",
      vendor: "CompTIA",
      short: "Security+",
      full: "CompTIA Security+",
      desc: "Foundational cybersecurity skills, threat analysis, and risk management.",
      inProgress: false,
    },
    {
      id: "sec-2",
      section: "Security",
      vendor: "Offensive Security",
      short: "OSCP",
      full: "Offensive Security Certified Professional",
      desc: "Hands-on penetration testing exam — exploit, pivot, and write the report.",
      inProgress: true,
    },
    {
      id: "ms-1",
      section: "Microsoft",
      vendor: "Microsoft",
      short: "AZ-104",
      full: "Microsoft Certified: Azure Administrator Associate",
      desc: "Identity, governance, storage, and compute administration in Azure.",
      inProgress: false,
    },
  ],
  // Explicit section ordering — overrides the implicit "first appearance" order.
  // Sections present in certifications but absent here are appended at the end
  // in the order they first appear, so adding a new section is non-breaking.
  certSectionOrder: ["Security", "Microsoft"],
  themeKey: "matrix",
  colors: {
    bg: "#050807",
    surface: "#0c1410",
    surfaceAlt: "#0f1d16",
    border: "#184a2e",
    text: "#c8ffd4",
    muted: "#5c9c73",
    accent: "#39ff7a",
    accent2: "#0fa958",
    danger: "#ff5577",
    chrome: "#0a1b12",
  },
  effects: { scanlines: true, glow: true, grain: false },
};

// Seed settings.json on first run.
if (!fs.existsSync(SETTINGS_FILE)) writeJSON(SETTINGS_FILE, DEFAULT_SETTINGS);
if (!fs.existsSync(GUESTBOOK_FILE)) writeJSON(GUESTBOOK_FILE, []);

/* ------------------------------------------------------------------ */
/*  App                                                                */
/* ------------------------------------------------------------------ */
const app = express();

// Trust proxies on loopback + private networks. This covers:
//   - cloudflared running on the same host (loopback)
//   - cloudflared running on another LAN box (private IPs)
//   - DSM reverse proxy in front of the container (loopback)
// With this set, req.ip reflects the real client IP, req.protocol honors
// X-Forwarded-Proto, and rate-limits key on real clients, not on the proxy.
app.set("trust proxy", ["loopback", "linklocal", "uniquelocal"]);

// ---- Security headers (helmet) --------------------------------------------
// `x-powered-by: Express` is disabled to avoid advertising the stack.
app.disable("x-powered-by");

// Content-Security-Policy tuned for the actual frontend:
//   - Google Fonts for the VT323 / JetBrains Mono pair loaded from index.html
//   - github.com is a common avatar source; extend this list if you use other hosts
//   - inline styles are permitted because the app writes theme vars and a few
//     minor inline styles; we do NOT allow inline scripts (the frontend has none)
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        "default-src": ["'self'"],
        "script-src": ["'self'"], // no inline scripts
        "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        "font-src": ["'self'", "https://fonts.gstatic.com", "data:"],
        "img-src": ["'self'", "https:", "data:"],
        "connect-src": ["'self'"],
        "frame-ancestors": ["'none'"], // clickjacking protection
        "base-uri": ["'self'"],
        "form-action": ["'self'"],
        "object-src": ["'none'"],
      },
    },
    // HSTS only makes sense over HTTPS — enable it when SECURE_COOKIE=true,
    // which is the same signal we already use for "I'm behind HTTPS".
    // 6 months, include subdomains, preload-ready. If you're not sure you want
    // this locked in, drop `preload: true` and `includeSubDomains: true`.
    strictTransportSecurity: SECURE_COOKIE
      ? { maxAge: 15552000, includeSubDomains: true, preload: true }
      : false,
    // Cross-Origin-Opener-Policy / Embedder-Policy defaults can break embedded
    // fonts or images in some setups — we explicitly relax them to the broadly
    // compatible settings while keeping the meaningful protections on.
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: "same-origin" },
    referrerPolicy: { policy: "strict-origin-when-cross-origin" },
  })
);

app.use(express.json({ limit: "1mb" }));

app.use(
  session({
    name: "hos.sid",
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: SECURE_COOKIE,
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    },
  })
);

/* ---------- simple in-memory rate limiter ---------- */
const rateBuckets = new Map();
function rateLimit({ key, max, windowMs }) {
  return (req, res, next) => {
    const k = key(req);
    const now = Date.now();
    let b = rateBuckets.get(k);
    if (!b || now > b.reset) b = { count: 0, reset: now + windowMs };
    b.count++;
    rateBuckets.set(k, b);
    if (b.count > max) {
      res.setHeader("Retry-After", Math.ceil((b.reset - now) / 1000));
      return res.status(429).json({ error: "rate limited" });
    }
    next();
  };
}
// Periodic cleanup so the map doesn't grow forever.
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of rateBuckets) if (now > v.reset) rateBuckets.delete(k);
}, 60_000).unref();

function requireAuth(req, res, next) {
  if (req.session && req.session.admin) return next();
  res.status(401).json({ error: "unauthorized" });
}

/* ------------------------------------------------------------------ */
/*  Routes                                                             */
/* ------------------------------------------------------------------ */
app.post(
  "/api/login",
  rateLimit({ key: (req) => "login:" + req.ip, max: 5, windowMs: 60_000 }),
  (req, res) => {
    const { password } = req.body || {};
    if (typeof password !== "string") {
      return res.status(400).json({ error: "password required" });
    }
    const a = Buffer.from(password);
    const b = Buffer.from(ADMIN_PASSWORD);
    const ok = a.length === b.length && crypto.timingSafeEqual(a, b);
    if (!ok) return res.status(401).json({ error: "invalid password" });

    req.session.regenerate((err) => {
      if (err) return res.status(500).json({ error: "session error" });
      req.session.admin = true;
      req.session.save(() => res.json({ ok: true }));
    });
  }
);

app.post("/api/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("hos.sid");
    res.json({ ok: true });
  });
});

app.get("/api/me", (req, res) => {
  res.json({ admin: !!(req.session && req.session.admin) });
});

// Version endpoint is now admin-only to avoid advertising the exact code
// revision to unauthenticated scanners. The logged-in admin still sees the
// version in the footer of the customize panel for self-service debugging.
app.get("/api/version", requireAuth, (req, res) => {
  res.json({ version: VERSION, started: STARTED_AT });
});

// Unauthenticated health check — intentionally returns minimal info. Used to
// verify the app is reachable through a proxy/tunnel without needing a
// session. Does NOT expose version, startup time, or config. The echoed
// request-observation fields are there so `curl /api/health` from the
// cloudflared host confirms proxy headers are arriving correctly.
app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    observedIp: req.ip,
    protocol: req.protocol,
    forwardedProto: req.get("x-forwarded-proto") || null,
  });
});

// PUBLIC settings endpoint.
//
// Pentest finding (Apr 2026) flagged the fields `path`, `hostname`, `osName`
// here as "leaking internal system info". Intentional non-fix: these are
// user-chosen display strings shown in the page UI (e.g. "tsoypOS ~ /home/guest"
// in the top bar). They're not real paths, real hostnames, or the real OS —
// they're cosmetic fields the admin types into the identity tab. The
// recommendation is noted and deliberately declined; anyone forking this app
// who replaces these with actual system values should move this endpoint
// behind auth or split it into public/private views.
app.get("/api/settings", (req, res) => {
  res.json(readJSON(SETTINGS_FILE, DEFAULT_SETTINGS));
});

app.put("/api/settings", requireAuth, (req, res) => {
  const incoming = req.body;
  if (!incoming || typeof incoming !== "object") {
    return res.status(400).json({ error: "invalid body" });
  }
  try {
    // Shallow-merge onto current so old fields aren't wiped by partial updates.
    const current = readJSON(SETTINGS_FILE, DEFAULT_SETTINGS);
    const merged = { ...current, ...incoming };
    writeJSON(SETTINGS_FILE, merged);
    res.json(merged);
  } catch (err) {
    // Most likely cause: the data directory isn't writable by the container.
    console.error("settings save failed:", err);
    res.status(500).json({
      error: `write failed: ${err.code || err.message}. check that ${DATA_DIR} is writable by the container.`,
    });
  }
});

app.get("/api/guestbook", (req, res) => {
  res.json(readJSON(GUESTBOOK_FILE, []));
});

/**
 * Anti-bot token system for guestbook posts.
 *
 * Real-user flow:
 *   1. Browser GETs /api/guestbook/token when the guestbook section renders.
 *   2. Server returns an HMAC-signed token containing the issue time and IP.
 *   3. User types their message (takes seconds-to-minutes).
 *   4. Browser POSTs /api/guestbook with the token in the body.
 *   5. Server verifies signature, issue-age window, IP match, and one-time use.
 *
 * Bot mitigation:
 *   - Naive curl bots that just POST directly: rejected (no token).
 *   - Bots that scrape one token then spam: rejected after first use (single-use).
 *   - Bots that fetch + submit instantly: rejected (min 3s submit time).
 *   - Bots that fetch tokens en masse and submit later: rejected (max 2hr age).
 *   - Bots that swap IPs between fetch and submit: rejected (IP-bound token).
 *   - Bots that solve all of the above: probably also defeat reCAPTCHA;
 *     that's the level we're not pretending to defend against without Turnstile.
 *
 * No persistence: tokens are stateless (HMAC-signed) and one-time use is
 * tracked in an in-memory Set bounded by TTL. Surviving restarts isn't worth
 * the complexity for a personal guestbook.
 */
const usedTokens = new Set();
const TOKEN_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours
const TOKEN_MIN_AGE_MS = 3 * 1000;       // can't submit faster than 3s after fetch

// Periodic cleanup of expired token markers.
setInterval(() => {
  const now = Date.now();
  for (const t of usedTokens) {
    // token format: "<issuedAt>.<ipHash>.<sig>" — first segment is the timestamp
    const issued = parseInt(t.split(".")[0], 10);
    if (Number.isFinite(issued) && now - issued > TOKEN_TTL_MS) usedTokens.delete(t);
  }
}, 60 * 1000).unref();

function hashIp(ip) {
  return crypto.createHash("sha256").update(ip).digest("hex").slice(0, 12);
}

function signToken(issuedAt, ipHash) {
  const body = `${issuedAt}.${ipHash}`;
  const sig = crypto
    .createHmac("sha256", SESSION_SECRET)
    .update(body)
    .digest("base64url")
    .slice(0, 22);
  return `${body}.${sig}`;
}

function verifyToken(token, ip) {
  if (typeof token !== "string") return { ok: false, reason: "missing" };
  const parts = token.split(".");
  if (parts.length !== 3) return { ok: false, reason: "malformed" };
  const [issuedStr, ipHash, sig] = parts;
  const issued = parseInt(issuedStr, 10);
  if (!Number.isFinite(issued)) return { ok: false, reason: "malformed" };
  // Recompute the expected signature and compare in constant time.
  const expected = signToken(issued, ipHash);
  const a = Buffer.from(token);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, reason: "signature" };
  }
  const age = Date.now() - issued;
  if (age < TOKEN_MIN_AGE_MS) return { ok: false, reason: "too_fast" };
  if (age > TOKEN_TTL_MS) return { ok: false, reason: "expired" };
  if (ipHash !== hashIp(ip)) return { ok: false, reason: "ip_mismatch" };
  if (usedTokens.has(token)) return { ok: false, reason: "reused" };
  return { ok: true };
}

app.get("/api/guestbook/token", (req, res) => {
  const issuedAt = Date.now();
  const ipHash = hashIp(req.ip);
  res.json({ token: signToken(issuedAt, ipHash) });
});

app.post(
  "/api/guestbook",
  rateLimit({ key: (req) => "gb:" + req.ip, max: 3, windowMs: 60_000 }),
  (req, res) => {
    const { name, msg, token, hp } = req.body || {};

    // Logged-in admin bypasses anti-bot checks. They can post freely from
    // their own site without dealing with token rotation or timing.
    const isAdmin = !!(req.session && req.session.admin);

    if (!isAdmin) {
      // Honeypot: a hidden field named "hp" (for "homepage") that real users
      // never see. Bots that fill every form field will populate it.
      if (typeof hp === "string" && hp.trim() !== "") {
        // Generic error so a bot author can't tell from the response that
        // their honeypot fill triggered the rejection.
        return res.status(400).json({ error: "invalid" });
      }
      // Token check: must have been issued for this IP and used exactly once
      // within the valid age window.
      const v = verifyToken(token, req.ip);
      if (!v.ok) {
        const userFacing = {
          missing: "missing token — refresh the page and try again",
          malformed: "invalid token — refresh the page and try again",
          signature: "invalid token — refresh the page and try again",
          too_fast: "slow down — read before you write",
          expired: "token expired — refresh the page and try again",
          ip_mismatch: "network changed — refresh the page and try again",
          reused: "token already used — refresh the page and try again",
        };
        return res.status(400).json({ error: userFacing[v.reason] || "invalid token" });
      }
      // Burn the token so it can't be replayed within the TTL.
      usedTokens.add(token);
    }

    if (
      typeof name !== "string" ||
      typeof msg !== "string" ||
      !name.trim() ||
      !msg.trim() ||
      name.length > 40 ||
      msg.length > 400
    ) {
      return res.status(400).json({ error: "invalid" });
    }
    // Defence-in-depth sanitization: strip ALL HTML tags and attributes.
    // The frontend renders these via textContent so XSS isn't exploitable
    // today, but future code paths (email notifications, an admin view that
    // uses innerHTML, RSS feeds, whatever) would inherit stored XSS unless we
    // sanitize at ingress. After stripping, decode HTML entities so users
    // see "&" rendered as "&" instead of "&amp;" (the frontend's textContent
    // would otherwise literal-print "&amp;").
    const stripAndDecode = (s) => {
      const stripped = sanitizeHtml(s, {
        allowedTags: [],
        allowedAttributes: {},
        disallowedTagsMode: "discard",
      });
      return stripped
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");
    };
    const cleanName = stripAndDecode(name.trim()).slice(0, 40);
    const cleanMsg = stripAndDecode(msg.trim()).slice(0, 400);
    // If the entire input was tags (e.g. "<script>"), it reduces to empty —
    // reject rather than save an empty entry.
    if (!cleanName || !cleanMsg) {
      return res.status(400).json({ error: "invalid" });
    }
    const entries = readJSON(GUESTBOOK_FILE, []);
    const entry = {
      id: crypto.randomUUID(),
      name: cleanName,
      msg: cleanMsg,
      ts: new Date().toISOString(),
    };
    entries.unshift(entry);
    if (entries.length > 500) entries.length = 500; // cap
    writeJSON(GUESTBOOK_FILE, entries);
    res.json(entry);
  }
);

app.delete("/api/guestbook/:id", requireAuth, (req, res) => {
  const entries = readJSON(GUESTBOOK_FILE, []);
  const next = entries.filter((e) => e.id !== req.params.id);
  writeJSON(GUESTBOOK_FILE, next);
  res.json({ ok: true });
});

/* ---------- static frontend ---------- */
// Browser cache is OFF — etag still lets the browser get fast 304s when
// nothing changed, but ensures new builds are picked up on refresh without
// having to explain "now hard-reload with Ctrl+Shift+R" to every future user.
app.use(
  express.static(path.join(__dirname, "public"), {
    maxAge: 0,
    etag: true,
    lastModified: true,
  })
);

// SPA fallback (in case you add client-side routing later)
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

const server = app.listen(PORT, () => {
  console.log(`tsoypOS v${VERSION} listening on :${PORT}`);
  console.log(`  NODE_ENV       = ${process.env.NODE_ENV || "dev"}`);
  console.log(`  COOKIE_SECURE  = ${SECURE_COOKIE}  ${SECURE_COOKIE ? "(cookie requires HTTPS)" : "(cookie works on HTTP and HTTPS)"}`);
  console.log(`  Data dir       = ${DATA_DIR}`);
  console.log(`  Started at     = ${STARTED_AT}`);
});

// Tune keep-alive timeouts for life behind a proxy (Cloudflare Tunnel, nginx,
// Caddy, etc.). Node's defaults (5s keepAliveTimeout) are shorter than most
// proxies' idle timeouts, which produces intermittent 502s when the proxy
// tries to reuse a socket Node already closed. headersTimeout must be
// strictly greater than keepAliveTimeout or Node throws on startup.
server.keepAliveTimeout = 65_000;  // 65s — longer than typical 60s proxy idle
server.headersTimeout   = 66_000;
