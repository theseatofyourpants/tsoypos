# Security Notes

Current hardening in tsoypOS, written so you know what's defended and what's still your job.

## What the app does

**Transport**

- The server itself runs plain HTTP on port 3000. TLS termination is delegated to whatever reverse proxy or tunnel sits in front (Cloudflare Tunnel, DSM reverse proxy, Caddy, nginx, etc.).
- When `COOKIE_SECURE=true` is set (i.e. you're behind HTTPS), Strict-Transport-Security is emitted with a 6-month max-age, `includeSubDomains`, and `preload`. If you don't want a preload-grade commitment, soften the header in `server.js`.
- `X-Forwarded-Proto` is honored from private/loopback proxies only (via the `trust proxy` whitelist), so public clients can't spoof it.

**HTTP security headers** (via `helmet`)

- **Content-Security-Policy**: `default-src 'self'`, scripts are `'self'` only (no inline or eval), styles permit Google Fonts and inline style attributes (the app writes theme CSS vars inline), images allow `https:` and `data:`, `frame-ancestors 'none'`, `object-src 'none'`, `form-action 'self'`, `upgrade-insecure-requests`.
- **X-Frame-Options**: `SAMEORIGIN` (redundant with CSP `frame-ancestors 'none'`, but harmless belt-and-braces).
- **X-Content-Type-Options**: `nosniff`.
- **Referrer-Policy**: `strict-origin-when-cross-origin`.
- **Cross-Origin-Resource-Policy**: `same-origin`.
- **X-Powered-By**: explicitly disabled — the stack is not advertised.

**Authentication**

- Single admin, password stored in plaintext in `.env` (intentional — you own the box, the file is chmod'd, and there's nothing to recover from). The password is compared with `crypto.timingSafeEqual` to avoid length-based timing leaks.
- Sessions are signed httpOnly cookies (`express-session`). `SameSite=Lax` by default. `Secure` flag is opt-in via `COOKIE_SECURE=true` — keep it on whenever you're behind HTTPS.
- Session secret is auto-generated on first boot, persisted to `data/session.secret` with `chmod 600`. Deleting this file invalidates all existing sessions.
- Login attempts are rate-limited to 5/min per IP. On correct password, the session ID is regenerated (prevents fixation).
- `/api/version` requires admin auth (was public, now isn't — removing version disclosure to anonymous scanners).

**Input handling**

- All `POST`/`PUT` bodies are JSON, capped at 1MB.
- Guestbook input is sanitized on ingress with `sanitize-html` (strip all tags and attributes) before being written to disk. Defence-in-depth — the frontend already renders via `textContent`, but any future consumer that uses `innerHTML`, templates into an email, or generates an RSS feed inherits the protection.
- After sanitization, entries that reduce to empty (pure-tag payloads like `<script></script>`) are rejected with 400.
- Guestbook posts rate-limited to 3/min per IP.
- Guestbook message max length: 400 chars. Name max: 40 chars. Total entries capped at 500 (old ones evicted).

**Anti-automation (guestbook)**

Layered defenses, all unobtrusive — no clickable CAPTCHA. In order of escalation:

1. **Honeypot field** — a hidden `<input>` named `homepage`, positioned off-screen via `position: absolute; left: -9999px;`. Real users never see or focus it. Naive bots that fill every form field will populate it; non-empty value → 400 reject.
2. **Submission token** — `GET /api/guestbook/token` issues an HMAC-signed token bound to the requester's IP and timestamp. The token is required on `POST /api/guestbook`. Tokens are:
   - **Signed** with the session secret using HMAC-SHA256, verified in constant time. Forgery requires the secret.
   - **IP-bound** — token issued for one IP cannot be used from another. (Defeats credential-stuffing-style attacks where bots fetch from one IP and submit from a botnet.)
   - **Single-use** — tokens are added to an in-memory used-set on first acceptance. Replays return 400.
   - **Bounded** — minimum 3 seconds between fetch and submit (no human reads + types that fast); maximum 2 hours (no stale tokens from a script that pre-fetched a batch).
3. **Rate limit** — already present from earlier hardening; 3/min per IP regardless of token validity.
4. **Admin bypass** — logged-in admin posts skip token + honeypot checks. (You shouldn't have to anti-bot yourself on your own site.)

The token endpoint is itself rate-limit-friendly: it's stateless on issue (no DB write), and the in-memory used-set is bounded by the 2-hour TTL with periodic cleanup. A bot trying to exhaust it would have to fire ~2M requests/hour just to keep up with normal cleanup — and they'd hit rate limits long before that.

What this layered defense does NOT defend against: a determined attacker who runs a real browser, fetches the page, waits an appropriate time, and submits one entry. For that level of threat, drop in [Cloudflare Turnstile](https://www.cloudflare.com/products/turnstile/) — it's free, invisible to most users, and integrates as a single sitekey config. The current design already establishes the pattern (token-on-issue, verify-on-submit) that a Turnstile token would slot into.

**Output handling**

- The frontend **never** uses `innerHTML` for user-generated content. All rendering of settings, projects, links, and guestbook entries goes through `textContent` or safe attribute setters in the `el()` DOM factory. This is the primary XSS defence.
- Static assets are served with `Cache-Control: max-age=0` + ETag so new builds are picked up on refresh without stale-cache mysteries.

**File storage**

- Atomic writes (tmp file + rename) to prevent partial JSON on crash.
- `data/` is a separate volume; the container's image is immutable.
- Proactive startup probe fails loudly if `data/` isn't writable.

## What is *not* defended against

This is a single-user personal homepage. Some things are deliberately out of scope:

- **Password recovery**: none. Edit `.env` and restart. Keep a copy in your password manager.
- **Multi-user / RBAC**: no. Single admin, by design.
- **Brute-force over many IPs**: the rate limiter keys on IP. A botnet can spread attempts. Use a long, random password.
- **CSRF**: login is the only state-changing endpoint anonymous users can hit, and it's rate-limited. Authenticated endpoints (`PUT /api/settings`, `DELETE /api/guestbook/:id`) would be vulnerable to CSRF if you were logged in and visited a malicious page. If you're exposing this publicly with a strong admin password, consider adding a CSRF token or double-submit cookie. For a personal site visited from known devices, I've left this off as the blast radius is "change your own site's theme".
- **Log tampering / SIEM integration**: logs go to stdout. Use your Docker/systemd log collection if you want retention.
- **Application-level DDoS**: the rate limiter is coarse. Cloudflare WAF in front is the real answer and you already have it.

## Deployment checklist

- [ ] `ADMIN_PASSWORD` is 12+ random characters
- [ ] `.env` file permissions are restricted (not world-readable)
- [ ] `COOKIE_SECURE=true` is set when accessed over HTTPS, commented out when accessed over LAN HTTP
- [ ] `data/` is backed up (Hyper Backup, restic, whatever)
- [ ] Cloudflare "Always Use HTTPS" is ON for the public hostname (dashboard → SSL/TLS → Edge Certificates)
- [ ] You've hit `https://<your-site>/api/health` and confirmed it returns `{"ok":true,...,"protocol":"https"}` — confirms proxy headers land correctly

## Reporting

Found something? There's nobody to report to — it's your box. The standard answers apply: apply the fix locally, bump the version in `server.js`, restart.
