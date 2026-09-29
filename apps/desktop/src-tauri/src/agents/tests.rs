//! End-to-end checks of the destructive paths (cleanup, forget, connect,
//! stop) against a throwaway home directory, never the real one.

use super::*;
use std::fs;
use std::time::{Duration, SystemTime};

fn write(p: &Path, text: &str) {
    fs::create_dir_all(p.parent().unwrap()).unwrap();
    fs::write(p, text).unwrap();
}

fn age(p: &Path, days: u64) {
    let t = SystemTime::now() - Duration::from_secs(days * 86_400);
    let mut opts = fs::File::options();
    opts.write(true);
    // Windows only opens a directory as a handle with backup semantics.
    #[cfg(windows)]
    std::os::windows::fs::OpenOptionsExt::custom_flags(&mut opts, 0x0200_0000);
    #[cfg(not(windows))]
    if p.is_dir() {
        opts.write(false).read(true);
    }
    opts.open(p).unwrap().set_modified(t).unwrap();
}

fn transcript(cwd: &Path, ts: &str) -> String {
    let cwd_s = cwd.to_string_lossy().into_owned();
    let env_file = cwd.join(".env").to_string_lossy().into_owned();
    let usage = serde_json::json!({"input_tokens": 10, "output_tokens": 5, "cache_read_input_tokens": 100, "cache_creation_input_tokens": 20});
    [
        serde_json::json!({"type": "user", "cwd": cwd_s, "timestamp": ts, "message": {"role": "user", "content": "add a login page"}}),
        serde_json::json!({"type": "assistant", "cwd": cwd_s, "timestamp": ts, "message": {"id": "m1", "model": "claude-test", "usage": usage,
            "content": [{"type": "tool_use", "id": "t1", "name": "Bash", "input": {"command": "git push --force origin main"}}]}}),
        // The same message id streamed again must not double count.
        serde_json::json!({"type": "assistant", "cwd": cwd_s, "timestamp": ts, "message": {"id": "m1", "model": "claude-test", "usage": usage,
            "content": [{"type": "tool_use", "id": "t2", "name": "Edit", "input": {"file_path": env_file}}]}}),
    ]
    .iter()
    .map(|v| v.to_string())
    .collect::<Vec<_>>()
    .join("\n")
}

/// All sandbox scenarios run in one test: they share the HOME variable.
#[test]
fn sandboxed_home_end_to_end() {
    // Not the system temp dir: Devian treats that as scratch space, not projects.
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join(format!("target/devian-e2e-{}", std::process::id()));
    let _ = fs::remove_dir_all(&root);
    let home_dir = root.join("home");
    let project = home_dir.join("code/app");
    fs::create_dir_all(&project).unwrap();
    // Every root Devian may delete from must resolve inside the sandbox.
    std::env::set_var("HOME", &home_dir);
    std::env::set_var("USERPROFILE", &home_dir);
    std::env::set_var("APPDATA", home_dir.join("AppData/Roaming"));
    std::env::remove_var("CODEX_HOME");
    std::env::remove_var("XDG_DATA_HOME");

    let claude = home_dir.join(".claude/projects/-code-app");
    let recent = claude.join("recent.jsonl");
    let old = claude.join("old.jsonl");
    write(&recent, &transcript(&project, "2026-09-28T10:00:00Z"));
    write(&old, &transcript(&project, "2026-07-01T10:00:00Z"));
    age(&old, 60);
    write(&claude.join("old/tool-results/r.txt"), "x");
    age(&claude.join("old/tool-results/r.txt"), 60);
    age(&claude.join("old/tool-results"), 60);
    age(&claude.join("old"), 60);
    write(&claude.join("memory/MEMORY.md"), "- [Stack](stack.md) — uses postgres\n- [Other](other.md) — keep\n");
    write(&claude.join("memory/stack.md"), "---\nname: stack\ndescription: db choice\n---\nPostgres 16.");
    write(&claude.join("memory/other.md"), "keep me");
    write(&project.join("CLAUDE.md"), "project rules");
    let fh = home_dir.join(".claude/file-history/old-session/a.txt");
    write(&fh, "backup");
    age(&fh, 60);
    age(fh.parent().unwrap(), 60);

    // A project folder that no longer exists.
    let gone = home_dir.join(".claude/projects/-code-gone");
    write(&gone.join("s.jsonl"), &transcript(&home_dir.join("code/gone"), "2026-09-28T10:00:00Z"));
    write(&gone.join("memory/note.md"), "remember");

    // A second Claude Code config folder (CLAUDE_CONFIG_DIR=~/.claude-work).
    let work = home_dir.join(".claude-work/projects/-code-app");
    write(&home_dir.join(".claude-work/settings.json"), "{}");
    write(&work.join("w.jsonl"), &transcript(&project, "2026-09-28T11:00:00Z").replace("claude-test", "claude-sonnet-5"));

    // ── Sessions: parsing, dedupe, risk ──
    let sessions = list_all_sessions();
    let s = sessions.iter().find(|s| s.id == "recent").expect("recent session parsed");
    assert_eq!(s.total_tokens, 135, "streamed duplicate must not double count");
    assert_eq!(s.command_count, 1);
    assert_eq!(s.risky_count, 2, "force push + .env edit");
    assert_eq!(s.project_path.as_deref(), Some(project.to_str().unwrap()));
    assert_eq!(s.instance.as_deref(), Some(".claude"));
    assert!(s.cost_usd.is_none(), "unknown model 'claude-test' isn't priced");

    let w = sessions.iter().find(|s| s.id == "w").expect("second instance's session parsed");
    assert_eq!(w.instance.as_deref(), Some(".claude-work"));
    // Sonnet 5: 10 in × $2 + 5 out × $10 + 100 cache read × $0.20 + 20 cache write × $2.50, per 1M.
    let expected = (10.0 * 2.0 + 5.0 * 10.0 + 100.0 * 0.20 + 20.0 * 2.5) / 1_000_000.0;
    assert!((w.cost_usd.unwrap() - expected).abs() < 1e-12 && w.cost_estimated, "cost {:?}", w.cost_usd);
    let insts = claude::instances();
    assert_eq!(insts.iter().map(|i| i.id.as_str()).collect::<Vec<_>>(), vec![".claude", ".claude-work"], "default first");
    assert_eq!(insts[0].keychain_service, "Claude Code-credentials");
    assert!(insts[1].keychain_service.starts_with("Claude Code-credentials-") && insts[1].keychain_service.len() == 32);

    // ── Cleanup: only old / orphaned data goes, memory stays ──
    let dirt = dirt::scan(&sessions, 30);
    let ids: Vec<String> = dirt.iter().map(|d| d.id.clone()).collect();
    for want in ["claude-old-sessions@.claude", "claude-file-history@.claude", "claude-orphaned-projects@.claude"] {
        assert!(ids.contains(&want.to_string()), "missing {want} in {ids:?}");
    }
    for d in &dirt {
        for p in &d.paths_preview {
            let full = p.replacen('~', &home_dir.to_string_lossy(), 1);
            assert!(Path::new(&full).starts_with(&home_dir), "cleanup reached outside the sandbox: {p}");
        }
    }
    let res = dirt::clean(&sessions, 30, &ids, &Default::default());
    assert!(res.skipped.is_empty(), "{:?}", res.skipped);
    assert!(!old.exists() && !claude.join("old").exists(), "old session removed with its folder");
    assert!(recent.exists(), "recent session kept");
    assert!(!fh.exists(), "old rewind checkpoint removed");
    assert!(!gone.join("s.jsonl").exists(), "orphaned transcript removed");
    assert!(gone.join("memory/note.md").exists(), "memory of a deleted project is kept");
    assert!(claude.join("memory/stack.md").exists());
    assert!(project.join("CLAUDE.md").exists());

    // ── Memory: forget updates the index; project files and indexes are protected ──
    let sessions = list_all_sessions();
    let mem = memory::list_memories(&sessions);
    assert!(mem.iter().any(|m| m.title == "CLAUDE.md" && !m.deletable), "project CLAUDE.md listed read-only");
    let stack = mem.iter().find(|m| m.title == "stack").expect("frontmatter name used as title");
    assert_eq!(stack.description.as_deref(), Some("db choice"));
    memory::delete_memory(&sessions, &stack.id).unwrap();
    let index = fs::read_to_string(claude.join("memory/MEMORY.md")).unwrap();
    assert!(!index.contains("stack.md") && index.contains("other.md"), "index line removed, others kept: {index}");
    let project_file = project.join("CLAUDE.md").to_string_lossy().into_owned();
    assert!(memory::delete_memory(&sessions, &project_file).is_err(), "project CLAUDE.md must not be deletable");
    let idx = claude.join("memory/MEMORY.md").to_string_lossy().into_owned();
    assert!(memory::delete_memory(&sessions, &idx).is_err(), "MEMORY.md index must not be deletable");
    assert!(memory::delete_memory(&sessions, "/etc/hosts").is_err(), "arbitrary paths refused");

    // ── Editing: saves are atomic, conflict-checked and snapshotted ──
    let doc = memory::open_memory(&sessions, &project_file).unwrap();
    assert!(doc.editable && doc.content == "project rules");
    let saved_at = memory::save_memory(&sessions, &project_file, "project rules\n- use pnpm", doc.modified_at, false).unwrap();
    assert_eq!(fs::read_to_string(project.join("CLAUDE.md")).unwrap(), "project rules\n- use pnpm");
    assert!(!project.join(".CLAUDE.md.devian-tmp").exists(), "temp file cleaned up");
    // An agent writes to the file while it's open in Devian.
    std::thread::sleep(Duration::from_millis(20));
    fs::write(project.join("CLAUDE.md"), "agent's version").unwrap();
    let err = memory::save_memory(&sessions, &project_file, "mine", saved_at, false).unwrap_err();
    assert!(err.starts_with(memory::CONFLICT), "stale save must be refused: {err}");
    assert_eq!(fs::read_to_string(project.join("CLAUDE.md")).unwrap(), "agent's version", "agent's write untouched");
    memory::save_memory(&sessions, &project_file, "mine", saved_at, true).unwrap();
    assert_eq!(fs::read_to_string(project.join("CLAUDE.md")).unwrap(), "mine", "force overwrites");
    let history: Vec<_> = walkdir::WalkDir::new(home_dir.join(".devian/memory-history")).into_iter().flatten()
        .filter(|e| e.path().extension().is_some_and(|x| x == "md")).collect();
    assert_eq!(history.len(), 2, "each save keeps the previous version");
    assert!(history.iter().any(|e| fs::read_to_string(e.path()).unwrap() == "agent's version"));
    assert!(memory::save_memory(&sessions, "/etc/hosts", "x", 0, true).is_err(), "only listed memory files can be written");

    // ── Connect: Codex and Cursor configs are edited in place with backups ──
    write(&home_dir.join(".codex/config.toml"), "model = \"x\"\n\n[mcp_servers.devian]\ncommand = \"/old/devian\"\nargs = [\"--mcp\"]\n\n[mcp_servers.other]\ncommand = \"o\"\n");
    mcp_setup::connect("codex").unwrap();
    let toml = fs::read_to_string(home_dir.join(".codex/config.toml")).unwrap();
    assert_eq!(toml.matches("[mcp_servers.devian]").count(), 1, "{toml}");
    assert!(!toml.contains("/old/devian") && toml.contains("[mcp_servers.other]") && toml.contains("model = \"x\""), "{toml}");
    assert!(home_dir.join(".codex/config.toml.devian-backup").exists());
    mcp_setup::connect("cursor").unwrap();
    let status = mcp_setup::status();
    assert!(status.iter().find(|s| s.agent == "codex").unwrap().connected);
    assert!(status.iter().find(|s| s.agent == "cursor").unwrap().connected);
    assert!(mcp_setup::connect("opencode").is_err(), "OpenCode is manual");

    // ── Health: history present but unreadable is reported, not silently zero ──
    write(&home_dir.join(".codex/sessions/2026/09/28/rollout-x.jsonl"), &"{\"type\":\"some_future_format\"}\n".repeat(200));
    let sessions = list_all_sessions();
    let agents = with_health(detect_agents(), &sessions);
    assert!(agents.iter().find(|a| a.id == "codex").unwrap().warning.is_some(), "unreadable Codex history flagged");
    assert!(agents.iter().find(|a| a.id == "claude").unwrap().warning.is_none(), "readable Claude history not flagged");

    let _ = fs::remove_dir_all(&root);
}

#[test]
fn unstable_install_locations_are_refused() {
    assert!(mcp_setup::unstable_location("/private/var/folders/x/T/AppTranslocation/ABC/d/Devian.app/Contents/MacOS/devian-desktop").is_some());
    assert!(mcp_setup::unstable_location("/Volumes/Devian/Devian.app/Contents/MacOS/devian-desktop").is_some());
    assert!(mcp_setup::unstable_location("/Applications/Devian.app/Contents/MacOS/devian-desktop").is_none());
}

#[cfg(unix)]
#[test]
fn stop_kills_the_whole_process_tree() {
    use sysinfo::{Pid, ProcessesToUpdate, System};
    // A "dev server" that forks two long-running children.
    let mut child = std::process::Command::new("sh").args(["-c", "sleep 300 & sleep 300 & wait"]).spawn().unwrap();
    let root = Pid::from_u32(child.id());
    std::thread::sleep(Duration::from_millis(300));
    let mut sys = System::new();
    sys.refresh_processes(ProcessesToUpdate::All, true);
    let kids: Vec<Pid> = sys.processes().iter().filter(|(_, p)| p.parent() == Some(root)).map(|(pid, _)| *pid).collect();
    assert_eq!(kids.len(), 2, "test setup: two sleep children");

    // The root is our own child, so it lingers as a zombie until reaped.
    let reaper = std::thread::spawn(move || child.wait());
    assert_eq!(runtime::kill_tree(&[root], Duration::from_millis(1500)), 1);
    reaper.join().unwrap().unwrap();
    sys.refresh_processes(ProcessesToUpdate::All, true);
    for k in kids {
        assert!(sys.process(k).is_none_or(|p| matches!(p.status(), sysinfo::ProcessStatus::Zombie)), "child {k} still running");
    }
}
