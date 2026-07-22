# Git Relay

Run git from your phone against a repo on your laptop. Check status, read diffs,
stage files, commit, and push — from a browser, without exposing your laptop to
the internet.

## How it works

Three pieces, no inbound ports and no code ever leaving your machine:

```
Phone (PWA)  <--->  Supabase Realtime  <--->  Laptop (Electron tray app)
                     (message relay)            (runs the actual git commands)
```

The relay only passes messages. Both sides connect *outbound* to a Supabase
channel named after a shared pairing token, so there's nothing to port-forward
and no server holding your source. Git itself only ever runs on the laptop.

## Packages

| Path | What it is |
|---|---|
| `laptop-agent/` | Electron tray app. Holds the pairing token, owns the repo path, executes git via `simple-git`. |
| `phone-app/` | Vite + React PWA. Pairs by QR or pasted token, drives the git operations. |

## Setup

Both packages need Supabase credentials. Copy the examples and fill in your
project's values:

```bash
cp laptop-agent/.env.example laptop-agent/.env
cp phone-app/.env.example phone-app/.env
```

Then install and run each side:

```bash
cd laptop-agent && npm install && npm start
```

```bash
cd phone-app && npm install && npm run dev -- --host
```

Open the tray icon → **Pairing & Settings** to set your repo path and reveal the
pairing token. On the phone, browse to the dev server's LAN address and enter
that token.

The `--host` flag is what makes the dev server reachable from your phone; both
devices must be on the same network. Note that the QR scanner needs camera
access, which mobile browsers only grant over HTTPS or `localhost` — over a
plain `http://` LAN address, paste the token manually instead.

## Tests

```bash
cd laptop-agent && npm test
```

```bash
cd phone-app && npm test
```

## Security notes

The pairing token is the only credential — anyone holding it can run git
operations against your configured repo. Treat it like a password. It lives in
`~/.git-relay-agent/config.json`, outside this repo, and is never committed.

`.env` files are gitignored; only `.env.example` templates are tracked.

The agent must be running for the phone to do anything. If the phone shows
"Offline", start the tray app.
