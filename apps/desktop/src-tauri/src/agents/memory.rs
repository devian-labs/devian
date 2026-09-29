//! What each agent remembers about you and your projects: auto-memory files,
//! instruction files (CLAUDE.md / AGENTS.md / GEMINI.md), editor rules and
//! knowledge items.

use super::{codex::codex_home, home, is_meaningful_project, mtime_ms, opencode::open_db, truncate, AgentSession};
use serde::Serialize;
use std::collections::{BTreeSet, HashMap};
use std::path::{Path, PathBuf};

#[derive(Serialize, Clone)]
pub struct MemoryItem {
    /// File path, or `codex-db:<thread>` for memories stored in Codex's database.
    pub id: String,
    pub agents: Vec<String>,
    /// global | project
    pub scope: String,
    /// memory | index | instructions | rules | knowledge
    pub kind: String,
    pub title: String,
    pub description: Option<String>,
    pub path: Option<String>,
    pub project_path: Option<String>,
    pub preview: String,
    pub size_bytes: u64,
    pub modified_at: i64,
    /// Only agent-owned memory is deletable; project files can be edited but not deleted.
    pub deletable: bool,
    /// Claude Code config folder this belongs to, when it's instance-specific.
    pub instance: Option<String>,
}

const MAX_READ: usize = 256 * 1024;

fn read_capped(p: &Path) -> Option<String> {
    let bytes = std::fs::read(p).ok()?;
    let slice = &bytes[..bytes.len().min(MAX_READ)];
    Some(String::from_utf8_lossy(slice).into_owned())
}

/// Splits YAML-ish frontmatter into (name, description, body).
fn frontmatter(text: &str) -> (Option<String>, Option<String>, &str) {
    let Some(rest) = text.strip_prefix("---") else { return (None, None, text) };
    let Some(end) = rest.find("\n---") else { return (None, None, text) };
    let (fm, body) = (&rest[..end], &rest[end + 4..]);
    let field = |k: &str| {
        fm.lines()
            .find_map(|l| l.trim().strip_prefix(k).and_then(|v| v.trim_start().strip_prefix(':')))
            .map(|v| v.trim().trim_matches('"').to_string())
            .filter(|v| !v.is_empty())
    };
    (field("name"), field("description"), body.trim_start_matches(['\r', '\n']))
}

fn file_item(path: &Path, agents: &[&str], scope: &str, kind: &str, project: Option<&str>, deletable: bool) -> Option<MemoryItem> {
    if !path.is_file() {
        return None;
    }
    let text = read_capped(path)?;
    let (name, description, body) = frontmatter(&text);
    let heading = body
        .lines()
        .map(str::trim)
        .find(|l| l.starts_with('#'))
        .map(|l| l.trim_start_matches('#').trim().to_string());
    let file_name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let title = match kind {
        "instructions" | "index" => file_name.clone(),
        _ => name.or(heading).unwrap_or_else(|| file_name.trim_end_matches(".md").replace(['-', '_'], " ")),
    };
    Some(MemoryItem {
        id: path.to_string_lossy().into_owned(),
        agents: agents.iter().map(|a| a.to_string()).collect(),
        scope: scope.into(),
        kind: kind.into(),
        title,
        description,
        path: Some(path.to_string_lossy().into_owned()),
        project_path: project.map(String::from),
        preview: truncate(body, 400),
        size_bytes: std::fs::metadata(path).map(|m| m.len()).unwrap_or(0),
        modified_at: mtime_ms(path),
        deletable,
        instance: None,
    })
}

fn md_files(dir: &Path, exts: &[&str], depth: usize) -> Vec<PathBuf> {
    if !dir.is_dir() {
        return vec![];
    }
    walkdir::WalkDir::new(dir)
        .max_depth(depth)
        .into_iter()
        .flatten()
        .map(|e| e.into_path())
        .filter(|p| p.is_file() && p.extension().is_some_and(|x| exts.iter().any(|e| x == *e)))
        .collect()
}

/// Maps each `~/.claude/projects/<dir>` to the real cwd its sessions ran in.
fn claude_project_dirs(sessions: &[AgentSession]) -> HashMap<PathBuf, String> {
    let mut m = HashMap::new();
    for s in sessions.iter().filter(|s| s.agent == "claude") {
        if let (Some(parent), Some(cwd)) = (Path::new(&s.source_path).parent(), &s.project_path) {
            m.entry(parent.to_path_buf()).or_insert_with(|| cwd.clone());
        }
    }
    m
}

pub fn list_memories(sessions: &[AgentSession]) -> Vec<MemoryItem> {
    let h = home();
    let mut items = Vec::new();

    // Global instruction files.
    let globals: [(PathBuf, &[&str]); 5] = [
        (codex_home().join("AGENTS.md"), &["codex"]),
        (codex_home().join("AGENTS.override.md"), &["codex"]),
        (h.join(".config/opencode/AGENTS.md"), &["opencode"]),
        (h.join(".gemini/GEMINI.md"), &["antigravity"]),
        (h.join(".cursor/rules.md"), &["cursor"]),
    ];
    for (p, agents) in globals {
        items.extend(file_item(&p, agents, "global", "instructions", None, false));
    }
    // Claude Code, per config folder: global CLAUDE.md, rules and auto-memory.
    let project_dirs = claude_project_dirs(sessions);
    for inst in super::claude::instances() {
        let root = Path::new(&inst.path);
        let tag = |mut i: MemoryItem| { i.instance = Some(inst.id.clone()); i };
        items.extend(file_item(&root.join("CLAUDE.md"), &["claude"], "global", "instructions", None, false).map(tag));
        for p in md_files(&root.join("rules"), &["md"], 3) {
            items.extend(file_item(&p, &["claude"], "global", "rules", None, false).map(tag));
        }
        let Ok(rd) = std::fs::read_dir(inst.projects_dir()) else { continue };
        for dir in rd.flatten().map(|e| e.path()) {
            let project = project_dirs.get(&dir).map(String::as_str);
            for p in md_files(&dir.join("memory"), &["md"], 2) {
                let is_index = p.file_name().is_some_and(|n| n == "MEMORY.md");
                let kind = if is_index { "index" } else { "memory" };
                items.extend(file_item(&p, &["claude"], "project", kind, project, !is_index).map(tag));
            }
        }
    }

    // Codex memories: newer builds write files, older ones keep them in SQLite.
    for p in md_files(&codex_home().join("memories"), &["md"], 3) {
        items.extend(file_item(&p, &["codex"], "global", "memory", None, true));
    }
    items.extend(codex_db_memories());

    // Antigravity knowledge items.
    if let Ok(rd) = std::fs::read_dir(h.join(".gemini/antigravity/knowledge")) {
        for dir in rd.flatten().map(|e| e.path()).filter(|p| p.is_dir()) {
            items.extend(antigravity_knowledge(&dir));
        }
    }

    // Per-project instruction and rule files for every project an agent worked in.
    let projects: BTreeSet<String> = sessions
        .iter()
        .filter_map(|s| s.project_path.clone())
        .filter(|p| is_meaningful_project(p) && Path::new(p).is_dir())
        .collect();
    for proj in &projects {
        let root = Path::new(proj);
        let files: [(&str, &[&str], &str); 6] = [
            ("CLAUDE.md", &["claude"], "instructions"),
            (".claude/CLAUDE.md", &["claude"], "instructions"),
            ("CLAUDE.local.md", &["claude"], "instructions"),
            ("AGENTS.md", &["codex", "opencode", "cursor"], "instructions"),
            ("GEMINI.md", &["antigravity"], "instructions"),
            (".cursorrules", &["cursor"], "rules"),
        ];
        for (rel, agents, kind) in files {
            items.extend(file_item(&root.join(rel), agents, "project", kind, Some(proj), false));
        }
        for p in md_files(&root.join(".cursor/rules"), &["mdc", "md"], 3) {
            items.extend(file_item(&p, &["cursor"], "project", "rules", Some(proj), false));
        }
        for p in md_files(&root.join(".agent/rules"), &["md"], 2) {
            items.extend(file_item(&p, &["antigravity"], "project", "rules", Some(proj), false));
        }
    }

    let mut seen = BTreeSet::new();
    items.retain(|i| seen.insert(i.id.clone()));
    items.sort_by(|a, b| b.modified_at.cmp(&a.modified_at));
    items
}

fn codex_db_memories() -> Vec<MemoryItem> {
    let Some(conn) = open_db(&codex_home().join("memories_1.sqlite")) else { return vec![] };
    let cwds: HashMap<String, String> = open_db(&codex_home().join("state_5.sqlite"))
        .and_then(|c| {
            let mut stmt = c.prepare("SELECT id, cwd FROM threads").ok()?;
            let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))).ok()?;
            Some(rows.flatten().collect())
        })
        .unwrap_or_default();
    let Ok(mut stmt) = conn.prepare("SELECT thread_id, raw_memory, rollout_summary, rollout_slug, generated_at FROM stage1_outputs") else {
        return vec![];
    };
    let Ok(rows) = stmt.query_map([], |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, String>(1)?,
            r.get::<_, String>(2)?,
            r.get::<_, Option<String>>(3)?,
            r.get::<_, i64>(4)?,
        ))
    }) else {
        return vec![];
    };
    rows.flatten()
        .map(|(thread, raw, summary, slug, generated)| MemoryItem {
            id: format!("codex-db:{thread}"),
            agents: vec!["codex".into()],
            scope: if cwds.contains_key(&thread) { "project" } else { "global" }.into(),
            kind: "memory".into(),
            title: slug.map(|s| s.replace(['-', '_'], " ")).unwrap_or_else(|| truncate(summary.lines().next().unwrap_or("Codex memory"), 80)),
            description: Some(truncate(&summary, 200)),
            path: None,
            project_path: cwds.get(&thread).cloned(),
            preview: truncate(&raw, 400),
            size_bytes: raw.len() as u64,
            // Codex stores seconds here.
            modified_at: if generated < 10_000_000_000 { generated * 1000 } else { generated },
            deletable: false,
            instance: None,
        })
        .collect()
}

fn antigravity_knowledge(dir: &Path) -> Option<MemoryItem> {
    let meta: serde_json::Value = std::fs::read_to_string(dir.join("metadata.json"))
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default();
    let artifacts = md_files(dir, &["md"], 3);
    let body = artifacts.first().and_then(|p| read_capped(p)).unwrap_or_default();
    let title = meta["title"].as_str().map(String::from).or_else(|| dir.file_name().map(|n| n.to_string_lossy().into_owned()))?;
    let size = walkdir::WalkDir::new(dir).into_iter().flatten().filter_map(|e| e.metadata().ok()).map(|m| m.len()).sum();
    Some(MemoryItem {
        id: dir.to_string_lossy().into_owned(),
        agents: vec!["antigravity".into()],
        scope: "global".into(),
        kind: "knowledge".into(),
        title,
        description: meta["summary"].as_str().map(|s| truncate(s, 200)),
        path: Some(dir.to_string_lossy().into_owned()),
        project_path: None,
        preview: truncate(&body, 400),
        size_bytes: size,
        modified_at: mtime_ms(dir),
        deletable: true,
        instance: None,
    })
}

pub fn read_memory(sessions: &[AgentSession], id: &str) -> Result<String, String> {
    let item = list_memories(sessions).into_iter().find(|i| i.id == id).ok_or("Memory not found")?;
    if let Some(thread) = id.strip_prefix("codex-db:") {
        let conn = open_db(&codex_home().join("memories_1.sqlite")).ok_or("Codex memory database not found")?;
        return conn
            .query_row("SELECT raw_memory FROM stage1_outputs WHERE thread_id = ?1", [thread], |r| r.get(0))
            .map_err(|e| e.to_string());
    }
    let path = PathBuf::from(item.path.ok_or("No file for this memory")?);
    if path.is_dir() {
        let parts: Vec<String> = md_files(&path, &["md"], 3)
            .iter()
            .filter_map(|p| Some(format!("<!-- {} -->\n{}", p.file_name()?.to_string_lossy(), read_capped(p)?)))
            .collect();
        return Ok(parts.join("\n\n"));
    }
    read_capped(&path).ok_or_else(|| "Could not read file".into())
}

/// A memory file opened for editing.
#[derive(Serialize)]
pub struct MemoryDoc {
    pub content: String,
    /// Passed back on save to detect changes made on disk in the meantime.
    pub modified_at: i64,
    pub editable: bool,
    /// Why it can't be edited here, when it can't.
    pub reason: Option<String>,
}

pub fn open_memory(sessions: &[AgentSession], id: &str) -> Result<MemoryDoc, String> {
    let item = list_memories(sessions).into_iter().find(|i| i.id == id).ok_or("Memory not found")?;
    let read_only = |content: String, reason: &str| MemoryDoc { content, modified_at: item.modified_at, editable: false, reason: Some(reason.into()) };
    if id.starts_with("codex-db:") {
        return Ok(read_only(read_memory(sessions, id)?, "Stored in Codex's own database. Ask Codex to update or forget it."));
    }
    let path = PathBuf::from(item.path.as_deref().ok_or("No file for this memory")?);
    if path.is_dir() {
        return Ok(read_only(read_memory(sessions, id)?, "Knowledge items are folders of several files. Reveal the folder to edit them."));
    }
    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
    if bytes.len() > MAX_READ {
        return Ok(read_only(read_capped(&path).unwrap_or_default(), "This file is too large to edit here."));
    }
    match String::from_utf8(bytes) {
        Ok(content) => Ok(MemoryDoc { content, modified_at: mtime_ms(&path), editable: true, reason: None }),
        Err(_) => Ok(read_only(read_capped(&path).unwrap_or_default(), "This file isn't plain UTF-8 text.")),
    }
}

/// Prefix on save errors caused by the file changing on disk since it was opened.
pub const CONFLICT: &str = "conflict:";
const HISTORY_KEEP: usize = 20;

fn history_dir(path: &Path) -> PathBuf {
    use sha2::{Digest, Sha256};
    let digest = Sha256::digest(path.to_string_lossy().as_bytes());
    let key: String = digest.iter().take(8).map(|b| format!("{b:02x}")).collect();
    home().join(".devian").join("memory-history").join(key)
}

/// Keeps the previous contents of `path` so a save can always be undone.
fn snapshot(path: &Path) -> Result<(), String> {
    let Ok(previous) = std::fs::read(path) else { return Ok(()) };
    let dir = history_dir(path);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let _ = std::fs::write(dir.join("path.txt"), path.to_string_lossy().as_bytes());
    let name = format!("{}.md", super::now_ms());
    std::fs::write(dir.join(name), previous).map_err(|e| e.to_string())?;
    let mut versions: Vec<PathBuf> = std::fs::read_dir(&dir)
        .map_err(|e| e.to_string())?
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|x| x == "md"))
        .collect();
    versions.sort();
    for old in versions.iter().take(versions.len().saturating_sub(HISTORY_KEEP)) {
        let _ = std::fs::remove_file(old);
    }
    Ok(())
}

/// Saves edited memory. Refuses when the file changed on disk after it was
/// opened (an agent may have just written to it) unless `force` is set.
/// Writes go to a temp file first and are renamed into place, so a crash
/// never leaves a half-written file.
pub fn save_memory(sessions: &[AgentSession], id: &str, content: &str, expected_modified: i64, force: bool) -> Result<i64, String> {
    let item = list_memories(sessions).into_iter().find(|i| i.id == id).ok_or("Memory not found")?;
    let path = PathBuf::from(item.path.ok_or("This memory can't be edited here")?);
    if path.is_dir() || id.starts_with("codex-db:") {
        return Err("This memory can't be edited here".into());
    }
    if content.len() > MAX_READ {
        return Err("That's too large for a memory file (256 KB max).".into());
    }
    let current = mtime_ms(&path);
    if !force && current != expected_modified {
        return Err(format!("{CONFLICT}The file changed on disk while you were editing it, probably because an agent updated it."));
    }
    snapshot(&path)?;
    let file_name = path.file_name().ok_or("Invalid path")?.to_string_lossy().into_owned();
    let tmp = path.with_file_name(format!(".{file_name}.devian-tmp"));
    std::fs::write(&tmp, content).map_err(|e| e.to_string())?;
    if let Ok(meta) = std::fs::metadata(&path) {
        let _ = std::fs::set_permissions(&tmp, meta.permissions());
    }
    std::fs::rename(&tmp, &path).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        e.to_string()
    })?;
    Ok(mtime_ms(&path))
}

pub fn delete_memory(sessions: &[AgentSession], id: &str) -> Result<(), String> {
    let item = list_memories(sessions).into_iter().find(|i| i.id == id).ok_or("Memory not found")?;
    if !item.deletable {
        return Err("This file belongs to a project or is managed by the agent, so it can be edited but not deleted.".into());
    }
    let path = PathBuf::from(item.path.ok_or("No file for this memory")?);
    let is_dir = path.is_dir();
    super::remove_path(&path)?;
    if is_dir {
        return Ok(());
    }

    // Keep Claude Code's MEMORY.md index in step with the files it points to.
    if let (Some(dir), Some(name)) = (path.parent(), path.file_name().map(|n| n.to_string_lossy().into_owned())) {
        let index = dir.join("MEMORY.md");
        if let Ok(text) = std::fs::read_to_string(&index) {
            let needle = format!("({name})");
            let kept: Vec<&str> = text.lines().filter(|l| !l.contains(&needle)).collect();
            if kept.len() != text.lines().count() {
                let mut out = kept.join("\n");
                out.push('\n');
                std::fs::write(&index, out).map_err(|e| e.to_string())?;
            }
        }
    }
    Ok(())
}
