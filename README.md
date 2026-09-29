<div align="center">

# Devian

**Stay in control of the AI agents working on your machine.**

Devian shows what Claude Code, Codex, OpenCode, Cursor and Antigravity actually did: every session,
command and file change, the servers they left running, what they remember, and how many tokens they used.
It reads the agents' own local history and never sends it anywhere.

[Website](https://devian.app) · [Download](https://github.com/devian-labs/devian/releases/latest) · [Contributing](CONTRIBUTING.md)

</div>

---

## Features

- **Sessions**: one timeline across all your agents. Prompts, every command run, every file edited. Risky actions (force push, `sudo`, `rm -rf` outside the project, `curl | sh`, `.env` edits, global installs) are flagged.
- **Runtime**: processes, ports and Docker containers traced back to the agent session that started them. Anything still running after the session ended shows up as a leftover you can stop in one click.
- **Memory**: everything agents load into context. Claude Code auto-memory, `CLAUDE.md` / `AGENTS.md` / `GEMINI.md`, Cursor rules, Codex memories, Antigravity knowledge. Read it, edit it in the built-in editor, forget what's wrong.
- **Usage**: tokens per day, agent, project and model, including cache reads and writes, with API-equivalent spend at list prices.
- **Plan limits**: Claude and Codex 5-hour and weekly limits with reset times, in the top bar. Opt-in per account.
- **Multiple Claude accounts**: every Claude Code config folder (`~/.claude`, `~/.claude-work`, `~/.claude-bedrock`, …) shows up as its own account. Include or exclude each in Settings → Accounts.
- **Hardware bar**: CPU, memory, temperature, disk and battery, always visible, with how much your agents are using.
- **Cleanup**: old transcripts, rewind checkpoints, undo snapshots and editor caches, plus `node_modules`, build artifacts and Docker leftovers.
- **MCP server**: `devian-desktop --mcp` gives agents read-only tools (`list_dev_servers`, `get_free_port`, `project_runtime`, `agent_leftovers`, `recent_agent_activity`), so they check what's running instead of guessing.
- **Projects**: repositories with git status, scripts, `.env` files and dependency health.

Everything is free. There are no accounts, license keys or feature limits.

### Agent support

| Agent | Sessions & commands | Tokens | Memory |
|---|---|---|---|
| Claude Code | full | full | auto-memory, `CLAUDE.md`, rules |
| Codex | full | full | memories, `AGENTS.md` |
| OpenCode | full | full (plus recorded cost) | `AGENTS.md` |
| Cursor | partial (local composer history) | partial | `.cursor/rules`, `.cursorrules` |
| Antigravity | plans, tasks and walkthroughs | not stored locally | `GEMINI.md`, knowledge items |

## Install

### macOS (Homebrew)

This repository is also a Homebrew tap:

```bash
brew tap devian-labs/devian https://github.com/devian-labs/devian
brew install --cask devian-desktop
```

The app isn't notarized yet. If macOS refuses to open it:

```bash
xattr -dr com.apple.quarantine /Applications/Devian.app
```

### Direct download

Grab the `.dmg` (macOS, Apple Silicon), `.exe` (Windows 10+) or `.deb` / `.AppImage` (Linux) from the [latest release](https://github.com/devian-labs/devian/releases/latest).

## Repository layout

```
apps/
  desktop/        Tauri 2 app — React + Vite frontend, Rust backend (src-tauri/)
  landing/        devian.app — Next.js marketing site and blog
Casks/            Homebrew cask (this repo doubles as a tap)
scripts/          Release tooling
.github/          CI, release pipeline, issue templates
```

## Development

Prerequisites: Node.js 20+, a stable Rust toolchain, and the [Tauri system dependencies](https://v2.tauri.app/start/prerequisites/) for your OS.

```bash
npm install              # installs every workspace

npm run desktop:dev      # run the desktop app with hot reload
npm run desktop:build    # produce a native bundle for your platform
npm run landing:dev      # run the website on http://localhost:3000
npm run build            # type-check and build all workspaces
```

No environment variables are needed. See [`apps/desktop/.env.example`](apps/desktop/.env.example) for the optional ones.

## Connect your agents (MCP)

Settings → *Agents* connects Claude Code, Codex, Cursor and Antigravity in one click and shows a snippet for OpenCode. Config files are backed up (`*.devian-backup`) before Devian edits them. On macOS, move Devian into Applications first: an app opened from the disk image or Downloads runs from a temporary location, and Devian won't write that path into your agents' configs.

To add it by hand, e.g. Claude Code with the Homebrew install (the DMG installs to `Devian Desktop.app` instead):

```bash
claude mcp add devian --scope user -- /Applications/Devian.app/Contents/MacOS/devian-desktop --mcp
```

The server is read-only: it can report on processes, ports and sessions, but it can't stop or change anything.

## Safety

- Agent history is only read, never modified.
- Cleanup and *Forget* move files to the Trash, so everything can be restored.
- Stopping several items, or anything matched by inference rather than a direct parent/child link, asks for confirmation first.
- Project files (`CLAUDE.md`, `AGENTS.md`, rules) are never deleted by Devian; open them in your editor instead.

## Privacy

Devian runs entirely on your machine. Agent data is read in place and never uploaded. The app checks GitHub for updates. If you turn on plan limits for an account, Devian sends that account's existing Claude Code or Codex login straight to Anthropic or OpenAI to read your usage; it never stores, refreshes or sends the token anywhere else. Official builds include **opt-in** anonymous usage data and error reports (PostHog), off until you enable them during onboarding or in Settings → Privacy. Crash reports stay on your machine until you choose to send one. Builds from source contain no analytics at all unless you supply your own key. Code, file contents, prompts and agent history are never sent. [PRIVACY.md](PRIVACY.md) lists every network request and every event.

## Contributing

Bug reports, feature ideas and pull requests are welcome — start with [CONTRIBUTING.md](CONTRIBUTING.md). Please follow the [Code of Conduct](CODE_OF_CONDUCT.md), and report security issues privately as described in [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE) © Devian Labs
