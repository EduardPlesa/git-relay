# Mobile GitHub Client — Design Spec

## Purpose

A mobile-friendly web app, hosted in the cloud, that lets the user browse GitHub
repos, edit files, commit, push, and open/manage pull requests directly from
their phone's browser — without needing a laptop, terminal, or native app.

This app operates entirely against files that live **on GitHub** (via the
GitHub API). It does not read or sync the local filesystem of any other
machine (e.g. a laptop). Local, uncommitted changes on a laptop (including
those written by Claude Code) are pushed to GitHub the normal way
(`git push`, or Claude Code committing/pushing on request) — that workflow is
explicitly out of scope for this app.

## User

Single user (the app owner), signing in with their own GitHub account. No
multi-tenancy, no public sign-up.

## Architecture

```
Phone browser (PWA)
   │  HTTPS
   ▼
Next.js app on Vercel (Hobby / free tier)
 ├─ Frontend: React pages/components, mobile-first CSS, installable PWA manifest
 ├─ API routes:
 │    /api/auth/*            → OAuth login/callback (Auth.js), issues session cookie
 │    /api/repos             → list the user's repos (proxies GitHub API)
 │    /api/repos/[..]/tree   → browse files in a repo/branch
 │    /api/repos/[..]/file   → get/update file content (commit)
 │    /api/repos/[..]/prs    → list/create/merge PRs
 └─ Session: encrypted cookie holding the GitHub access token
      (server-side use only, never exposed to client JS)
```

No database is needed initially — GitHub is the source of truth for all
repos, files, commits, and PRs. The only server-side state is the session
cookie holding the OAuth access token.

**Stack choices:**
- **Next.js** (React + API routes in one project) — avoids running a separate
  backend service.
- **Auth.js (NextAuth) GitHub provider** — handles the OAuth code exchange
  server-side, keeping the OAuth App's client secret off the phone.
- **Octokit** (GitHub's official API client) — used for all repo/file/PR
  operations via the GitHub REST API. No real `git` binary or local clone is
  ever needed.
- **CodeMirror** for the in-browser file editor (lightweight, mobile-friendly;
  Monaco is too heavy for phone use).
- **Vercel Hobby plan (free)** — automatic HTTPS, custom domain support,
  serverless functions for the API routes, auto-deploy on every git push. No
  cost for single-user traffic.

**Alternatives considered:**
- SvelteKit/Remix instead of Next.js — equally valid, but Next.js has the
  most mature GitHub OAuth + Vercel deployment story.
- Cloudflare Workers/Pages instead of Vercel — cheaper at large scale, but
  unnecessary for one user; Vercel's DX for OAuth + API routes + React is
  smoother.
- Real git operations against a server-side clone — rejected: much more
  infrastructure (storage, concurrency, remote auth) for no benefit over the
  GitHub API, which already exposes commit/PR creation directly.

## Components & data flow

- **Auth**: Phone hits `/api/auth/signin` → redirected to GitHub → GitHub
  redirects back with a code → Auth.js exchanges it for an access token →
  token stored in an encrypted session cookie. Requires one GitHub OAuth App
  (registered once, free) with client ID/secret stored as Vercel environment
  variables.
- **Repo browser**: Mobile list view calls `/api/repos`
  (`octokit.repos.listForAuthenticatedUser`). Tapping a repo shows branches,
  then a file tree (`octokit.git.getTree`). Tapping a file loads its content
  into the CodeMirror editor.
- **Commit flow**: Editing a file and hitting "Commit" calls
  `/api/repos/[..]/file`, which uses
  `octokit.repos.createOrUpdateFileContents` to commit directly to the chosen
  branch (existing branch, or a new branch named inline).
- **PR flow**: After committing to a non-default branch, an "Open PR" button
  calls `octokit.pulls.create`. A "Pull Requests" tab lists open PRs
  (`octokit.pulls.list`) with a diff view (from `octokit.pulls.get`'s
  diff/patch data) and a merge button (`octokit.pulls.merge`).
- **Multi-file staging (Phase 2)**: Client-side React state holds a
  "pending changes" set across multiple files during a session. On commit,
  the lower-level git data API (`createTree` + `createCommit` + update ref)
  bundles them into a single atomic commit instead of one API call per file.

## Phases

1. **Phase 1 (MVP)**: OAuth login, repo list, branch/file tree browsing,
   single-file view + edit, commit to existing or new branch, create PR from
   that branch. Installable PWA manifest (home-screen icon, standalone
   display) included here since it's low cost.
2. **Phase 2**: Multi-file staging — edit several files in one session,
   commit them together as one atomic commit.
3. **Phase 3**: PR review & management — list open PRs, view diffs, comment,
   approve, merge, close.

## Error handling

- All API routes wrap Octokit calls and return a normalized `{error: string}`
  shape; the frontend surfaces these as inline toast/banner messages instead
  of crashing.
- Rate limits and 404s (missing file/branch) are surfaced the same way.
- `createOrUpdateFileContents` requires the file's current SHA; if the file
  changed elsewhere between load and commit, GitHub returns a 409 conflict —
  the UI catches this and offers "reload latest version."
- Expired/revoked OAuth tokens redirect back to sign-in.

## Testing

Pragmatic approach, given this wraps a well-tested third-party API for a
single user:
- A few integration tests against a disposable test repo covering the core
  commit and PR-creation flow.
- Manual testing on an actual phone for UI/UX, since automated tests don't
  verify mobile usability.

## Out of scope

- Reading/syncing local filesystem changes from a laptop or other machine.
- Multi-user / public sign-up support.
- Real git operations (clone, rebase, merge conflicts beyond what the GitHub
  API surfaces) — everything goes through the GitHub API.
