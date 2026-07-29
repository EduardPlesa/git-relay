# Security Policy

## Reporting a vulnerability

Report privately through GitHub's [Report a vulnerability](https://github.com/EduardPlesa/git-relay/security/advisories/new)
form. Please don't open a public issue for a security bug.

Include what you can: affected component (`laptop-agent` or `phone-app`), the
version or commit, and the steps to reproduce. Expect a first response within a
week.

## What this project does, in security terms

Git Relay lets a phone execute a fixed set of git operations against
repositories on a laptop, brokered through a Supabase Realtime channel. Both
sides connect outbound; nothing listens for inbound connections and no source
code passes through the relay.

## Threat model

**The pairing token is the only credential.** It is 24 bytes from
`crypto.randomBytes`, and it *is* the Realtime channel name. The agent executes
any well-formed command that arrives on that channel — there is no second
authentication factor, no request signing, and no replay protection.

Anyone holding the token can, against **every** repository registered in the
tray app:

- read file contents through `diff`, and read history through `log`
- stage, commit, and `push` — using your git credentials, to your remotes
- `pull`, which can execute repository hooks
- `discard` an unstaged or untracked file, which is not recoverable
- create, check out, and delete local branches

Treat the token exactly like a password. The **Unpair** action in the phone's
connection switcher forgets it on that device; to invalidate it everywhere,
delete `pairingToken` from `~/.git-relay-agent/config.json` and restart the tray
app, which mints a new one.

**The Supabase anon key is public, by design.** `VITE_SUPABASE_ANON_KEY` is
compiled into the phone app's JavaScript bundle — anyone who loads the page has
it. That is what an anon key is for, but it has consequences:

- Use a **dedicated Supabase project** for Git Relay. Do not reuse one that
  holds anything else.
- Enable **row level security on every table** in that project. A table without
  RLS is readable and writable by anyone with the published key.
- Enable [Realtime Authorization](https://supabase.com/docs/guides/realtime/authorization)
  (an RLS policy on `realtime.messages`) so holders of the key cannot subscribe
  to or broadcast on arbitrary channels in your project.

Knowing the anon key does not by itself reveal a pairing token, and the token is
not guessable, so the channel itself stays private. The concern is the rest of
the project the key unlocks.

**Out of scope.** An attacker with the pairing token, or with local access to
the laptop running the agent, is assumed to have already won — those are the
trust boundaries, not vulnerabilities in them.

## Supported versions

The project is pre-1.0. Only the latest commit on `master` receives fixes.
