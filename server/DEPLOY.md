# Deploying Orbit to orbit.danycrafts.com

Orbit is served by a single dependency-free Node process that both serves the built app and
stores its data as JSON files. Cloudflare Tunnel gets traffic to it and Cloudflare Access keeps
everyone else out. No nginx, no port forwarding.

```
browser → Cloudflare edge (Access login) → tunnel → node :3001 → /var/lib/orbit/*.json
```

## What you need

- Node 18+ on the server (`node -v`)
- `cloudflared` already running for your other tunnels
- Root (or sudo) on the Dell, and access to the Cloudflare dashboard

## 1. Point the app at the API and build it

On your **dev machine**:

```bash
cd ~/orbit          # wherever the repo lives
npm run build       # produces dist/
```

`vite.config.js` proxies `/api` to `localhost:3001` in dev, so `npm run dev` now needs
`npm run server` running in a second terminal. That is deliberate: a silent fallback to
browser storage during development is how a broken storage layer ships unnoticed.

## 2. Create the user and data directory

On the **server**:

```bash
sudo useradd --system --no-create-home --shell /usr/sbin/nologin orbit
sudo mkdir -p /opt/orbit /var/lib/orbit/backups
sudo chown -R orbit:orbit /var/lib/orbit
```

## 3. Copy the app

From your dev machine:

```bash
rsync -av --delete dist/ server/ dell:/tmp/orbit-upload/
```

Then on the server:

```bash
sudo rm -rf /opt/orbit/dist /opt/orbit/server
sudo mv /tmp/orbit-upload/dist /tmp/orbit-upload/server /opt/orbit/
sudo chown -R root:root /opt/orbit
sudo chmod -R a+rX /opt/orbit          # the service reads it as the orbit user
```

## 4. Run it

```bash
sudo cp /opt/orbit/server/orbit.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now orbit
systemctl status orbit
journalctl -u orbit -f                 # watch it come up
```

You should see the listening banner. Check it locally before the tunnel:

```bash
curl -s localhost:3001/api/storage/orbit:entries   # 404 {"error":"not found"} on a fresh install
curl -sI localhost:3001/ | head -1                 # HTTP/1.1 200 OK
```

## 5. Cloudflare Tunnel

Add to your tunnel config (`/etc/cloudflared/config.yml`), **above** the catch-all rule:

```yaml
ingress:
  - hostname: orbit.danycrafts.com
    service: http://localhost:3001
  # ... your existing rules, and the http_status:404 catch-all must stay last
```

```bash
sudo systemctl restart cloudflared
```

No DNS record to create by hand, `cloudflared` registers the CNAME when it starts.

## 6. Lock it down: do this before you put any real data in it

**This is the step that matters.** Orbit holds notes about named people, who initiates, and how
you felt after seeing them. Without this, anyone who finds the hostname reads all of it.

Cloudflare dashboard → **Zero Trust → Access → Applications → Add an application → Self-hosted**:

- **Application name:** Orbit
- **Session duration:** 1 month (you'll be asked to log in again after that)
- **Public hostname:** `orbit.danycrafts.com`

Then add a policy:

- **Action:** Allow
- **Include:** `Emails` → your email address

Save. Open `orbit.danycrafts.com` in a private window, you should be stopped at a Cloudflare
login before you ever reach the app. If you see the app straight away, the policy isn't applied;
fix that before continuing.

Verify from **outside** Cloudflare's dashboard is not enough, actually fetch it:

```bash
curl -sI https://orbit.danycrafts.com/ | head -3     # expect a redirect to Cloudflare Access
```

## 7. Move your existing data across

No file copying needed, the app already has both halves of this.

1. Open the **old** app (whatever origin still has your data in localStorage).
2. Settings → **export backup (json)**. Keep that file somewhere safe; it's your rollback.
3. Open `orbit.danycrafts.com` and log in.
4. Settings → **import backup** → choose that file.
5. **Check the groups list looks right.** `importJSON` restores entries only; groups and activity
   types are written by a separate effect, so confirm them before trusting the restore.

Then confirm on the server:

```bash
sudo ls -l /var/lib/orbit/            # entries.json, config.json should exist
sudo head -20 /var/lib/orbit/entries.json   # pretty-printed, readable
```

## Backups

Two layers, already in place:

- **On every write**, the previous file is copied into `/var/lib/orbit/backups/` (last 20 kept).
  This is what saves you if a bad write ever replaces good data.
- **Off-server**, worth adding, a nightly copy somewhere that isn't the Dell:

  ```bash
  # /etc/cron.daily/orbit-backup
  #!/bin/sh
  rsync -a --delete /var/lib/orbit/ /srv/backups/orbit/
  ```

The app's own export button still works and is the easiest way to take a copy off the machine by
hand.

## Updating

```bash
# dev machine
npm run build
rsync -av --delete dist/ dell:/tmp/orbit-new/
# server
sudo rm -rf /opt/orbit/dist && sudo mv /tmp/orbit-new/dist /opt/orbit/
sudo systemctl restart orbit
```

The data directory is untouched by deploys.

## If something goes wrong

| Symptom | Check |
|---|---|
| 502 from Cloudflare | `systemctl status orbit`, then `journalctl -u orbit -n 50` |
| App loads but says it can't load data | `curl localhost:3001/api/storage/orbit:entries` on the server |
| Data looks wrong | `ls -t /var/lib/orbit/backups/`, copy the newest good one back over `entries.json` |
| `entries.json on disk is not valid JSON` | Restore from `backups/`; the server refuses to serve a corrupt file rather than silently reset it |
| Changes not saving | The app disables writes when the load fails, deliberately. Check the banner and the server log |
