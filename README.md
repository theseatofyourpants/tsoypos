# tsoypOS

A retro terminal-themed personal homepage with a built-in admin panel for live customization. Self-hosted, single-user, single Docker container. No build step on the frontend, no native dependencies on the backend, no database.

Inspired by [hedge.edgeofhedge.com](https://hedge.edgeofhedge.com).

## Features

- **Public site** with a bookmarks-style nav (Home / Projects / Certifications / Links), a profile card, an interactive shell-like terminal, and a guestbook.
- **Admin login** gated by a single password set via env var. Only the admin sees the customize panel.
- **Live customize drawer** with four tabs:
  - **Theme** — six built-in presets (Matrix, Amber CRT, Synthwave, Dracula, Cyberpunk, Paperwhite) plus per-slot color pickers for full custom palettes.
  - **Identity** — OS name, display name, pronouns, username, hostname, path, prompt character, avatar URL, bio.
  - **Content** — add, edit, reorder, and delete projects, links, and certifications. Certifications support sections, in-progress vs. earned status, and within-section ordering.
  - **FX** — CRT scanlines, text glow, and film grain toggles.
- **Auto-save** — every change debounces and persists to `data/settings.json`.
- **Guestbook** with public posting (rate-limited and bot-protected via signed token + honeypot + timing checks) and admin-only delete.
- **Session auth** via signed httpOnly cookie. No third-party auth integration to wire up.
- **Working terminal** with command history, theme switching, navigation, and a few easter eggs.

## Stack

- **Backend**: Node.js 20+, Express, `express-session`, `helmet`, `sanitize-html`. Four runtime dependencies, none of which require native compilation.
- **Frontend**: vanilla JS, vanilla CSS, vanilla HTML. No bundler, no transpiler, no framework. Loads in ~50ms on a cold cache.
- **Storage**: plain JSON files in `./data/`. No database to administer or back up separately.
- **Auth**: HMAC-signed session cookies. Single admin password, plaintext in env (intentional — see `SECURITY.md`).
- **Anti-bot**: hidden honeypot field, HMAC-signed submission tokens (IP-bound, single-use, time-windowed), per-IP rate limiting. No CAPTCHA, no third-party services.

## Quick start (Docker Compose, recommended)

```bash
git clone https://github.com/theseatofyourpants/tsoypos.git
cd tsoypos
cp .env.example .env
# Edit .env and set a strong ADMIN_PASSWORD
docker compose up -d
```

Visit `http://localhost:3000`. Click **● login** in the top-right (or press `Ctrl/Cmd+K`) and enter your password to unlock the customize panel.

State lives in `./data/` — back that one folder up and you've backed up everything.

## Quick start (plain Node, no Docker)

```bash
git clone https://github.com/theseatofyourpants/tsoypos.git
cd tsoypos
npm install
ADMIN_PASSWORD='your-strong-password' node server.js
```

Node 20 or later is required. Visit `http://localhost:3000`.

## Configuration

All configuration is via environment variables (see `.env.example`):

| Variable          | Required | Description                                                                                                |
|-------------------|----------|------------------------------------------------------------------------------------------------------------|
| `ADMIN_PASSWORD`  | yes      | Plaintext admin password. 12+ random chars recommended.                                                    |
| `COOKIE_SECURE`   | no       | Set to `"true"` only if behind HTTPS. Leaving it false works for direct LAN HTTP access.                   |
| `SESSION_SECRET`  | no       | If unset, a random one is generated and persisted to `data/session.secret` on first run.                   |
| `PORT`            | no       | Defaults to `3000`.                                                                                        |
| `NODE_ENV`        | no       | Set to `"production"` in production. Affects logging and a few defaults.                                   |
| `DATA_DIR`        | no       | Override the data directory. Defaults to `./data`.                                                         |

## API

| Method  | Path                       | Auth   | Purpose                                |
|---------|----------------------------|--------|----------------------------------------|
| GET     | `/api/settings`            | public | Fetch site config                      |
| PUT     | `/api/settings`            | admin  | Update site config                     |
| GET     | `/api/guestbook`           | public | List entries                           |
| GET     | `/api/guestbook/token`     | public | Get an anti-bot token (one-time use)   |
| POST    | `/api/guestbook`           | public | Add entry (rate-limited, token-gated)  |
| DELETE  | `/api/guestbook/:id`       | admin  | Delete entry                           |
| POST    | `/api/login`               | public | Password login (5/min/IP rate limit)   |
| POST    | `/api/logout`              | public | Clear session                          |
| GET     | `/api/me`                  | public | `{ admin: bool }`                      |
| GET     | `/api/health`              | public | Liveness check                         |
| GET     | `/api/version`             | admin  | Version + start time (admin-only)      |

## Storage

Plain JSON files in `./data/`:

- `settings.json` — the entire site config (identity, projects, links, certifications, theme, effects, section ordering).
- `guestbook.json` — list of guestbook messages, capped at 500 entries (oldest evicted).
- `session.secret` — auto-generated on first run, `chmod 600`. Delete this file to invalidate every active session.

Back up `./data/` with any tool you like — restic, borg, rsync, plain `cp`, your NAS's snapshot system, anything.

## Terminal commands

The terminal at the bottom of the page accepts:

`help`, `whoami`, `about`, `ls`, `cd <view>`, `projects`, `certs`, `links`, `neofetch`, `theme <name>` (admin only), `date`, `echo <text>`, `login`, `logout`, `clear`.

Arrow keys navigate command history. `Ctrl/Cmd+K` opens the login modal (or toggles the customize panel when signed in).

## Security model

The threat model is documented in detail in [SECURITY.md](./SECURITY.md). Quick summary:

- **What's defended**: XSS (input sanitized on ingress, output rendered via `textContent`), CSRF for the login endpoint (rate-limited), session fixation (regen on login), automated guestbook spam (honeypot + signed tokens + rate limits), full security-headers suite via helmet (CSP, HSTS, X-Frame-Options, etc.).
- **What's deliberately out of scope**: multi-user, password recovery, RBAC, CSRF on already-authenticated endpoints. This is a single-admin personal homepage, not a CMS.

## Deployment recipes

### Behind a reverse proxy

The server has `app.set("trust proxy", ["loopback", "linklocal", "uniquelocal"])`, so it honors `X-Forwarded-*` from any local-network proxy. Bind it to `127.0.0.1:3000` and front it with whatever you have.

**Caddy** (gets you a real cert via Let's Encrypt automatically):

```caddy
tsoypos.example.com {
  reverse_proxy 127.0.0.1:3000
}
```

**nginx**:

```nginx
server {
  listen 443 ssl http2;
  server_name tsoypos.example.com;
  ssl_certificate     /etc/letsencrypt/live/tsoypos.example.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/tsoypos.example.com/privkey.pem;

  location / {
    proxy_pass         http://127.0.0.1:3000;
    proxy_set_header   Host              $host;
    proxy_set_header   X-Real-IP         $remote_addr;
    proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header   X-Forwarded-Proto $scheme;
  }
}
```

When using either of these, set `COOKIE_SECURE=true` in `.env` so the session cookie gets the `Secure` flag.

### systemd (no Docker)

```ini
# /etc/systemd/system/tsoypos.service
[Unit]
Description=tsoypOS
After=network.target

[Service]
WorkingDirectory=/opt/tsoypos
Environment=NODE_ENV=production
Environment=ADMIN_PASSWORD=your-strong-password
Environment=COOKIE_SECURE=true
ExecStart=/usr/bin/node server.js
Restart=on-failure
User=tsoypos

[Install]
WantedBy=multi-user.target
```

### Synology DSM / Container Manager

A detailed walkthrough lives in [SYNOLOGY.md](./SYNOLOGY.md), including how to integrate with Cloudflare Tunnel, the DSM reverse proxy, and Hyper Backup.

### Cloudflare Tunnel (example: making it externally viewable with no open ports)

This is one way to publish your site to the public internet without exposing any inbound ports on your router. It's free for personal use and gives you a TLS cert at the edge.

#### 1. Install `cloudflared`

Install [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/) on whatever host has network access to wherever tsoypOS is running. This can be the same host or any other machine on your LAN.

#### 2. Authenticate and create a tunnel

```bash
cloudflared tunnel login
cloudflared tunnel create tsoypos
```

The first command opens your browser to authorize against your Cloudflare account. The second prints a tunnel UUID — save it.

#### 3. Point a DNS record at the tunnel

```bash
cloudflared tunnel route dns tsoypos tsoypos.example.com
```

Replace `tsoypos.example.com` with the hostname you want to publish under. The domain must already be on Cloudflare.

#### 4. Configure the tunnel

Create `~/.cloudflared/config.yml`:

```yaml
tunnel: <tunnel-uuid-from-step-2>
credentials-file: /root/.cloudflared/<tunnel-uuid>.json

ingress:
  - hostname: tsoypos.example.com
    service: http://localhost:3000
  # Catch-all required at the bottom
  - service: http_status:404
```

If `cloudflared` runs on a different machine from tsoypOS, replace `localhost` with the LAN IP of the tsoypOS host. If both run on the same Docker host but in separate containers, use the host's LAN IP — `localhost` inside the cloudflared container points at *that container*, not the host.

> **Important**: the service URL must be `http://`, not `https://`. tsoypOS serves plain HTTP internally; Cloudflare handles TLS termination at the edge. Picking HTTPS in the dashboard is the most common cause of `502 Bad Gateway`.

#### 5. Run the tunnel

```bash
cloudflared tunnel run tsoypos
```

Or install it as a service:

```bash
sudo cloudflared service install
```

Visit `https://tsoypos.example.com`. You should see your site, served through Cloudflare's network with a valid TLS cert and no open ports on your router.

#### 6. Update `.env`

Once the tunnel is live, set `COOKIE_SECURE=true` in `.env` and restart the container — your traffic is now HTTPS, so the session cookie should require it.

#### 7. (Optional) Enable "Always Use HTTPS"

In the Cloudflare dashboard → SSL/TLS → Edge Certificates → toggle on "Always Use HTTPS". This redirects any plain-HTTP visitors at the edge.

## Customizing for your own deployment

Out of the box the site has neutral placeholder defaults (`guest@tsoypos:~$`). After your first login, the customize drawer lets you change everything — display name, OS name, hostname, prompt, bio, avatar, theme, projects, certifications, links, FX. None of those changes require a redeploy.

If you want to change the *project name* itself (e.g. you're forking and want to call it something else), search-and-replace `tsoypos` and `tsoypOS` across the source. The grep target is small:

```bash
grep -rln -E "tsoypos|tsoypOS" . --include="*.js" --include="*.json" --include="*.md" --include="*.html" --include="*.yml" --include="Dockerfile"
```

## Acknowledgements
This project was developed in collaboration with Claude (Anthropic). The architecture, security model, and deployment decisions are mine; Claude assisted with code generation, which I reviewed, tested, and iterated on. The project includes a documented threat model in SECURITY.md and was pentested before public release.

## Contributing

Issues and pull requests welcome. The codebase is small enough (~1500 LOC) that you can read it end-to-end in an hour. Conventions:

- Vanilla JS only, no framework or build step.
- Comments explain the **why**, not the what — assume the reader can read code.
- New features should default-off or default-safe so existing deployments don't break on upgrade.
- Keep `package.json` dependencies minimal; new deps need justification.

## License

[MIT](./LICENSE).
