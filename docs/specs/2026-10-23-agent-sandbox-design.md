# Agent sandbox

Status: design, not built. Nothing here is claimed anywhere until it ships (see Claims).

## Why

The guard (core/src/guard.ts) judges each tool call's text. Five reviews in one day found spellings that slip past it:
`cd` chains, globs, `$(…)`, symlinks, programs that run programs. That class closes only below the text: every agent
process Overhand starts (`runOnce` in core/src/claude.ts, `startLead` in core/src/leads.ts, both via `recordSpawn`)
runs under the OS sandbox, so a write outside its run's places fails however it was spelled. Your own sessions, started
by you, are out of scope.

## Policy

`sandboxPolicy(run)` in core/src/sandbox.ts returns `{ write, deny, hide }` path lists; per-OS builders turn them into a
profile, and the same lists feed the tests and the claims.

**Writes allowed:**

- The run's folder: a ticket run's worktree; a lead's project checkout (leads run in the project itself).
- For a worktree, what git writes in the main repo's git dir (spike: commit, fetch, push, switch, stash):
  `worktrees/<name>/`, `objects/`, `refs/`, `logs/`, `packed-refs`, and `gc.pid`/`gc.log` (auto-gc failed without them).
- A per-run TMPDIR; package and tool caches (bun, npm, pnpm, yarn, pip/uv, cargo, go), each path cited as
  cleanup-sources.ts does.
- The CLI's own state folder: `agent-home/<cli>` or the account's own folder for Claude Code (never `~/.claude*`);
  `~/.codex`, `~/.gemini`, `~/.cursor`, `~/.local/share/opencode` for the other CLIs on their own login, their config
  files denied below.
- `<OPS>/slots` (governor locks) and a new `<OPS>/from-runs/<run>/` outbox: the guard hook runs inside the agent's
  sandbox, so its block-log lines and beats go there and the daemon ingests them as untrusted.

**Writes denied, even inside an allowed folder** (a later deny wins, spike-confirmed):

- What controls the guard or your sessions: each CLI's settings, hooks, plugins, skills, agents, commands and
  instructions (`~/.claude/settings*.json`, `~/.claude/{hooks,plugins,skills,agents,commands}`, and per CLI); in
  projects, `.claude/settings*.json` and what `AGENT_CONFIG` names; every `selfPaths()` entry.
- `.git/config`, `.git/hooks/`, `.git/info/`: code that runs later outside any sandbox. `git push -u` still pushes
  but can't record the upstream (spike: exit 0, a warning).
- Everything not allowed: other projects, shell startup files, `~/.ssh`, `~/.gitconfig`, LaunchAgents, systemd user
  units.
- **Each denied path's ancestors up to the allowed root, as literals.** In the spike `mv .git .gitx` and
  `mv .claude .claudex` escaped denies on `.git/config` and `.claude/settings.json`; denying the parent folder itself
  stopped the rename and left its other files writable. Hard links to a denied file were refused.

**Reads:** broad (toolchains, repo, `node_modules`), hiding the guard's credential `PATH_RULES` list (`~/.aws`,
`~/.config/gcloud`, `~/.azure`, `~/.npmrc`, private keys in `~/.ssh`), `OVERHAND_SECRETS_FILE` and the API token below.
`~/.config/gh` and ssh-agent stay readable for launch (owner's decision): agents push and open PRs themselves
(autonomy.ts tells them to run `gh pr create`), so an agent can read the GitHub token, and `SANDBOX_LIMIT` says so.
Later, after launch: the daemon pushes and opens the PR after each run (agent.ts already does for some runs), and the
sandbox then hides `~/.config/gh` and the ssh keys too.

**Config folders (owner's decision):** every run, leads included, uses an Overhand-managed CLI config folder
(agent-home.ts, `ownSignInHome`/`existingHome`), never your own `~/.claude` or `~/.claude.json`, so no run can change
the MCP servers your own sessions start. Leads on your own config today move over with a one-time sign-in prompt in
the app. Your own `~/.claude*` is then simply outside every run's write list.

**Network: allowed.** Agents need model APIs, registries and git remotes; no host filtering. One exception: the
daemon. The spike reached its port 127.0.0.1:4317 from inside, and the API trusted any local caller, so an agent could
change its own autonomy with `curl`. Fixed first (P0, built): every local call needs the install's local key
(`control/local-key`, 0600): the CLI reads it, a browser trades a one-time open link (`overhand open`) for a cookie
made from it. That stops other programs and web pages, not agents: until the sandbox hides the file, an agent running
as you can read it. Hiding it works on Linux too, where bwrap can't block one port of a shared network.

## Per OS

**macOS, `sandbox-exec`:** `(allow default)`, `(deny file-write* (subpath "/"))`, the allow list, the deny list with
ancestors, `file-read*` denies, `network-outbound` denies for the daemon port and unix sockets other than
`SSH_AUTH_SOCK`, and `mach-lookup` denies for LaunchServices and Apple Events (`open`, or `osascript` telling Terminal
to run something, asks a process outside to act; untested, the escape suite must show it). Nested `sandbox-exec` fails
(`sandbox_apply: Operation not permitted`), so with ours on, Codex runs `--sandbox danger-full-access` and the other
CLIs' own sandboxes are dropped: one sandbox, ours. Apple has deprecated `sandbox-exec`; if it goes, macOS falls back.

**Linux, bubblewrap:** `--ro-bind / /`, `--bind` each writable folder, `--ro-bind` each denied path on top (a mount
point can't be renamed, so no ancestor problem), `--tmpfs` over hidden folders, per-run `/tmp`, `--unshare-user
--unshare-pid --unshare-ipc --die-with-parent --new-session`, network shared. A denied path that doesn't exist yet gets
an empty mount point bwrap creates; the daemon removes it after the run.

**Docker:** the default seccomp profile (and Ubuntu 24.04's AppArmor on hosts) usually block unprivileged user
namespaces, so bwrap fails; the container is the boundary and the fallback applies.

**Unavailable:** a startup probe runs `true` and one denied write inside. macOS fails closed (the probe failing there
is a bug): runs stop, Settings says why. Linux and Docker run on the guard only, and Settings, Health and each run card
say "Sandbox off on this machine: reason, fix". Refusing every server without user namespaces would shut out the users
who most want headless runs; saying so plainly keeps it honest (owner's decision). A setting makes Linux refuse instead.

## With the guard

The guard keeps intent: autonomy and watch, Ship, merges, protected-branch and force pushes, deploys, publishing, house
rules, quiet mode. The sandbox holds what text can't: Overhand's files, other projects, guard config, startup files.
Run identity stays in `control/runs.json`, now unwritable by runs too. Path rules stay as a second layer with a clear
message.

## Tests

- `sandbox.test.ts`: the policy per run kind (ticket worktree, lead in its project, Overhand's own lead inside OPS, another
  CLI on its own login); each allow line has a case that fails without it.
- Escape suite inside the real sandbox, macOS and Linux CI, scratch home. Must fail: write OPS files, another project,
  `~/.claude/settings.json`, `.claude/settings.local.json`, `.git/config`, `.git/hooks/pre-commit`, `~/.zshrc`,
  LaunchAgents, systemd user units; rename an ancestor, hard link or symlink to each; read an ssh key, the secrets file,
  the API token; reach the daemon port; `open`/`osascript`. Must pass: worktree and cache writes, `bun --version`,
  `bun install` from cache, `git commit`/`fetch`/`push`/`switch`/`stash`/`gc` in a worktree, curl to a registry.
- Probe: fails closed on macOS without `sandbox-exec`; reports off on Linux without user namespaces.

## Claims

`SANDBOX_COVERAGE` and `SANDBOX_LIMIT` in contract/src/sandbox.ts, built like `GUARD_COVERAGE`: one source for
Settings, README, SECURITY and the site, held there by a test; a machine's line comes from its probe. `SANDBOX_LIMIT`
names what it can't stop: what's sent over the network, the GitHub token gh holds, Keychain and Secret Service items
(the CLIs' logins live there), code the agent writes into the repo that you later run, CPU and memory, OS bugs, and
machines where it's off. `GUARD_LIMIT` changes only when the sandbox ships.

## Rollout

1. PRs in order, security review on each of the first three: P0 API token; P1 sandbox.ts, probe, outbox, macOS escape
   suite; P2 Linux; P3 claims and Settings.
2. Shadow mode on the owner's machine: denies become `(allow … (with report))`, violations read from the unified log
   over a few days of real leads; the allow list is fixed from that, not by guess.
3. Enforce for new spawns only: running leads keep their process and get it at their next restart. One switch turns it
   off.
4. Linux server with and without user namespaces, the Docker image, then on by default.

## Decided (owner, 2026-10-23)

1. Agents keep pushing and opening PRs themselves for launch; the daemon takes push and PR over after launch.
2. Every run uses an Overhand-managed config folder; leads on your own Claude config move over with a one-time
   sign-in prompt.
3. Linux and Docker without user namespaces run on the guard only, with a plain warning in Settings and the docs; a
   setting makes them refuse.
