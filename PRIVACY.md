# Privacy

Devian reads your AI agents' history, memory and processes on your machine. None of that leaves your machine. This page lists every network request the app makes and everything it can send, so you can check it against the code.

## Network requests

| When | Where | What's sent |
| --- | --- | --- |
| On launch and periodically | `github.com/devian-labs/devian/releases` | A request for the update manifest. Nothing about you. |
| Only if you turn on plan limits for an account | `api.anthropic.com` (Claude) or `chatgpt.com` (Codex) | The login Claude Code or Codex already saved on this machine, to read your usage. Never stored, logged or refreshed by Devian. See [SECURITY.md](SECURITY.md#credentials). |
| Only if you download the optional local model | `huggingface.co`, `api.github.com` | Downloads of the model and llama.cpp. |
| Only if you opt in to usage data | PostHog (`us.i.posthog.com`) | The events below. |
| Only when you press **Send** in the feedback window | PostHog | Your message, and the diagnostics shown in the window if the box is ticked. |

Dependency checks in Projects run your own tools (`npm outdated`, `cargo audit`, …) in the project folder; those tools make their own requests.

Builds from source have no analytics key, so the usage data and feedback rows above don't exist there: feedback opens a GitHub issue instead.

## Usage data and error reports (opt-in)

Off by default. You can turn it on during setup or in **Settings → Privacy & data**, and off again at any time.

When it's on, Devian sends only events it names in code: no automatic click or page capture, no session recording, no remote scripts or feature flags, and no person profiles. Every event goes through a filter (`src/lib/telemetry.ts`) that drops fields like `name`, `path` and `project`, replaces home folders with `~`, and removes emails and anything that looks like a key.

| Event | Properties |
| --- | --- |
| `screen_view`, `tab_viewed` | which screen |
| `onboarding_step`, `onboarding_completed` | step; which agents are installed |
| `leftovers_stopped` | count, from which screen |
| `memory_saved`, `memory_forgotten` | whether saving overrode a conflict; which agents use the memory |
| `agent_data_cleaned`, `cleanup_completed` | number of items, bytes freed, which cleanup categories |
| `mcp_connected` | which agent |
| `limits_toggled` | provider (claude or codex), on or off |
| `projects_scanned`, `project_opened`, `project_archived`, `project_deleted`, `project_detail_viewed`, `dependency_folder_deleted`, `dependencies_clean_all`, `patch_update_completed`, `repository_insights_analyzed`, `script_started`, `script_stopped`, `process_killed` | counts, sizes, success, how a project was opened |
| `settings_saved` | chosen terminal and editor app |
| `feedback_opened`, `feedback_nudge`, `crash_report_opened` | feedback type, which button |
| `$exception` | error type, message and stack, filtered as above |

Never sent: code, file contents, prompts, agent transcripts, memory contents, project or file names, paths, commands, environment variables, or credentials.

## Crash reports

If Devian's backend panics, a report is written to `~/.devian/crashes` with the home folder replaced by `~`. It isn't sent anywhere. On the next launch Devian asks whether you'd like to send it, and shows exactly what's in it first.

## Feedback

The feedback window (sidebar, or **Settings → About**) shows everything that will be sent before you send it. Feedback is anonymous unless you type an email. You can also open a GitHub issue instead, which sends nothing until you submit it on GitHub.

## Website

devian.app uses Vercel Web Analytics (cookieless) and, when configured, Google Analytics.

## Data Devian keeps

Everything Devian stores is in `~/.devian` and the app's settings folder: settings, cleanup history, memory edit history and crash reports. Deleting them resets Devian. It never modifies agent history.
