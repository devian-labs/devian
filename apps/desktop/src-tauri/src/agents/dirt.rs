//! Disk the agents leave behind: old transcripts, checkpoints, snapshots,
//! caches and state for projects that no longer exist.
//!
//! Deletion always re-scans and only removes paths that sit inside a known
//! agent data directory; the UI never sends paths.

use super::{app_support_dir, claude, codex, home, mtime_ms, now_ms, opencode, AgentSession};
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

#[derive(Serialize, Clone)]
pub struct DirtItem {
    pub id: String,
    pub agent: String,
    pub label: String,
    pub description: String,
    pub size_bytes: u64,
    pub file_count: u64,
    /// True when deleting loses something a user might want back (history, undo).
    pub caution: bool,
    /// Agent that must be closed first, if any.
    pub requires_closed: Option<String>,
    pub paths_preview: Vec<String>,
    pub path_count: usize,
    /// Claude Code config folder, for per-instance items.
    pub instance: Option<String>,
}

#[derive(Serialize)]
pub struct CleanResult {
    pub freed_bytes: u64,
    pub deleted_paths: usize,
    pub skipped: Vec<String>,
}

const ELECTRON_CACHES: [&str; 10] = [
    "Cache",
    "CachedData",
    "Code Cache",
    "GPUCache",
    "DawnGraphiteCache",
    "DawnWebGPUCache",
    "CachedExtensionVSIXs",
    "CachedProfilesData",
    "logs",
    "Crashpad/completed",
];

fn allowed_roots() -> Vec<PathBuf> {
    let mut roots: Vec<PathBuf> = claude::instances().iter().map(|i| PathBuf::from(&i.path)).collect();
    roots.extend([
        codex::codex_home(),
        opencode::data_dir(),
        app_support_dir("Cursor"),
        app_support_dir("Antigravity"),
        home().join(".gemini/antigravity"),
    ]);
    roots
}

fn size_and_count(p: &Path) -> (u64, u64) {
    if p.is_file() {
        return (std::fs::metadata(p).map(|m| m.len()).unwrap_or(0), 1);
    }
    walkdir::WalkDir::new(p)
        .into_iter()
        .flatten()
        .filter(|e| e.file_type().is_file())
        .fold((0, 0), |(s, c), e| (s + e.metadata().map(|m| m.len()).unwrap_or(0), c + 1))
}

/// Newest modification time anywhere under `p` (a directory's own mtime
/// doesn't change when files deep inside it do).
fn newest_mtime(p: &Path) -> i64 {
    if p.is_file() {
        return mtime_ms(p);
    }
    walkdir::WalkDir::new(p)
        .max_depth(4)
        .into_iter()
        .flatten()
        .filter_map(|e| e.metadata().ok()?.modified().ok())
        .filter_map(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .max()
        .unwrap_or(0)
}

fn children(dir: &Path) -> Vec<PathBuf> {
    std::fs::read_dir(dir).map(|rd| rd.flatten().map(|e| e.path()).collect()).unwrap_or_default()
}

fn older_than(paths: Vec<PathBuf>, cutoff: i64) -> Vec<PathBuf> {
    paths.into_iter().filter(|p| newest_mtime(p) < cutoff).collect()
}

fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(b) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                out.push(b);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// VS Code-style per-workspace state whose folder has been deleted.
fn orphaned_workspace_storage(app_dir: &Path) -> Vec<PathBuf> {
    children(&app_dir.join("User/workspaceStorage"))
        .into_iter()
        .filter(|dir| {
            let Ok(text) = std::fs::read_to_string(dir.join("workspace.json")) else { return false };
            let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) else { return false };
            let Some(uri) = v["folder"].as_str().or(v["workspace"].as_str()) else { return false };
            let Some(path) = uri.strip_prefix("file://") else { return false };
            let path = percent_decode(path);
            // Windows URIs look like file:///c%3A/Users/...
            let path = if path.len() > 3 && path.as_bytes()[2] == b':' { path[1..].to_string() } else { path };
            !Path::new(&path).exists()
        })
        .collect()
}

struct Candidate {
    item: DirtItem,
    paths: Vec<PathBuf>,
}

fn candidate(id: &str, agent: &str, label: &str, description: String, caution: bool, requires_closed: bool, paths: Vec<PathBuf>) -> Option<Candidate> {
    if paths.is_empty() {
        return None;
    }
    let (size, count) = paths.iter().map(|p| size_and_count(p)).fold((0, 0), |(s, c), (a, b)| (s + a, c + b));
    if size == 0 && count == 0 {
        return None;
    }
    let h = home();
    let preview = paths
        .iter()
        .take(5)
        .map(|p| p.to_string_lossy().replacen(&*h.to_string_lossy(), "~", 1))
        .collect();
    Some(Candidate {
        item: DirtItem {
            id: id.into(),
            agent: agent.into(),
            label: label.into(),
            description,
            size_bytes: size,
            file_count: count,
            caution,
            requires_closed: requires_closed.then(|| agent.to_string()),
            paths_preview: preview,
            path_count: paths.len(),
            instance: None,
        },
        paths,
    })
}

fn collect(sessions: &[AgentSession], days: u32) -> Vec<Candidate> {
    let cutoff = now_ms() - days as i64 * 86_400_000;
    let mut out = Vec::new();

    // ── Claude Code, per config folder ──
    let mut cwd_of: HashMap<PathBuf, String> = HashMap::new();
    for s in sessions.iter().filter(|s| s.agent == "claude") {
        if let (Some(dir), Some(cwd)) = (Path::new(&s.source_path).parent(), &s.project_path) {
            cwd_of.entry(dir.to_path_buf()).or_insert_with(|| cwd.clone());
        }
    }
    let instances = claude::instances();
    let several = instances.len() > 1;
    for inst in &instances {
        let root = PathBuf::from(&inst.path);
        let projects = inst.projects_dir();
        let suffix = if several { format!(" · {}", inst.label) } else { String::new() };
        let mut add = |id: &str, label: &str, description: String, caution: bool, paths: Vec<PathBuf>| {
            if let Some(mut c) = candidate(&format!("{id}@{}", inst.id), "claude", &format!("{label}{suffix}"), description, caution, false, paths) {
                c.item.instance = Some(inst.id.clone());
                out.push(c);
            }
        };
        let orphan_dirs: HashSet<PathBuf> = cwd_of
            .iter()
            .filter(|(dir, cwd)| dir.starts_with(&projects) && !Path::new(cwd).exists())
            .map(|(dir, _)| dir.clone())
            .collect();
        let orphan_paths: Vec<PathBuf> = orphan_dirs
            .iter()
            .flat_map(|d| children(d))
            .filter(|p| p.file_name().is_none_or(|n| n != "memory"))
            .collect();
        add(
            "claude-orphaned-projects",
            "Sessions for deleted projects",
            format!("Transcripts for {} project folder(s) that no longer exist. Memory files are kept.", orphan_dirs.len()),
            true,
            orphan_paths,
        );
        let old_sessions: Vec<PathBuf> = children(&projects)
            .into_iter()
            .filter(|d| d.is_dir() && !orphan_dirs.contains(d))
            .flat_map(|d| children(&d))
            .filter(|p| p.extension().is_some_and(|x| x == "jsonl"))
            .filter(|p| mtime_ms(p) < cutoff)
            .flat_map(|p| {
                let sibling = p.with_extension("");
                [Some(p), sibling.is_dir().then_some(sibling)]
            })
            .flatten()
            .collect();
        add(
            "claude-old-sessions",
            "Old session transcripts",
            format!("Sessions untouched for {days}+ days. They can no longer be resumed once removed."),
            true,
            old_sessions,
        );
        add(
            "claude-file-history",
            "Rewind checkpoints",
            format!("File backups Claude Code keeps for /rewind, from sessions older than {days} days."),
            false,
            older_than(children(&root.join("file-history")), cutoff),
        );
        let scratch: Vec<PathBuf> = ["paste-cache", "shell-snapshots", "session-env", "debug", "todos"]
            .iter()
            .flat_map(|d| children(&root.join(d)))
            .collect();
        add(
            "claude-scratch",
            "Scratch files",
            format!("Paste cache, shell snapshots, per-session env, debug logs and todo lists older than {days} days."),
            false,
            older_than(scratch, cutoff),
        );
    }

    // ── Codex ──
    let old_rollouts: Vec<PathBuf> = codex::rollout_files().into_iter().filter(|p| mtime_ms(p) < cutoff).collect();
    out.extend(candidate(
        "codex-old-sessions",
        "codex",
        "Old session transcripts",
        format!("Rollouts untouched for {days}+ days. Codex can't resume them once removed."),
        true,
        false,
        old_rollouts,
    ));
    let codex_root = codex::codex_home();
    let codex_scratch: Vec<PathBuf> = ["shell_snapshots", "tmp", "log"].iter().flat_map(|d| children(&codex_root.join(d))).collect();
    out.extend(candidate(
        "codex-scratch",
        "codex",
        "Scratch files and logs",
        format!("Shell snapshots, temp files and logs older than {days} days."),
        false,
        false,
        older_than(codex_scratch, cutoff),
    ));

    // ── OpenCode ──
    let oc = opencode::data_dir();
    out.extend(candidate(
        "opencode-snapshots",
        "opencode",
        "Undo snapshots",
        format!("Git snapshots OpenCode keeps to undo changes, older than {days} days."),
        true,
        false,
        older_than(children(&oc.join("snapshot")), cutoff),
    ));
    out.extend(candidate(
        "opencode-logs",
        "opencode",
        "Logs",
        format!("Log files older than {days} days."),
        false,
        false,
        older_than(children(&oc.join("log")), cutoff),
    ));

    // ── Cursor & Antigravity (Electron) ──
    for (agent, app) in [("cursor", "Cursor"), ("antigravity", "Antigravity")] {
        let dir = app_support_dir(app);
        let caches: Vec<PathBuf> = ELECTRON_CACHES.iter().map(|c| dir.join(c)).filter(|p| p.exists()).collect();
        out.extend(candidate(
            &format!("{agent}-cache"),
            agent,
            "App caches",
            format!("{app}'s code, GPU and extension caches plus logs. They rebuild on next launch."),
            false,
            true,
            caches,
        ));
        out.extend(candidate(
            &format!("{agent}-orphaned-workspaces"),
            agent,
            "State for deleted folders",
            format!("Per-workspace state {app} keeps for folders that no longer exist."),
            false,
            true,
            orphaned_workspace_storage(&dir),
        ));
    }
    let ag = home().join(".gemini/antigravity");
    let old_convs: Vec<PathBuf> = older_than(children(&ag.join("conversations")), cutoff)
        .into_iter()
        .chain(older_than(children(&ag.join("brain")), cutoff))
        .collect();
    out.extend(candidate(
        "antigravity-old-conversations",
        "antigravity",
        "Old conversations",
        format!("Conversations and their plan/task artifacts untouched for {days}+ days."),
        true,
        false,
        old_convs,
    ));
    out.extend(candidate(
        "antigravity-crashes",
        "antigravity",
        "Crash reports",
        "Crash dumps from the Antigravity agent.".into(),
        false,
        false,
        children(&ag.join("crashes")),
    ));

    out.sort_by(|a, b| b.item.size_bytes.cmp(&a.item.size_bytes));
    out
}

pub fn scan(sessions: &[AgentSession], days: u32) -> Vec<DirtItem> {
    collect(sessions, days).into_iter().map(|c| c.item).collect()
}

pub fn clean(sessions: &[AgentSession], days: u32, ids: &[String], running_agents: &HashSet<String>) -> CleanResult {
    let roots = allowed_roots();
    let mut result = CleanResult { freed_bytes: 0, deleted_paths: 0, skipped: vec![] };
    for c in collect(sessions, days).into_iter().filter(|c| ids.contains(&c.item.id)) {
        if let Some(agent) = &c.item.requires_closed {
            if running_agents.contains(agent) {
                result.skipped.push(format!("{}: quit {} first", c.item.label, super::agent_label(agent)));
                continue;
            }
        }
        for p in c.paths {
            let inside = roots.iter().any(|r| p.starts_with(r) && p != *r);
            if !inside {
                result.skipped.push(format!("Refused to delete {}", p.display()));
                continue;
            }
            let (size, _) = size_and_count(&p);
            match super::remove_path(&p) {
                Ok(()) => {
                    result.freed_bytes += size;
                    result.deleted_paths += 1;
                }
                Err(e) => result.skipped.push(e),
            }
        }
    }
    result
}
