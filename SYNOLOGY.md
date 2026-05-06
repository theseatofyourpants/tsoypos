# Installing tsoypOS on Synology (Container Manager)

Tested on DSM 7.2 / Container Manager. Should work identically on the older "Docker" package with slight UI differences.

## Prerequisites

- DSM 7 with **Container Manager** installed
- A DSM admin account
- ~200 MB of free space on a volume

SSH is optional but handy. Everything below can be done without SSH.

---

## 1. Upload the project files

1. Open **File Station**.
2. Create `/docker/tsoypos/` on your main volume (create `/docker/` first if it doesn't exist).
3. Inside `tsoypos/`, create a subfolder called `data`.
4. Extract `tsoypos.tar.gz` and drag **the contents** (not the outer `tsoypos/` folder) into `/docker/tsoypos/`.

Final layout:

```
/volume1/docker/tsoypos/
├── Dockerfile
├── docker-compose.yml
├── package.json
├── package-lock.json
├── server.js
├── public/
│   ├── index.html
│   ├── styles.css
│   └── app.js
├── data/          (empty — gets populated on first run)
├── README.md
├── .env.example
└── .gitignore
```

> **Enable hidden files in File Station**: Settings → General → Show hidden files, otherwise you won't see `.env.example`.

---

## 2. Create the `.env` file

1. In File Station, right-click `.env.example` → Copy → paste back → rename copy to `.env`.
2. Right-click `.env` → Open with Text Editor.
3. Set:

```env
ADMIN_PASSWORD=some-long-random-string-you-actually-remember
```

**If you plan to access the site over HTTPS** (Cloudflare Tunnel, DSM reverse proxy with TLS), also add:

```env
COOKIE_SECURE=true
```

If you're only hitting it over plain HTTP on your LAN (`http://<nas-ip>:3000`), **leave `COOKIE_SECURE` commented out**. Setting it to true over HTTP will cause the browser to silently drop the login cookie, making every save fail with "session expired" errors.

Save and close. Lock it down: right-click `.env` → Properties → Permission → remove read access for `users` and `guests`.

---

## 3. Create the Project in Container Manager

1. Container Manager → sidebar → **Project** → **Create**.
2. Project name: `tsoypos`. Path: `/docker/tsoypos`. Source: **Use existing docker-compose.yml**.
3. Next → Next → Done. First build takes 1–2 minutes.

---

## 4. Verify the new code is running

This step matters — the easiest way to get stuck is assuming a rebuild happened when it didn't.

1. Container Manager → Container tab → click `tsoypos` → **Log** tab. You should see:

```
tsoypOS v1.0.0 listening on :3000
  NODE_ENV       = production
  COOKIE_SECURE  = false  (cookie works on HTTP and HTTPS)
  Data dir       = /app/data
  Started at     = 2026-04-24T03:37:12.163Z
```

2. Open `http://<nas-ip>:3000`. The footer of the page should show something like `app.js v1.0.0 · server v1.0.0`. That confirms both the client and server are on the new build.
3. Open browser DevTools → Console. You should see a green `tsoypOS` banner with the version and startup time.

If the footer shows wrong versions (or no version at all), see the Troubleshooting section.

---

## 5. Log in as admin

1. Top-right → **● login** (or `Ctrl/Cmd + K`).
2. Enter the `ADMIN_PASSWORD` from `.env`.
3. The button becomes **◆ customize** and the drawer opens. The drawer footer shows a live save indicator: `● saved` / `● saving…` / `● save failed` in real time.

---

## 6. (Optional) Expose it publicly

For a Cloudflare Tunnel setup (recommended — no open ports, free TLS at the edge), see the **"Cloudflare Tunnel"** example in the main [README](./README.md#cloudflare-tunnel-example-making-it-externally-viewable-with-no-open-ports). The procedure is the same regardless of whether `cloudflared` runs as a DSM package, in another container on the NAS, or on a separate host — the only thing that changes is what address you put in the `service:` line.

### DSM Reverse Proxy + Let's Encrypt (alternative)

If you'd rather use DSM's built-in reverse proxy with a Let's Encrypt cert:

1. Get a cert in Control Panel → Security → Certificate.
2. Login Portal → Advanced → Reverse Proxy → Create.
3. Source: HTTPS, your hostname, port 443.
4. Destination: HTTP, localhost, port 3000.
5. Custom header tab → enable WebSocket.
6. Set `COOKIE_SECURE=true` in `.env` → restart the container.

---

## 7. Updating the code

`docker-compose.yml` bind-mounts `server.js` and `public/` from the host into the container. That means **you don't need to rebuild the image** for normal updates — edit the files on the NAS and restart the container.

**Workflow:**

1. Drag new files into `/docker/tsoypos/` via File Station (overwriting existing).
2. Container Manager → Container tab → `tsoypos` → **Action** → **Restart**.
   - For changes to `public/*` only, skip the restart and just hard-reload the browser (`Ctrl+Shift+R`).
3. Verify the footer shows the new version numbers.

**When you do need to rebuild the image** (only for `Dockerfile` or `package.json` changes): Container Manager → Project → `tsoypos` → **Build**.

---

## 8. Backups

Back up `/docker/tsoypos/data/` with Hyper Backup. Three files:

- `settings.json` — all site config
- `guestbook.json` — posts
- `session.secret` — delete to force all logged-in sessions to re-authenticate

---

## Troubleshooting

### "I updated the files but nothing changed"

You're running old code — either the container didn't restart or the browser cached `app.js`.

**Check the footer** — it shows `app.js vX.X.X · server vX.X.X`. If either is wrong:

- **Server wrong**: Container Manager → Container → tsoypos → Action → Restart. Check the log — you should see the new version in the startup banner.
- **Client wrong**: hard-refresh (`Ctrl+Shift+R` / `Cmd+Shift+R`). If that doesn't work, DevTools → Network → check "Disable cache" → reload.

Still wrong? Check the bind mounts actually exist. In Container Manager → Container → tsoypos → Details → Volume tab, you should see three mounts: `./data`, `./server.js`, and `./public`. If only `./data` is there, your `docker-compose.yml` wasn't updated — re-upload it, then Container Manager → Project → tsoypos → **Build** to pick up the new compose file.

### "Login works but every save fails with 'session expired' or 'save failed'"

You've got `COOKIE_SECURE=true` while accessing the site over plain HTTP. The browser silently discards the cookie because it has the `Secure` flag but the connection isn't HTTPS.

**Fix**: edit `.env`, comment out or remove the `COOKIE_SECURE=true` line, restart the container. Verify the startup log now says `COOKIE_SECURE = false (cookie works on HTTP and HTTPS)`.

If you're using Cloudflare Tunnel or a reverse proxy and should be on HTTPS, check the URL bar — is it really `https://`? If your reverse proxy isn't forwarding `X-Forwarded-Proto`, the server can't tell. DSM reverse proxy and Cloudflare Tunnel both set this correctly by default.

### Container exits with `FATAL: cannot write to DATA_DIR`

The bind-mounted `data/` folder isn't writable by the container. Via SSH:

```bash
sudo chmod -R 777 /volume1/docker/tsoypos/data
```

Or in File Station: right-click `data/` → Properties → Permission → Add → Everyone → Read/Write/Delete → Apply to this folder, sub-folders, and files. Restart the container.

### Login returns "invalid password" even with the right password

Your `.env` either isn't being read or has the wrong filename:

- Is it named exactly `.env`? File Station sometimes appends `.txt` if Show Hidden Files isn't enabled.
- Is it in `/docker/tsoypos/` next to `docker-compose.yml`?
- Does the `ADMIN_PASSWORD=...` line have no quotes and no trailing spaces?

### Getting a 502 Bad Gateway from Cloudflare Tunnel

502 means `cloudflared` couldn't reach the container or didn't get a valid HTTP response. Work through this in order:

**Step 1 — confirm the container itself is healthy.** From your LAN (phone, laptop, anything on the same network as the NAS), hit:

```
http://<nas-ip>:3000/api/health
```

You should get JSON back with `"ok": true` and the server version. If this fails, the problem isn't Cloudflare — it's the container (check its log in Container Manager).

**Step 2 — check the Cloudflare Tunnel service URL.** This is the #1 cause of 502. In the Cloudflare Zero Trust dashboard → Access → Tunnels → your tunnel → Public Hostname for tsoypos.yourdomain.com:

- **Type** must be `HTTP` (not HTTPS). The container serves plain HTTP internally; TLS is Cloudflare's job at the edge.
- **URL** should be `<host>:3000` where `<host>` depends on where `cloudflared` runs — see step 3.

**Step 3 — check what address `cloudflared` should use.**

- **cloudflared is a DSM package / runs as a host service on the NAS**: use `localhost:3000` or `127.0.0.1:3000`.
- **cloudflared runs in its own Docker container on the NAS**: `localhost` points at the cloudflared container itself, not the host. Use the NAS LAN IP (`192.168.x.x:3000`), or put cloudflared and tsoypos on the same Docker network and use `tsoypos:3000`.
- **cloudflared runs on a different machine on your LAN**: use the NAS LAN IP (`192.168.x.x:3000`).

**Step 4 — hit /api/health through the tunnel.** Once you think you've got the right URL:

```
https://tsoypos.yourdomain.com/api/health
```

If this works, the tunnel is wired correctly. If this 502s but the direct LAN hit worked, the tunnel service URL is still wrong.

**Step 5 — disable Container Manager's "Web Portal" for the project.** If you enabled it during project creation, DSM inserts its own reverse proxy in front of the container which breaks tunnel access. In Container Manager → Project → tsoypos → Settings, make sure Web Portal is off.

**Step 6 — check the cloudflared log.** It says exactly why the connection failed:
- `dial tcp: connection refused` → wrong port or container isn't running
- `no route to host` / `i/o timeout` → cloudflared can't reach the NAS IP (firewall, wrong interface, VLAN issue)
- `tls: ...` errors → you set the service type to HTTPS instead of HTTP (step 2)
- `unexpected EOF` / `upstream closed` → keep-alive mismatch, but the app is tuned for this so it shouldn't hit you

**Step 7 — once 502s are resolved, don't forget to set `COOKIE_SECURE=true`** in `.env` since you're now serving over HTTPS through the tunnel, and restart the container. Otherwise login will work but won't persist to subsequent requests over HTTPS.

### "I forgot my admin password"

Edit `.env`, change `ADMIN_PASSWORD`, restart. No password reset flow — you own the box.
