# Laptop-to-Phone Git Relay — Design Spec

> Supersedes `2026-07-22-mobile-github-client-design.md`. That earlier spec
> assumed edits happened *inside* a browser-based GitHub file editor. This
> spec instead lets the phone remotely drive **real git operations on the
> user's actual laptop working directory** (including files written by
> Claude Code or any local editor) — staging, committing, pushing, and
> opening PRs — without the phone ever touching file content directly.

## Purpose

Let the user review uncommitted changes on their laptop, stage files, write
a commit message, commit, push, and open a pull request — all from their
phone's browser — while the actual git operations run locally on the laptop
using its existing git setup (credentials, SSH keys, etc.).

## User

Single user (the app owner). Two of their own devices — one laptop, one
phone — pair with each other. No multi-tenancy, no public sign-up.

## Architecture

```
┌─────────────────┐         ┌────────────────────────┐         ┌─────────────────┐
│  Laptop tray app │ ◄─────► │  Relay: Supabase        │ ◄─────► │  Phone web app   │
│  (background)    │  WS     │  Realtime (free tier)    │  WS     │  (PWA, browser)  │
└─────────────────┘         └────────────────────────┘         └─────────────────┘
        │
        ▼
  Local git repo(s) — git status/diff/add/commit/push
  via the `simple-git` library (wraps the real `git` CLI)
        │
        ▼
  GitHub — PR creation via Octokit, using a GitHub token
  configured once in the tray app
```

**Relay choice — Supabase Realtime (free tier), not a self-hosted WebSocket
server**: a self-hosted relay on free hosting (Render, Fly, etc.) either
sleeps after inactivity — killing the laptop's connection and adding a
30-60s wake-up delay on the next command — or requires a paid always-on
plan. Supabase's free tier includes a hosted Realtime pub/sub service with
no sleep. Both the tray app and phone app connect *directly* to it as
clients, joining a shared private channel. No backend server needs to be
built or hosted at all.

**Laptop tray app**: a small always-running background app (Node.js + a
lightweight tray/menu-bar wrapper) that:
- watches folders the user has registered,
- runs real `git` commands locally (status, diff, add, commit, push) via
  `simple-git` — using the laptop's existing git credentials (SSH
  key/credential manager), so push works without any new auth setup,
- uses Octokit with a GitHub personal access token (configured once in tray
  app settings) to create PRs after a push, since PR creation is a GitHub
  API feature, not a git operation.

**Phone web app**: a mobile-first PWA that is a thin remote control — it
never touches file content or talks to GitHub directly. It sends commands
(get status, stage files, commit, push, open PR) through the relay to the
tray app, which does the actual work, and renders the responses (file
lists, diffs, errors, PR URLs).

**Alternatives considered:**
- *Self-hosted WebSocket relay server* — rejected: free hosting tiers that
  support WebSockets either sleep on inactivity or aren't truly free
  long-term; Supabase Realtime avoids both.
- *Local-network-only (phone talks directly to laptop's local IP)* —
  rejected: doesn't work when away from home/office, which defeats the
  "from my phone, anywhere" purpose.
- *Tunneling tool (ngrok) in front of a local server* — rejected: extra
  moving piece, free tier gives a new URL on every restart, adds a
  dependency on a third-party tunnel service.

## Pairing & security

- First run, the tray app generates a long random token, shown as text and a
  QR code.
- The phone app is paired once by scanning/entering that token.
- Both sides store the token locally (tray app: config file; phone app:
  browser localStorage) and use it as the Supabase Realtime channel name —
  only someone with the exact token can join that channel, so only the
  paired phone and laptop talk to each other.
- Losing the phone means regenerating the token in the tray app and
  re-pairing a new device.
- No queuing: commands sent while the laptop is offline are not stored and
  retried; the phone shows connection state upfront via Supabase Realtime
  "presence" so the user knows before attempting an action.

## Components & data flow

- **Repo registration**: the user adds one or more folder paths in the tray
  app. The phone asks "which repos are available" on connect and shows them
  as a list.
- **Status/diff**: phone sends `{cmd: "status", repo}` → tray app runs
  `git status` + `git diff` via simple-git → returns changed/staged/
  untracked files and diffs → phone renders a file list with expandable
  diffs.
- **Staging & commit**: phone sends `{cmd: "stage", repo, files}`, then
  `{cmd: "commit", repo, message}` → tray app runs `git add <files>` and
  `git commit -m <message>`.
- **Push**: phone sends `{cmd: "push", repo}` → tray app runs `git push`
  using the laptop's existing credentials; failures (auth, non-fast-forward,
  no upstream) are relayed back as error text.
- **PR creation**: phone sends `{cmd: "create-pr", repo, title, base, head}`
  → tray app calls `octokit.pulls.create` using its configured GitHub token
  → returns the PR URL.
- **Liveness**: phone shows a connection indicator (online/offline) driven
  by Supabase Realtime presence for the tray app.

## Phases

1. **Phase 1 (MVP)**: pairing (token + QR), single registered repo,
   status/diff view, stage files, commit, push.
2. **Phase 2**: PR creation (Octokit + GitHub token in tray app), multi-repo
   support with a repo picker on the phone.
3. **Phase 3**: nicer diff rendering (syntax highlighting), commit history
   view, phone notifications (e.g. tray app coming online, long git
   operation finishing).

## Error handling

- Offline laptop: phone detects this via presence and shows "laptop not
  connected" instead of hanging on a command.
- Git errors (merge conflicts, push rejected, nothing staged, detached HEAD,
  etc.) are caught by the tray app and relayed back as plain-text errors —
  no automatic conflict resolution.
- Security: the pairing token is the sole credential gating repo access over
  the relay; treat it like a password.

## Testing

- Manual end-to-end testing (real repo, real phone) for the MVP, given the
  small scope.
- Unit tests around the tray app's git-command wrapper (mocking
  `simple-git`) to catch command-construction bugs before they run against a
  real repository.

## Out of scope

- Editing file *content* from the phone (this design only stages/commits/
  pushes/PRs what already exists on disk on the laptop; no in-browser code
  editor).
- Multi-user / public sign-up support.
- Command queuing while the laptop is offline.
- Automatic conflict resolution.
