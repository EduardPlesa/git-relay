# Laptop-to-Phone Git Relay (Phase 1 MVP) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Phase 1 MVP from the design spec — pair a laptop tray app with a phone web app via a Supabase Realtime relay, and let the phone review git status/diffs, stage files, commit, and push, with all real git operations running on the laptop.

**Architecture:** Two independent Node.js apps — an Electron tray app on the laptop (runs real `git` commands via `simple-git`) and a Vite/React PWA on the phone (thin remote control) — that never talk to each other directly. Both connect as clients to a shared Supabase Realtime channel (named after a one-time pairing token) and exchange JSON command/response messages over WebSocket broadcast events.

**Tech Stack:** Node.js 20+, Electron (laptop tray app), `simple-git` (git operations), `@supabase/supabase-js` (relay transport, both sides), Vite + React (phone PWA), `html5-qrcode` (QR pairing scan), `qrcode` (QR pairing display), Vitest (tests on both sides).

## Global Constraints

- Node.js 20+ on both projects (required for global `crypto.randomUUID()` support in both the Vite/browser build and Vitest/Node test runs).
- Relay transport is Supabase Realtime free tier only — no self-hosted WebSocket server, per the spec's rejection of that approach.
- Git push must use the laptop's existing local git credentials (SSH key/credential manager) — no new auth flow is introduced for git operations.
- No command queuing while the laptop is offline, and no automatic git conflict resolution — both explicitly out of scope per the spec.
- PR creation and multi-repo support are Phase 2/3 in the spec and are **not** part of this plan — this plan covers Phase 1 only: pairing, single registered repo, status/diff, stage, commit, push.
- The pairing token doubles as the Supabase Realtime channel name; it must never be logged or transmitted anywhere outside the paired channel.
- **Module syntax in laptop-agent** (corrected during Task 2 — vitest 2.1.9 throws if `require('vitest')` is used, it is ESM-only): all `laptop-agent/src/*.js` **source** files use CommonJS (`require()` / `module.exports`), since Electron's main process loads them via `require()` and `laptop-agent/package.json` has no `"type": "module"`. All `laptop-agent/src/*.test.js` **test** files use ES module syntax (`import`/`export`) instead of `require()`, including importing named exports directly from the CommonJS source files under test (e.g. `import { generateToken } from './pairing.js';`) — this interop is validated working (Task 2's tests pass). Every task below that shows `require('vitest')` or `require('./something')` inside a `*.test.js` code block should be read as `import { ... } from 'vitest'` / `import { ... } from './something.js'` instead; the source-file code blocks are unaffected and stay CommonJS as written.

---

## File Structure

```
Tool/
  .gitignore
  laptop-agent/
    package.json
    .env.example
    assets/
      tray-icon.png          (manual: any small PNG icon)
    src/
      pairing.js              Task 2
      pairing.test.js         Task 2
      config.js                Task 3
      config.test.js           Task 3
      gitOps.js                 Tasks 4-5
      gitOps.test.js            Tasks 4-5
      relayClient.js            Task 6
      relayClient.test.js       Task 6
      main.js                    Task 7
      preload.js                 Task 7
      pairingWindow.html         Task 7
  phone-app/
    package.json
    .env.example
    vite.config.js              Tasks 8, 11
    index.html                   Task 8
    public/
      icon-192.png              (manual: any square PNG, Task 11)
      icon-512.png              (manual: any square PNG, Task 11)
    src/
      main.jsx                   Task 8
      App.jsx                    Tasks 8, 9, 10
      supabaseClient.js           Task 8
      relay.js                    Task 8
      relay.test.js                Task 8
      pairing/
        PairingScreen.jsx          Task 9
      status/
        StatusScreen.jsx            Task 10
```

---

### Task 1: Monorepo scaffolding & Supabase project setup

**Files:**
- Create: `.gitignore`
- Create: `laptop-agent/package.json`
- Create: `laptop-agent/.env.example`
- Create: `phone-app/package.json`
- Create: `phone-app/.env.example`

**Interfaces:**
- Produces: `SUPABASE_URL` / `SUPABASE_ANON_KEY` env vars (laptop-agent, loaded via `dotenv`), `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` env vars (phone-app, auto-loaded by Vite). Every later task that talks to Supabase consumes these.

- [ ] **Step 1: Create a Supabase project**

Go to https://supabase.com, sign in (or create a free account), click "New Project", pick any name/region, and wait for it to finish provisioning (free tier). Once ready, go to **Settings → API** in the project dashboard and copy the **Project URL** and the **anon public** key. You'll paste these into `.env` files in a later step — keep this tab open.

- [ ] **Step 2: Create the root `.gitignore`**

```
node_modules/
.env
dist/
dist-electron/
*.log
```

- [ ] **Step 3: Create `laptop-agent/package.json`**

```json
{
  "name": "git-relay-laptop-agent",
  "version": "0.1.0",
  "private": true,
  "main": "src/main.js",
  "scripts": {
    "start": "electron .",
    "test": "vitest run"
  },
  "dependencies": {
    "@supabase/supabase-js": "^2.45.0",
    "simple-git": "^3.25.0",
    "qrcode": "^1.5.4",
    "dotenv": "^16.4.5"
  },
  "devDependencies": {
    "electron": "^31.0.0",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 4: Create `laptop-agent/.env.example`**

```
SUPABASE_URL=https://YOUR-PROJECT.supabase.co
SUPABASE_ANON_KEY=YOUR-ANON-KEY
```

Copy this to `laptop-agent/.env` (not committed — covered by `.gitignore`) and fill in the real values from Step 1.

- [ ] **Step 5: Create `phone-app/package.json`**

```json
{
  "name": "git-relay-phone-app",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "test": "vitest run"
  },
  "dependencies": {
    "@supabase/supabase-js": "^2.45.0",
    "react": "^18.3.0",
    "react-dom": "^18.3.0",
    "html5-qrcode": "^2.3.8",
    "qrcode": "^1.5.4"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^4.3.0",
    "vite": "^5.4.0",
    "vite-plugin-pwa": "^0.20.0",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 6: Create `phone-app/.env.example`**

```
VITE_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR-ANON-KEY
```

Copy this to `phone-app/.env` (not committed) and fill in the same values from Step 1.

- [ ] **Step 7: Install dependencies in both projects**

Run: `cd laptop-agent && npm install`
Run: `cd phone-app && npm install`
Expected: both complete with no errors (warnings about deprecated sub-dependencies are fine).

- [ ] **Step 8: Commit**

```bash
git add .gitignore laptop-agent/package.json laptop-agent/.env.example phone-app/package.json phone-app/.env.example
git commit -m "chore: scaffold laptop-agent and phone-app projects"
```

---

### Task 2: Pairing token generation (laptop-agent)

**Files:**
- Create: `laptop-agent/src/pairing.js`
- Test: `laptop-agent/src/pairing.test.js`

**Interfaces:**
- Produces: `generateToken(): string` — a URL-safe random token. Consumed by Task 7 (main.js) to create a new pairing token on first run.

- [ ] **Step 1: Write the failing test**

```js
// laptop-agent/src/pairing.test.js
const { describe, it, expect } = require('vitest');
const { generateToken } = require('./pairing');

describe('generateToken', () => {
  it('returns a non-empty string', () => {
    const token = generateToken();
    expect(typeof token).toBe('string');
    expect(token.length).toBeGreaterThan(20);
  });

  it('returns a different token on each call', () => {
    const a = generateToken();
    const b = generateToken();
    expect(a).not.toBe(b);
  });

  it('only contains URL-safe base64 characters', () => {
    const token = generateToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd laptop-agent && npx vitest run src/pairing.test.js`
Expected: FAIL with "Cannot find module './pairing'" (or similar).

- [ ] **Step 3: Write minimal implementation**

```js
// laptop-agent/src/pairing.js
const crypto = require('crypto');

function generateToken() {
  return crypto.randomBytes(24).toString('base64url');
}

module.exports = { generateToken };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd laptop-agent && npx vitest run src/pairing.test.js`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add laptop-agent/src/pairing.js laptop-agent/src/pairing.test.js
git commit -m "feat(laptop-agent): add pairing token generation"
```

---

### Task 3: Config load/save (laptop-agent)

**Files:**
- Create: `laptop-agent/src/config.js`
- Test: `laptop-agent/src/config.test.js`

**Interfaces:**
- Produces: `getConfigPath(): string`, `loadConfig(configPath: string): { pairingToken: string|null, repoPath: string|null }`, `saveConfig(configPath: string, config: object): void`. Consumed by Task 7 (main.js) to persist the pairing token and registered repo path across app restarts.

- [ ] **Step 1: Write the failing test**

```js
// laptop-agent/src/config.test.js
const { describe, it, expect, beforeEach, afterEach } = require('vitest');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadConfig, saveConfig } = require('./config');

describe('config load/save', () => {
  let tmpDir;
  let configPath;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'git-relay-test-'));
    configPath = path.join(tmpDir, 'config.json');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns default config when file does not exist', () => {
    const config = loadConfig(configPath);
    expect(config).toEqual({ pairingToken: null, repoPath: null });
  });

  it('saves and reloads a config', () => {
    saveConfig(configPath, { pairingToken: 'abc123', repoPath: '/repo' });
    const reloaded = loadConfig(configPath);
    expect(reloaded).toEqual({ pairingToken: 'abc123', repoPath: '/repo' });
  });

  it('creates parent directories if missing', () => {
    const nestedPath = path.join(tmpDir, 'nested', 'dir', 'config.json');
    saveConfig(nestedPath, { pairingToken: 'x', repoPath: '/repo' });
    expect(fs.existsSync(nestedPath)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd laptop-agent && npx vitest run src/config.test.js`
Expected: FAIL with "Cannot find module './config'"

- [ ] **Step 3: Write minimal implementation**

```js
// laptop-agent/src/config.js
const fs = require('fs');
const path = require('path');
const os = require('os');

function getConfigPath() {
  return path.join(os.homedir(), '.git-relay-agent', 'config.json');
}

function loadConfig(configPath) {
  if (!fs.existsSync(configPath)) {
    return { pairingToken: null, repoPath: null };
  }
  const raw = fs.readFileSync(configPath, 'utf8');
  return JSON.parse(raw);
}

function saveConfig(configPath, config) {
  const dir = path.dirname(configPath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
}

module.exports = { getConfigPath, loadConfig, saveConfig };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd laptop-agent && npx vitest run src/config.test.js`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add laptop-agent/src/config.js laptop-agent/src/config.test.js
git commit -m "feat(laptop-agent): add config load/save"
```

---

### Task 4: Git status & diff wrapper (laptop-agent)

**Files:**
- Create: `laptop-agent/src/gitOps.js`
- Test: `laptop-agent/src/gitOps.test.js`

**Interfaces:**
- Produces: `getStatus(repoPath: string): Promise<{ staged: string[], unstaged: string[], untracked: string[] }>`, `getDiff(repoPath: string, file: string, staged: boolean): Promise<string>`. Consumed by Task 6 (relayClient.js).

- [ ] **Step 1: Write the failing test**

```js
// laptop-agent/src/gitOps.test.js
const { describe, it, expect, beforeEach, afterEach } = require('vitest');
const fs = require('fs');
const os = require('os');
const path = require('path');
const simpleGit = require('simple-git');
const { getStatus, getDiff } = require('./gitOps');

async function makeTestRepo() {
  const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'git-relay-repo-'));
  const git = simpleGit(repoPath);
  await git.init();
  await git.addConfig('user.email', 'test@example.com');
  await git.addConfig('user.name', 'Test User');
  fs.writeFileSync(path.join(repoPath, 'committed.txt'), 'initial\n');
  await git.add('committed.txt');
  await git.commit('initial commit');
  return repoPath;
}

describe('getStatus', () => {
  let repoPath;

  beforeEach(async () => {
    repoPath = await makeTestRepo();
  });

  afterEach(() => {
    fs.rmSync(repoPath, { recursive: true, force: true });
  });

  it('detects an untracked file', async () => {
    fs.writeFileSync(path.join(repoPath, 'new.txt'), 'hello\n');
    const status = await getStatus(repoPath);
    expect(status.untracked).toContain('new.txt');
    expect(status.staged).toEqual([]);
  });

  it('detects an unstaged modification', async () => {
    fs.writeFileSync(path.join(repoPath, 'committed.txt'), 'changed\n');
    const status = await getStatus(repoPath);
    expect(status.unstaged).toContain('committed.txt');
  });

  it('detects a staged file', async () => {
    fs.writeFileSync(path.join(repoPath, 'committed.txt'), 'changed\n');
    const git = simpleGit(repoPath);
    await git.add('committed.txt');
    const status = await getStatus(repoPath);
    expect(status.staged).toContain('committed.txt');
    expect(status.unstaged).not.toContain('committed.txt');
  });
});

describe('getDiff', () => {
  let repoPath;

  beforeEach(async () => {
    repoPath = await makeTestRepo();
  });

  afterEach(() => {
    fs.rmSync(repoPath, { recursive: true, force: true });
  });

  it('returns unstaged diff text for a modified file', async () => {
    fs.writeFileSync(path.join(repoPath, 'committed.txt'), 'changed\n');
    const diff = await getDiff(repoPath, 'committed.txt', false);
    expect(diff).toContain('-initial');
    expect(diff).toContain('+changed');
  });

  it('returns staged diff text for a staged file', async () => {
    fs.writeFileSync(path.join(repoPath, 'committed.txt'), 'changed\n');
    const git = simpleGit(repoPath);
    await git.add('committed.txt');
    const diff = await getDiff(repoPath, 'committed.txt', true);
    expect(diff).toContain('-initial');
    expect(diff).toContain('+changed');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd laptop-agent && npx vitest run src/gitOps.test.js`
Expected: FAIL with "Cannot find module './gitOps'"

- [ ] **Step 3: Write minimal implementation**

```js
// laptop-agent/src/gitOps.js
const simpleGit = require('simple-git');

async function getStatus(repoPath) {
  const git = simpleGit(repoPath);
  const status = await git.status();

  const staged = [];
  const unstaged = [];
  const untracked = [];

  for (const file of status.files) {
    if (file.working_dir === '?') {
      untracked.push(file.path);
      continue;
    }
    if (file.index !== ' ' && file.index !== '?') {
      staged.push(file.path);
    }
    if (file.working_dir !== ' ' && file.working_dir !== '?') {
      unstaged.push(file.path);
    }
  }

  return { staged, unstaged, untracked };
}

async function getDiff(repoPath, file, staged) {
  const git = simpleGit(repoPath);
  if (staged) {
    return git.diff(['--staged', '--', file]);
  }
  return git.diff(['--', file]);
}

module.exports = { getStatus, getDiff };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd laptop-agent && npx vitest run src/gitOps.test.js`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add laptop-agent/src/gitOps.js laptop-agent/src/gitOps.test.js
git commit -m "feat(laptop-agent): add git status and diff wrapper"
```

---

### Task 5: Git stage/commit/push wrapper (laptop-agent)

**Files:**
- Modify: `laptop-agent/src/gitOps.js`
- Modify: `laptop-agent/src/gitOps.test.js`

**Interfaces:**
- Consumes: nothing new (extends Task 4's file).
- Produces: `stageFiles(repoPath: string, files: string[]): Promise<void>`, `commitChanges(repoPath: string, message: string): Promise<string>` (returns commit hash), `pushChanges(repoPath: string): Promise<void>`. Consumed by Task 6 (relayClient.js).

- [ ] **Step 1: Write the failing test**

Append to `laptop-agent/src/gitOps.test.js`:

```js
const { stageFiles, commitChanges } = require('./gitOps');

describe('stageFiles and commitChanges', () => {
  let repoPath;

  beforeEach(async () => {
    repoPath = await makeTestRepo();
  });

  afterEach(() => {
    fs.rmSync(repoPath, { recursive: true, force: true });
  });

  it('stages the given files', async () => {
    fs.writeFileSync(path.join(repoPath, 'new.txt'), 'hello\n');
    await stageFiles(repoPath, ['new.txt']);
    const status = await getStatus(repoPath);
    expect(status.staged).toContain('new.txt');
  });

  it('commits staged changes and returns a commit hash', async () => {
    fs.writeFileSync(path.join(repoPath, 'new.txt'), 'hello\n');
    await stageFiles(repoPath, ['new.txt']);
    const commitHash = await commitChanges(repoPath, 'add new.txt');
    expect(commitHash).toMatch(/^[0-9a-f]{7,40}$/);
    const status = await getStatus(repoPath);
    expect(status.staged).toEqual([]);
    expect(status.untracked).toEqual([]);
  });
});
```

Note: this requires changing the two `const { ... } = require('./gitOps')` and `const { ... } = require('vitest')` import lines at the top of the file to include `stageFiles, commitChanges` — merge them into the existing top-of-file imports rather than re-declaring, since `const` cannot be redeclared in the same scope.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd laptop-agent && npx vitest run src/gitOps.test.js`
Expected: FAIL with "stageFiles is not a function" (or similar)

- [ ] **Step 3: Write minimal implementation**

Append to `laptop-agent/src/gitOps.js`, and update its `module.exports`:

```js
async function stageFiles(repoPath, files) {
  const git = simpleGit(repoPath);
  await git.add(files);
}

async function commitChanges(repoPath, message) {
  const git = simpleGit(repoPath);
  const result = await git.commit(message);
  return result.commit;
}

async function pushChanges(repoPath) {
  const git = simpleGit(repoPath);
  await git.push();
}

module.exports = { getStatus, getDiff, stageFiles, commitChanges, pushChanges };
```

`pushChanges` has no automated test — it requires a real configured remote and network access, which isn't available in an isolated temp repo. It's exercised manually in Task 12's end-to-end test.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd laptop-agent && npx vitest run src/gitOps.test.js`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add laptop-agent/src/gitOps.js laptop-agent/src/gitOps.test.js
git commit -m "feat(laptop-agent): add stage, commit, and push git operations"
```

---

### Task 6: Relay command router (laptop-agent)

**Files:**
- Create: `laptop-agent/src/relayClient.js`
- Test: `laptop-agent/src/relayClient.test.js`

**Interfaces:**
- Consumes: `getStatus`, `getDiff`, `stageFiles`, `commitChanges`, `pushChanges` from `./gitOps` (Tasks 4-5).
- Produces: `createRelayClient(supabaseClient, channelName: string, repoPath: string)` — wires up a Supabase Realtime channel to dispatch incoming `command` broadcasts to git operations and reply with `response` broadcasts. `handleCommand(cmd: string, payload: object, repoPath: string): Promise<object>` — the pure dispatch function, exported separately for testing. Consumed by Task 7 (main.js).

- [ ] **Step 1: Write the failing test**

```js
// laptop-agent/src/relayClient.test.js
const { describe, it, expect, vi, beforeEach } = require('vitest');

vi.mock('./gitOps', () => ({
  getStatus: vi.fn(),
  getDiff: vi.fn(),
  stageFiles: vi.fn(),
  commitChanges: vi.fn(),
  pushChanges: vi.fn(),
}));

const gitOps = require('./gitOps');
const { handleCommand } = require('./relayClient');

describe('handleCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('dispatches status command to getStatus', async () => {
    gitOps.getStatus.mockResolvedValue({ staged: [], unstaged: [], untracked: [] });
    const result = await handleCommand('status', {}, '/repo');
    expect(gitOps.getStatus).toHaveBeenCalledWith('/repo');
    expect(result).toEqual({ staged: [], unstaged: [], untracked: [] });
  });

  it('dispatches diff command with file and staged flag', async () => {
    gitOps.getDiff.mockResolvedValue('diff text');
    const result = await handleCommand('diff', { file: 'a.txt', staged: true }, '/repo');
    expect(gitOps.getDiff).toHaveBeenCalledWith('/repo', 'a.txt', true);
    expect(result).toEqual({ diff: 'diff text' });
  });

  it('dispatches stage command with file list', async () => {
    gitOps.stageFiles.mockResolvedValue();
    const result = await handleCommand('stage', { files: ['a.txt'] }, '/repo');
    expect(gitOps.stageFiles).toHaveBeenCalledWith('/repo', ['a.txt']);
    expect(result).toEqual({ ok: true });
  });

  it('dispatches commit command and returns commit hash', async () => {
    gitOps.commitChanges.mockResolvedValue('abc1234');
    const result = await handleCommand('commit', { message: 'msg' }, '/repo');
    expect(gitOps.commitChanges).toHaveBeenCalledWith('/repo', 'msg');
    expect(result).toEqual({ commitHash: 'abc1234' });
  });

  it('dispatches push command', async () => {
    gitOps.pushChanges.mockResolvedValue();
    const result = await handleCommand('push', {}, '/repo');
    expect(gitOps.pushChanges).toHaveBeenCalledWith('/repo');
    expect(result).toEqual({ ok: true });
  });

  it('throws on unknown command', async () => {
    await expect(handleCommand('bogus', {}, '/repo')).rejects.toThrow('Unknown command: bogus');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd laptop-agent && npx vitest run src/relayClient.test.js`
Expected: FAIL with "Cannot find module './relayClient'"

- [ ] **Step 3: Write minimal implementation**

```js
// laptop-agent/src/relayClient.js
const { getStatus, getDiff, stageFiles, commitChanges, pushChanges } = require('./gitOps');

async function handleCommand(cmd, payload, repoPath) {
  switch (cmd) {
    case 'status':
      return getStatus(repoPath);
    case 'diff':
      return { diff: await getDiff(repoPath, payload.file, payload.staged) };
    case 'stage':
      await stageFiles(repoPath, payload.files);
      return { ok: true };
    case 'commit':
      return { commitHash: await commitChanges(repoPath, payload.message) };
    case 'push':
      await pushChanges(repoPath);
      return { ok: true };
    default:
      throw new Error(`Unknown command: ${cmd}`);
  }
}

function createRelayClient(supabaseClient, channelName, repoPath) {
  const channel = supabaseClient.channel(channelName, {
    config: { presence: { key: 'laptop' } },
  });

  channel.on('broadcast', { event: 'command' }, async ({ payload }) => {
    const { id, cmd, payload: cmdPayload } = payload;
    try {
      const data = await handleCommand(cmd, cmdPayload, repoPath);
      await channel.send({
        type: 'broadcast',
        event: 'response',
        payload: { id, ok: true, data },
      });
    } catch (error) {
      await channel.send({
        type: 'broadcast',
        event: 'response',
        payload: { id, ok: false, error: error.message },
      });
    }
  });

  channel.subscribe(async (status) => {
    if (status === 'SUBSCRIBED') {
      await channel.track({ online_at: new Date().toISOString() });
    }
  });

  return channel;
}

module.exports = { createRelayClient, handleCommand };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd laptop-agent && npx vitest run src/relayClient.test.js`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add laptop-agent/src/relayClient.js laptop-agent/src/relayClient.test.js
git commit -m "feat(laptop-agent): add relay command router"
```

---

### Task 7: Electron tray app + pairing window (laptop-agent)

**Files:**
- Create: `laptop-agent/src/main.js`
- Create: `laptop-agent/src/preload.js`
- Create: `laptop-agent/src/pairingWindow.html`
- Create: `laptop-agent/assets/tray-icon.png` (manual — see Step 1)

**Interfaces:**
- Consumes: `generateToken` (Task 2), `getConfigPath`/`loadConfig`/`saveConfig` (Task 3), `createRelayClient` (Task 6).
- Produces: the running Electron app (no further tasks depend on its exports — this is the top-level entry point).

This task has no automated tests — it's Electron UI/process wiring, verified manually per the spec's testing approach. Manual verification is Step 6 below.

- [ ] **Step 1: Add a tray icon image**

Create `laptop-agent/assets/tray-icon.png` — any small square PNG (16x16 or larger) works; e.g. export one from an icon generator or reuse an existing icon file. This is a required binary asset that can't be authored as text.

- [ ] **Step 2: Write `laptop-agent/src/preload.js`**

```js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('agentApi', {
  getPairingInfo: () => ipcRenderer.invoke('get-pairing-info'),
  setRepoPath: (repoPath) => ipcRenderer.invoke('set-repo-path', repoPath),
});
```

- [ ] **Step 3: Write `laptop-agent/src/pairingWindow.html`**

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Git Relay Agent — Pairing</title>
  <style>
    body { font-family: sans-serif; padding: 16px; }
    #qrcode { margin: 12px 0; }
    input { width: 100%; padding: 6px; margin-bottom: 8px; box-sizing: border-box; }
    button { padding: 6px 12px; }
  </style>
</head>
<body>
  <h2>Pairing Token</h2>
  <p>Scan this on your phone, or copy the token below:</p>
  <canvas id="qrcode"></canvas>
  <input id="token" readonly />

  <h2>Repo Path</h2>
  <input id="repoPath" placeholder="C:\path\to\repo" />
  <button id="saveRepoPath">Save</button>
  <p id="status"></p>

  <script src="../node_modules/qrcode/build/qrcode.js"></script>
  <script>
    async function init() {
      const info = await window.agentApi.getPairingInfo();
      document.getElementById('token').value = info.pairingToken || '';
      document.getElementById('repoPath').value = info.repoPath || '';
      if (info.pairingToken) {
        QRCode.toCanvas(document.getElementById('qrcode'), info.pairingToken);
      }
    }

    document.getElementById('saveRepoPath').addEventListener('click', async () => {
      const repoPath = document.getElementById('repoPath').value;
      await window.agentApi.setRepoPath(repoPath);
      document.getElementById('status').textContent = 'Saved.';
    });

    init();
  </script>
</body>
</html>
```

- [ ] **Step 4: Write `laptop-agent/src/main.js`**

```js
require('dotenv').config();
const { app, Tray, Menu, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const { generateToken } = require('./pairing');
const { getConfigPath, loadConfig, saveConfig } = require('./config');
const { createRelayClient } = require('./relayClient');

let tray = null;
let pairingWindow = null;
let config = null;
let relayChannel = null;

function ensurePairingToken() {
  if (!config.pairingToken) {
    config.pairingToken = generateToken();
    saveConfig(getConfigPath(), config);
  }
}

function startRelay() {
  if (!config.pairingToken || !config.repoPath) return;
  if (relayChannel) return;

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY
  );
  relayChannel = createRelayClient(supabase, config.pairingToken, config.repoPath);
}

function openPairingWindow() {
  if (pairingWindow) {
    pairingWindow.focus();
    return;
  }
  pairingWindow = new BrowserWindow({
    width: 420,
    height: 520,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    },
  });
  pairingWindow.loadFile(path.join(__dirname, 'pairingWindow.html'));
  pairingWindow.on('closed', () => {
    pairingWindow = null;
  });
}

ipcMain.handle('get-pairing-info', () => {
  return { pairingToken: config.pairingToken, repoPath: config.repoPath };
});

ipcMain.handle('set-repo-path', (event, repoPath) => {
  config.repoPath = repoPath;
  saveConfig(getConfigPath(), config);
  startRelay();
  return config;
});

app.whenReady().then(() => {
  config = loadConfig(getConfigPath());
  ensurePairingToken();
  startRelay();

  tray = new Tray(path.join(__dirname, '..', 'assets', 'tray-icon.png'));
  tray.setToolTip('Git Relay Agent');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Pairing & Settings', click: openPairingWindow },
      { label: 'Quit', click: () => app.quit() },
    ])
  );
});

app.on('window-all-closed', (event) => {
  event.preventDefault();
});
```

- [ ] **Step 5: Verify `.env` is filled in**

Confirm `laptop-agent/.env` exists (copied from `.env.example` in Task 1) with real `SUPABASE_URL` and `SUPABASE_ANON_KEY` values.

- [ ] **Step 6: Manual verification**

Run: `cd laptop-agent && npm start`
Expected: a tray icon appears in the system tray. Right-click it, choose "Pairing & Settings" — a window opens showing a QR code and a token string in the read-only input. Enter a repo path (e.g. `C:\path\to\your\repo`) in the Repo Path field and click Save — the status text should show "Saved." Quit via the tray menu's "Quit" item and confirm the process exits.

- [ ] **Step 7: Commit**

```bash
git add laptop-agent/src/main.js laptop-agent/src/preload.js laptop-agent/src/pairingWindow.html laptop-agent/assets/tray-icon.png
git commit -m "feat(laptop-agent): add Electron tray app and pairing window"
```

---

### Task 8: Phone app scaffold + relay command helper

**Files:**
- Create: `phone-app/index.html`
- Create: `phone-app/vite.config.js`
- Create: `phone-app/src/main.jsx`
- Create: `phone-app/src/App.jsx`
- Create: `phone-app/src/supabaseClient.js`
- Create: `phone-app/src/relay.js`
- Test: `phone-app/src/relay.test.js`

**Interfaces:**
- Produces: `createSupabaseClient(): SupabaseClient`. `createRelayCommander(channel): { sendCommand(cmd: string, payload?: object, timeoutMs?: number): Promise<object> }`. Consumed by Task 10 (StatusScreen.jsx).

- [ ] **Step 1: Write the failing test**

```js
// phone-app/src/relay.test.js
import { describe, it, expect, vi } from 'vitest';
import { createRelayCommander } from './relay.js';

function createFakeChannel() {
  let responseHandler = null;
  return {
    on: vi.fn((type, filter, handler) => {
      if (filter.event === 'response') {
        responseHandler = handler;
      }
    }),
    send: vi.fn(),
    emitResponse(payload) {
      responseHandler({ payload });
    },
  };
}

describe('createRelayCommander', () => {
  it('resolves when a matching response arrives', async () => {
    const channel = createFakeChannel();
    const { sendCommand } = createRelayCommander(channel);

    const promise = sendCommand('status', {});
    const sentPayload = channel.send.mock.calls[0][0].payload;
    channel.emitResponse({ id: sentPayload.id, ok: true, data: { staged: [] } });

    await expect(promise).resolves.toEqual({ staged: [] });
  });

  it('rejects when response has ok: false', async () => {
    const channel = createFakeChannel();
    const { sendCommand } = createRelayCommander(channel);

    const promise = sendCommand('push', {});
    const sentPayload = channel.send.mock.calls[0][0].payload;
    channel.emitResponse({ id: sentPayload.id, ok: false, error: 'push failed' });

    await expect(promise).rejects.toThrow('push failed');
  });

  it('rejects on timeout', async () => {
    vi.useFakeTimers();
    const channel = createFakeChannel();
    const { sendCommand } = createRelayCommander(channel);

    const promise = sendCommand('status', {}, 50);
    vi.advanceTimersByTime(60);

    await expect(promise).rejects.toThrow('Command timed out');
    vi.useRealTimers();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd phone-app && npx vitest run src/relay.test.js`
Expected: FAIL with "Failed to resolve import './relay.js'"

- [ ] **Step 3: Write minimal implementation**

```js
// phone-app/src/relay.js
export function createRelayCommander(channel) {
  const pending = new Map();

  channel.on('broadcast', { event: 'response' }, ({ payload }) => {
    const { id, ok, data, error } = payload;
    const entry = pending.get(id);
    if (!entry) return;
    pending.delete(id);
    clearTimeout(entry.timer);
    if (ok) {
      entry.resolve(data);
    } else {
      entry.reject(new Error(error));
    }
  });

  function sendCommand(cmd, payload = {}, timeoutMs = 10000) {
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error('Command timed out'));
      }, timeoutMs);

      pending.set(id, { resolve, reject, timer });

      channel.send({
        type: 'broadcast',
        event: 'command',
        payload: { id, cmd, payload },
      });
    });
  }

  return { sendCommand };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd phone-app && npx vitest run src/relay.test.js`
Expected: PASS (3 tests)

- [ ] **Step 5: Write the remaining scaffold files**

```js
// phone-app/src/supabaseClient.js
import { createClient } from '@supabase/supabase-js';

export function createSupabaseClient() {
  return createClient(
    import.meta.env.VITE_SUPABASE_URL,
    import.meta.env.VITE_SUPABASE_ANON_KEY
  );
}
```

```jsx
// phone-app/src/App.jsx
import React from 'react';

export default function App() {
  return <h1>Git Relay</h1>;
}
```

```jsx
// phone-app/src/main.jsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
```

```html
<!-- phone-app/index.html -->
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
    <title>Git Relay</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
```

```js
// phone-app/vite.config.js
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
});
```

- [ ] **Step 6: Verify `.env` is filled in, then manually check the dev server**

Confirm `phone-app/.env` exists (copied from `.env.example` in Task 1) with real `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` values.

Run: `cd phone-app && npm run dev`
Expected: Vite starts on a local port; opening it in a browser shows an "Git Relay" heading with no console errors.

- [ ] **Step 7: Commit**

```bash
git add phone-app/index.html phone-app/vite.config.js phone-app/src/main.jsx phone-app/src/App.jsx phone-app/src/supabaseClient.js phone-app/src/relay.js phone-app/src/relay.test.js
git commit -m "feat(phone-app): scaffold Vite/React app and relay command helper"
```

---

### Task 9: Phone app pairing screen

**Files:**
- Create: `phone-app/src/pairing/PairingScreen.jsx`
- Modify: `phone-app/src/App.jsx`

**Interfaces:**
- Consumes: none (pure UI component taking an `onPaired(token: string)` callback prop).
- Produces: `PairingScreen` component. Consumed by `App.jsx` (this task) and remains used by Task 10.

No automated test — camera/DOM-heavy UI component, verified manually per the spec's testing approach.

- [ ] **Step 1: Write `phone-app/src/pairing/PairingScreen.jsx`**

```jsx
import React, { useState, useRef } from 'react';
import { Html5Qrcode } from 'html5-qrcode';

export default function PairingScreen({ onPaired }) {
  const [manualToken, setManualToken] = useState('');
  const [scanning, setScanning] = useState(false);
  const scannerRef = useRef(null);

  function submitManualToken(event) {
    event.preventDefault();
    if (manualToken.trim()) {
      onPaired(manualToken.trim());
    }
  }

  async function startScan() {
    setScanning(true);
    const scanner = new Html5Qrcode('qr-reader');
    scannerRef.current = scanner;
    await scanner.start(
      { facingMode: 'environment' },
      { fps: 10, qrbox: 250 },
      async (decodedText) => {
        await scanner.stop();
        setScanning(false);
        onPaired(decodedText.trim());
      },
      () => {}
    );
  }

  async function cancelScan() {
    if (scannerRef.current) {
      await scannerRef.current.stop();
    }
    setScanning(false);
  }

  return (
    <div>
      <h1>Pair with your laptop</h1>
      <p>Scan the QR code shown in the tray app, or enter the token manually.</p>

      {!scanning && <button onClick={startScan}>Scan QR Code</button>}
      {scanning && (
        <div>
          <div id="qr-reader" style={{ width: '100%' }} />
          <button onClick={cancelScan}>Cancel</button>
        </div>
      )}

      <form onSubmit={submitManualToken}>
        <input
          value={manualToken}
          onChange={(event) => setManualToken(event.target.value)}
          placeholder="Paste pairing token"
        />
        <button type="submit">Pair</button>
      </form>
    </div>
  );
}
```

- [ ] **Step 2: Update `phone-app/src/App.jsx` to use it**

```jsx
// phone-app/src/App.jsx
import React, { useState } from 'react';
import PairingScreen from './pairing/PairingScreen.jsx';

function loadStoredToken() {
  return localStorage.getItem('git-relay-token') || null;
}

export default function App() {
  const [token, setToken] = useState(loadStoredToken());

  function handlePaired(newToken) {
    localStorage.setItem('git-relay-token', newToken);
    setToken(newToken);
  }

  if (!token) {
    return <PairingScreen onPaired={handlePaired} />;
  }
  return <p>Paired! Repo status UI coming in the next task.</p>;
}
```

- [ ] **Step 3: Manual verification**

Run: `cd phone-app && npm run dev`
Expected: opening the app shows the pairing screen. Type any text into "Paste pairing token" and click "Pair" — the screen should switch to "Paired! Repo status UI coming in the next task." Reload the page — it should stay on that message (token persisted in localStorage). Clear localStorage (dev tools → Application → Local Storage) and reload to confirm it goes back to the pairing screen.

- [ ] **Step 4: Commit**

```bash
git add phone-app/src/pairing/PairingScreen.jsx phone-app/src/App.jsx
git commit -m "feat(phone-app): add pairing screen with QR scan and manual token entry"
```

---

### Task 10: Phone app status/diff/stage/commit/push screen

**Files:**
- Create: `phone-app/src/status/StatusScreen.jsx`
- Modify: `phone-app/src/App.jsx`

**Interfaces:**
- Consumes: `createSupabaseClient` (Task 8's `supabaseClient.js`), `createRelayCommander` (Task 8's `relay.js`). Takes a `token: string` prop (the pairing token / channel name).
- Produces: `StatusScreen` component. Consumed by `App.jsx` (this task).

No automated test — this component depends on a live Supabase Realtime connection and the laptop agent being online; verified manually in Task 12's end-to-end test.

- [ ] **Step 1: Write `phone-app/src/status/StatusScreen.jsx`**

```jsx
import React, { useEffect, useRef, useState } from 'react';
import { createSupabaseClient } from '../supabaseClient.js';
import { createRelayCommander } from '../relay.js';

export default function StatusScreen({ token }) {
  const [online, setOnline] = useState(false);
  const [status, setStatus] = useState({ staged: [], unstaged: [], untracked: [] });
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [diffText, setDiffText] = useState('');
  const [diffFile, setDiffFile] = useState(null);
  const [commitMessage, setCommitMessage] = useState('');
  const [errorText, setErrorText] = useState('');
  const commanderRef = useRef(null);
  const channelRef = useRef(null);

  useEffect(() => {
    const supabase = createSupabaseClient();
    const channel = supabase.channel(token, {
      config: { presence: { key: 'phone' } },
    });
    channelRef.current = channel;
    commanderRef.current = createRelayCommander(channel);

    channel.on('presence', { event: 'sync' }, () => {
      const state = channel.presenceState();
      setOnline(Boolean(state.laptop && state.laptop.length > 0));
    });

    channel.subscribe(async (subscribeStatus) => {
      if (subscribeStatus === 'SUBSCRIBED') {
        await channel.track({ online_at: new Date().toISOString() });
      }
    });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [token]);

  async function refreshStatus() {
    setErrorText('');
    try {
      const result = await commanderRef.current.sendCommand('status');
      setStatus(result);
      setSelectedFiles([]);
    } catch (error) {
      setErrorText(error.message);
    }
  }

  async function viewDiff(file, staged) {
    setErrorText('');
    try {
      const result = await commanderRef.current.sendCommand('diff', { file, staged });
      setDiffFile(file);
      setDiffText(result.diff);
    } catch (error) {
      setErrorText(error.message);
    }
  }

  function toggleFile(file) {
    setSelectedFiles((current) =>
      current.includes(file) ? current.filter((f) => f !== file) : [...current, file]
    );
  }

  async function stageSelected() {
    setErrorText('');
    try {
      await commanderRef.current.sendCommand('stage', { files: selectedFiles });
      await refreshStatus();
    } catch (error) {
      setErrorText(error.message);
    }
  }

  async function commit() {
    setErrorText('');
    try {
      await commanderRef.current.sendCommand('commit', { message: commitMessage });
      setCommitMessage('');
      await refreshStatus();
    } catch (error) {
      setErrorText(error.message);
    }
  }

  async function push() {
    setErrorText('');
    try {
      await commanderRef.current.sendCommand('push', {}, 30000);
    } catch (error) {
      setErrorText(error.message);
    }
  }

  return (
    <div>
      <h1>Git Relay</h1>
      <p>Laptop: {online ? 'Online' : 'Offline'}</p>
      {errorText && <p style={{ color: 'red' }}>{errorText}</p>}

      <button onClick={refreshStatus} disabled={!online}>Refresh Status</button>

      <h2>Unstaged / Untracked</h2>
      <ul>
        {[...status.unstaged, ...status.untracked].map((file) => (
          <li key={file}>
            <label>
              <input
                type="checkbox"
                checked={selectedFiles.includes(file)}
                onChange={() => toggleFile(file)}
              />
              {file}
            </label>
            <button onClick={() => viewDiff(file, false)}>View diff</button>
          </li>
        ))}
      </ul>
      <button onClick={stageSelected} disabled={selectedFiles.length === 0}>
        Stage selected
      </button>

      <h2>Staged</h2>
      <ul>
        {status.staged.map((file) => (
          <li key={file}>
            {file}
            <button onClick={() => viewDiff(file, true)}>View diff</button>
          </li>
        ))}
      </ul>

      {diffFile && (
        <div>
          <h3>Diff: {diffFile}</h3>
          <pre>{diffText}</pre>
        </div>
      )}

      <h2>Commit</h2>
      <textarea
        value={commitMessage}
        onChange={(event) => setCommitMessage(event.target.value)}
        placeholder="Commit message"
      />
      <button onClick={commit} disabled={status.staged.length === 0 || !commitMessage.trim()}>
        Commit
      </button>

      <button onClick={push}>Push</button>
    </div>
  );
}
```

- [ ] **Step 2: Update `phone-app/src/App.jsx` to use it**

```jsx
// phone-app/src/App.jsx
import React, { useState } from 'react';
import PairingScreen from './pairing/PairingScreen.jsx';
import StatusScreen from './status/StatusScreen.jsx';

function loadStoredToken() {
  return localStorage.getItem('git-relay-token') || null;
}

export default function App() {
  const [token, setToken] = useState(loadStoredToken());

  function handlePaired(newToken) {
    localStorage.setItem('git-relay-token', newToken);
    setToken(newToken);
  }

  if (!token) {
    return <PairingScreen onPaired={handlePaired} />;
  }
  return <StatusScreen token={token} />;
}
```

- [ ] **Step 3: Manual verification**

Run: `cd phone-app && npm run dev`, and separately `cd laptop-agent && npm start` (with a repo path already configured from Task 7). Pair the phone app with the token shown in the tray app's pairing window. Expected: the phone app shows "Laptop: Online" within a few seconds. Full command-by-command verification (status/stage/commit/push) happens in Task 12.

- [ ] **Step 4: Commit**

```bash
git add phone-app/src/status/StatusScreen.jsx phone-app/src/App.jsx
git commit -m "feat(phone-app): add status/diff/stage/commit/push screen"
```

---

### Task 11: PWA manifest & deployment

**Files:**
- Modify: `phone-app/vite.config.js`
- Create: `phone-app/public/icon-192.png` (manual — see Step 1)
- Create: `phone-app/public/icon-512.png` (manual — see Step 1)

**Interfaces:**
- Consumes: none new.
- Produces: a deployed, installable PWA at a public URL. No further tasks depend on this.

- [ ] **Step 1: Add PWA icon images**

Create `phone-app/public/icon-192.png` (192x192) and `phone-app/public/icon-512.png` (512x512) — any square PNG icons work; these are required binary assets that can't be authored as text.

- [ ] **Step 2: Update `phone-app/vite.config.js`**

```js
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Git Relay',
        short_name: 'GitRelay',
        start_url: '/',
        display: 'standalone',
        background_color: '#ffffff',
        theme_color: '#111111',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
    }),
  ],
});
```

- [ ] **Step 3: Verify the production build**

Run: `cd phone-app && npm run build`
Expected: build completes with no errors, and `phone-app/dist/manifest.webmanifest` (or `manifest.json`, depending on the plugin version) exists in the output.

- [ ] **Step 4: Deploy to Vercel (free tier)**

Run: `cd phone-app && npx vercel login` (follow the browser login prompt)
Run: `npx vercel --prod` and accept the defaults when prompted (framework: Vite).

In the Vercel dashboard, go to the new project → **Settings → Environment Variables**, add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` with the same values from `phone-app/.env`, then redeploy so the build picks them up: `npx vercel --prod`.

Expected: Vercel prints a public HTTPS URL. Opening it on your phone browser shows the pairing screen, and your phone offers "Add to Home Screen" (confirms the PWA manifest is valid).

- [ ] **Step 5: Commit**

```bash
git add phone-app/vite.config.js phone-app/public/icon-192.png phone-app/public/icon-512.png
git commit -m "feat(phone-app): add PWA manifest and deploy to Vercel"
```

---

### Task 12: End-to-end manual verification

**Files:** none (verification only).

**Interfaces:** none — this task exercises the full system built in Tasks 1-11.

- [ ] **Step 1: Prepare a scratch test repo with a real GitHub remote**

Create (or reuse) a small test repo on GitHub that you have push access to, clone it locally, and note its local path.

- [ ] **Step 2: Start the laptop agent against the test repo**

Run: `cd laptop-agent && npm start`. Open "Pairing & Settings" from the tray, set the Repo Path field to the test repo's local path, click Save.

- [ ] **Step 3: Pair the phone app**

Open the deployed Vercel URL (or `npm run dev` and expose it on your phone's network) on your phone. Scan the QR code from the tray app's pairing window (or type the token manually). Confirm the phone shows "Laptop: Online".

- [ ] **Step 4: Make a real change on the laptop**

Edit a file in the test repo locally (e.g. add a line to a text file) — simulating a change written by hand or by Claude Code.

- [ ] **Step 5: Exercise the full flow from the phone**

Tap "Refresh Status" — the changed file should appear under Unstaged/Untracked. Tap "View diff" — confirm the diff text matches your edit. Check the file's checkbox and tap "Stage selected" — it should move to the Staged list. Enter a commit message and tap "Commit" — the Staged list should clear. Tap "Push".

- [ ] **Step 6: Verify on GitHub**

Open the test repo on GitHub.com (or `git log` locally) and confirm the new commit is present on the remote with the message you entered from the phone.

- [ ] **Step 7: Record the result**

If all steps pass, the Phase 1 MVP is complete. If any step fails, note which step and the exact error text shown on the phone or in the tray app — this becomes the starting point for a follow-up debugging task rather than a plan change.

---

## Self-Review Notes

- **Spec coverage:** pairing (Tasks 2, 7, 9), single registered repo (Task 3, 7), status/diff (Tasks 4, 6, 10), stage/commit/push (Tasks 5, 6, 10), presence/liveness indicator (Task 10), Supabase Realtime relay instead of self-hosted server (Tasks 6, 8, 10), error handling as plain-text relay (Task 6's `handleCommand` catch path, Task 10's `errorText` state) — all Phase 1 MVP requirements from the spec are covered. PR creation and multi-repo (Phase 2/3) are intentionally excluded per Global Constraints.
- **Placeholder scan:** no TBD/TODO markers; the two "manual" steps (tray icon PNG, PWA icon PNGs) are legitimate binary-asset requirements, not deferred logic — all code in every task is complete and runnable.
- **Type/signature consistency:** `getStatus`/`getDiff`/`stageFiles`/`commitChanges`/`pushChanges` signatures in Tasks 4-5 match their usage in Task 6's `handleCommand`. `createRelayCommander`'s `sendCommand` signature in Task 8 matches its usage in Task 10's `StatusScreen`. Command names (`status`, `diff`, `stage`, `commit`, `push`) are consistent between Task 6 (laptop dispatch) and Task 10 (phone calls).
