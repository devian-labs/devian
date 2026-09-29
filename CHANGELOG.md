# Changelog

## 2.0.0

Devian is now a control center for the AI coding agents on your machine: Claude Code, Codex, OpenCode, Cursor and Antigravity.

### New

- **Sessions**: one timeline across every agent. Prompts, each command run and each file changed. Risky actions (force push, `sudo`, `rm -rf` outside the project, `curl | sh`, `.env` edits, global installs) are flagged, and you can mark sessions as reviewed.
- **Runtime**: processes, ports and Docker containers traced back to the agent session that started them. Anything still running after the session ended is listed as a leftover, with an optional notification.
- **Memory**: read, edit or forget what agents load into context: Claude Code auto-memory, `CLAUDE.md` / `AGENTS.md` / `GEMINI.md`, Cursor rules, Codex memories and Antigravity knowledge.
- **Usage**: tokens per day, agent, project and model, including cache reads and writes, with API-equivalent spend at Anthropic's list prices.
- **Plan limits**: your Claude and Codex 5-hour and weekly limits and their reset times, in the top bar and on Usage. Off by default and turned on per account.
- **Multiple Claude accounts**: every Claude Code config folder (`~/.claude`, `~/.claude-work`, …) is found and labelled with its account. Include or exclude each one in Settings → Accounts.
- **Memory editor**: edit memory files in the app, with conflict detection if an agent writes the same file, and a history of previous versions in `~/.devian/memory-history`.
- **Hardware bar**: CPU, memory, temperature, disk and battery always visible in the top right, with how much of it your agents are using.
- **Cleanup for agent data**: old transcripts, rewind checkpoints, undo snapshots and editor caches, alongside the existing `node_modules` and Docker cleanup.
- **MCP server**: `devian-desktop --mcp` gives agents read-only tools to see running dev servers, get a free port and check what other agents did in a project. Connect it from Settings in one click.
- A new first-run setup that shows what your agents have been doing, and a setup checklist on Overview.

### Changed

- No permissions are required to start. Full Disk Access is now optional and only helps the Projects scanner.
- Cleanup and Forget move files to the Trash instead of deleting them.
- The local-model chat assistant has been removed. The optional local model is still available for project summaries.
- New navigation: Overview, Sessions, Runtime, Memory, Usage, Cleanup, Projects. Use ⌘K to search, ⌘1–⌘7 to switch sections and ⌘B to collapse the sidebar.
- Settings is now a searchable window with General, Appearance, Accounts, Agents, Notifications and Keyboard sections, plus accessibility options: text size, reduced motion, higher contrast and always-visible focus rings.
- Devian can launch at login.
- Every feature is free. There are no accounts or license keys.
- **Feedback and error reporting**: send feedback from the sidebar or Settings, with a preview of exactly what's included. If a screen breaks, only that screen shows an error, with a button to report it. Backend crashes are saved locally and Devian offers to send them on the next launch.
- Usage data is now stricter: no automatic capture, no remote scripts, and every event is filtered to remove names, paths and emails. See [PRIVACY.md](PRIVACY.md).

### Notes

- Cursor keeps most history in its cloud and Antigravity stores transcripts in an encoded format, so their sessions are partial.
- Everything is read locally. Code, prompts and agent history never leave your machine. The only network calls are update checks and, if you turn them on, plan-limit requests sent straight to Anthropic or OpenAI with the login Claude Code or Codex already saved. Devian never stores or refreshes those tokens.
- Windows and Linux builds are available for testing.
