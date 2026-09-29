//! Everything Devian knows about the AI coding agents on this machine.
//!
//! Each agent keeps its own local record of sessions, token usage and memory.
//! The per-agent modules read those records (strictly read-only) and normalise
//! them into the shared types below so the UI and the MCP server can treat
//! Claude Code, Codex, OpenCode, Cursor and Antigravity the same way.

pub mod antigravity;
pub mod claude;
pub mod codex;
pub mod commands;
pub mod cursor;
pub mod dirt;
pub mod limits;
pub mod machine;
pub mod mcp_setup;
pub mod memory;
pub mod opencode;
pub mod pricing;
pub mod risk;
pub mod runtime;
#[cfg(test)]
mod tests;

use serde::Serialize;
use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::UNIX_EPOCH;

pub const AGENT_IDS: [&str; 5] = ["claude", "codex", "opencode", "cursor", "antigravity"];

pub fn home() -> PathBuf {
    std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .map(PathBuf::from)
        .unwrap_or_else(|_| std::env::temp_dir())
}

/// Per-platform application-support directory for Electron apps (Cursor, Antigravity).
pub fn app_support_dir(app: &str) -> PathBuf {
    let h = home();
    if cfg!(target_os = "macos") {
        h.join("Library/Application Support").join(app)
    } else if cfg!(target_os = "windows") {
        std::env::var("APPDATA")
            .map(PathBuf::from)
            .unwrap_or_else(|_| h.join("AppData/Roaming"))
            .join(app)
    } else {
        h.join(".config").join(app)
    }
}

pub fn agent_label(agent: &str) -> &'static str {
    match agent {
        "claude" => "Claude Code",
        "codex" => "Codex",
        "opencode" => "OpenCode",
        "cursor" => "Cursor",
        "antigravity" => "Antigravity",
        _ => "Agent",
    }
}

#[derive(Serialize, Clone, Default, Debug)]
pub struct TokenUsage {
    /// Uncached input tokens.
    pub input: u64,
    pub output: u64,
    pub cache_read: u64,
    pub cache_write: u64,
    /// Informational: reasoning tokens are already counted inside `output`.
    pub reasoning: u64,
}

impl TokenUsage {
    pub fn add(&mut self, o: &TokenUsage) {
        self.input += o.input;
        self.output += o.output;
        self.cache_read += o.cache_read;
        self.cache_write += o.cache_write;
        self.reasoning += o.reasoning;
    }
    pub fn total(&self) -> u64 {
        self.input + self.output + self.cache_read + self.cache_write
    }
}

#[derive(Serialize, Clone, Default, Debug)]
pub struct AgentSession {
    pub agent: String,
    pub id: String,
    pub title: String,
    pub project_path: Option<String>,
    /// Unix milliseconds.
    pub started_at: i64,
    pub updated_at: i64,
    pub models: Vec<String>,
    pub tokens: TokenUsage,
    pub total_tokens: u64,
    /// Dollar cost: recorded by the agent (OpenCode) or estimated from
    /// API list prices (Claude). None when it can't be priced.
    pub cost_usd: Option<f64>,
    /// True when `cost_usd` is an API-equivalent estimate rather than a bill.
    pub cost_estimated: bool,
    /// Cost bucketed by local day, alongside `daily_tokens`.
    pub daily_cost: BTreeMap<String, f64>,
    /// For agents with several config folders (Claude Code), which one.
    pub instance: Option<String>,
    pub message_count: u32,
    pub command_count: u32,
    pub files_changed: u32,
    pub risky_count: u32,
    /// Up to 100 files the agent edited or wrote.
    pub files_touched: Vec<String>,
    /// Total tokens bucketed by local day (YYYY-MM-DD).
    pub daily_tokens: BTreeMap<String, u64>,
    pub source_path: String,
    pub size_bytes: u64,
    /// True when the agent stores only partial history locally.
    pub partial: bool,
}

impl AgentSession {
    pub fn finish(&mut self) {
        self.total_tokens = self.tokens.total();
        self.files_changed = self.files_touched.len() as u32;
        if self.title.trim().is_empty() {
            self.title = "Untitled session".into();
        }
    }

    pub fn touch_file(&mut self, path: &str) {
        if self.files_touched.len() < 100 && !self.files_touched.iter().any(|f| f == path) {
            self.files_touched.push(path.to_string());
        }
    }

    pub fn add_model(&mut self, model: &str) {
        let m = model.trim();
        if m.is_empty() || m.starts_with('<') {
            return;
        }
        if !self.models.iter().any(|x| x == m) {
            self.models.push(m.to_string());
        }
    }

    pub fn add_cost(&mut self, ts_ms: i64, usd: f64) {
        if usd <= 0.0 {
            return;
        }
        *self.cost_usd.get_or_insert(0.0) += usd;
        *self.daily_cost.entry(day_key(ts_ms)).or_insert(0.0) += usd;
    }

    pub fn add_daily(&mut self, ts_ms: i64, tokens: u64) {
        if tokens == 0 {
            return;
        }
        *self.daily_tokens.entry(day_key(ts_ms)).or_insert(0) += tokens;
    }

    pub fn see_ts(&mut self, ts_ms: i64) {
        if ts_ms <= 0 {
            return;
        }
        if self.started_at == 0 || ts_ms < self.started_at {
            self.started_at = ts_ms;
        }
        if ts_ms > self.updated_at {
            self.updated_at = ts_ms;
        }
    }
}

#[derive(Serialize, Clone, Debug)]
pub struct SessionEvent {
    pub ts: i64,
    /// prompt | command | edit | write | tool | reply
    pub kind: String,
    pub text: String,
    pub detail: Option<String>,
    /// High-risk finding; counted in the session's `risky_count`.
    pub risk: Option<String>,
    /// Worth knowing but not dangerous (background processes, kills, ...).
    pub notice: Option<String>,
    /// The fragment of `text` that triggered `risk`/`notice`, for highlighting.
    pub matched: Option<String>,
}

/// Records a finding on the session and splits it into (risk, notice, matched) for the event.
pub fn apply_finding(s: &mut AgentSession, f: Option<risk::Finding>) -> (Option<String>, Option<String>, Option<String>) {
    match f {
        Some(f) if f.high => {
            s.risky_count += 1;
            (Some(f.label), None, f.matched)
        }
        Some(f) => (None, Some(f.label), f.matched),
        None => (None, None, None),
    }
}

#[derive(Serialize, Clone)]
pub struct SessionDetail {
    pub session: AgentSession,
    pub events: Vec<SessionEvent>,
}

pub fn day_key(ts_ms: i64) -> String {
    use chrono::{Local, TimeZone};
    match Local.timestamp_millis_opt(ts_ms) {
        chrono::LocalResult::Single(dt) => dt.format("%Y-%m-%d").to_string(),
        _ => "unknown".into(),
    }
}

pub fn parse_ts(s: &str) -> i64 {
    chrono::DateTime::parse_from_rfc3339(s)
        .map(|d| d.timestamp_millis())
        .unwrap_or(0)
}

pub fn mtime_ms(p: &Path) -> i64 {
    std::fs::metadata(p)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Moves a file or folder to the system Trash, so every deletion Devian makes
/// can be undone from Finder / Explorer. Tests delete directly instead of
/// filling the real Trash.
pub fn remove_path(p: &Path) -> Result<(), String> {
    #[cfg(not(test))]
    {
        trash::delete(p).map_err(|e| format!("Couldn't move {} to the Trash: {e}", p.display()))
    }
    #[cfg(test)]
    {
        let res = if p.is_dir() { std::fs::remove_dir_all(p) } else { std::fs::remove_file(p) };
        res.map_err(|e| e.to_string())
    }
}

pub fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

pub fn truncate(s: &str, n: usize) -> String {
    let s = s.trim();
    if s.chars().count() <= n {
        s.to_string()
    } else {
        let mut out: String = s.chars().take(n).collect();
        out.push('…');
        out
    }
}

/// First meaningful line of a prompt, for titles.
pub fn title_from_prompt(p: &str) -> String {
    static NOISE: OnceLock<regex::Regex> = OnceLock::new();
    let noise = NOISE.get_or_init(|| regex::Regex::new(r"\[(Image #\d+|external unsupported block[^\]]*|Pasted text[^\]]*)\]").unwrap());
    let cleaned = noise.replace_all(p, "");
    let line = cleaned
        .lines()
        .map(str::trim)
        .find(|l| !l.is_empty() && !l.starts_with('<') && !l.starts_with('#'))
        .unwrap_or("");
    truncate(line, 90)
}

// ── File-level parse cache ───────────────────────────────────────────────────
//
// Transcripts can add up to hundreds of MB, so each file is parsed once and
// re-parsed only when its size or mtime changes.

type CacheKey = (u64, i64);
static FILE_CACHE: OnceLock<Mutex<HashMap<PathBuf, (CacheKey, AgentSession)>>> = OnceLock::new();

pub fn cached_parse(path: &Path, parse: impl FnOnce(&Path) -> Option<AgentSession>) -> Option<AgentSession> {
    let meta = std::fs::metadata(path).ok()?;
    let key = (meta.len(), mtime_ms(path));
    let cache = FILE_CACHE.get_or_init(|| Mutex::new(HashMap::new()));
    if let Some((k, s)) = cache.lock().ok()?.get(path) {
        if *k == key {
            return Some(s.clone());
        }
    }
    let s = parse(path)?;
    if let Ok(mut c) = cache.lock() {
        c.insert(path.to_path_buf(), (key, s.clone()));
    }
    Some(s)
}

/// All sessions from every agent, newest first.
pub fn list_all_sessions() -> Vec<AgentSession> {
    let mut all = Vec::new();
    all.extend(claude::list_sessions());
    all.extend(codex::list_sessions());
    all.extend(opencode::list_sessions());
    all.extend(cursor::list_sessions());
    all.extend(antigravity::list_sessions());
    all.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    all
}

pub fn session_detail(agent: &str, source_path: &str, id: &str) -> Result<SessionDetail, String> {
    match agent {
        "claude" => claude::detail(Path::new(source_path)),
        "codex" => codex::detail(Path::new(source_path)),
        "opencode" => opencode::detail(id),
        "cursor" => cursor::detail(id),
        "antigravity" => antigravity::detail(id),
        _ => Err(format!("Unknown agent {agent}")),
    }
}

#[derive(Serialize, Clone)]
pub struct AgentInfo {
    pub id: String,
    pub name: String,
    pub installed: bool,
    pub data_dir: String,
    /// "full" when transcripts, commands and tokens are readable locally.
    pub support: String,
    pub note: Option<String>,
    /// Set when history exists on disk but none of it could be read, which
    /// usually means the agent changed its storage format.
    pub warning: Option<String>,
}

/// Flags agents whose history is present but unreadable.
pub fn with_health(mut agents: Vec<AgentInfo>, sessions: &[AgentSession]) -> Vec<AgentInfo> {
    let has_data = |agent: &str| -> bool {
        match agent {
            "claude" => claude::projects_dirs().iter().any(|d| {
                walkdir::WalkDir::new(d)
                    .max_depth(2)
                    .into_iter()
                    .flatten()
                    .any(|e| e.path().extension().is_some_and(|x| x == "jsonl") && e.metadata().is_ok_and(|m| m.len() > 2048))
            }),
            "codex" => codex::rollout_files().iter().any(|p| std::fs::metadata(p).is_ok_and(|m| m.len() > 2048)),
            "opencode" => std::fs::metadata(opencode::data_dir().join("opencode.db")).is_ok_and(|m| m.len() > 64 * 1024),
            _ => false,
        }
    };
    for a in agents.iter_mut().filter(|a| a.installed) {
        if !sessions.iter().any(|s| s.agent == a.id) && has_data(&a.id) {
            a.warning = Some(format!(
                "{} history was found but couldn't be read. It may have changed its format; please report this with your {} version.",
                a.name, a.name
            ));
        }
    }
    agents
}

pub fn detect_agents() -> Vec<AgentInfo> {
    let h = home();
    let entries: [(&str, PathBuf, &str, Option<&str>); 5] = [
        ("claude", claude::instances().first().map(|i| PathBuf::from(&i.path)).unwrap_or_else(|| h.join(".claude")), "full", None),
        ("codex", h.join(".codex"), "full", None),
        ("opencode", opencode::data_dir(), "full", None),
        (
            "cursor",
            app_support_dir("Cursor"),
            "partial",
            Some("Cursor keeps most chat history in its cloud; Devian reads what is stored locally."),
        ),
        (
            "antigravity",
            h.join(".gemini/antigravity"),
            "partial",
            Some("Antigravity stores transcripts in an encoded format; Devian shows plans, tasks and knowledge."),
        ),
    ];
    entries
        .into_iter()
        .map(|(id, dir, support, note)| AgentInfo {
            id: id.into(),
            name: agent_label(id).into(),
            installed: dir.exists(),
            data_dir: dir.to_string_lossy().into_owned(),
            support: support.into(),
            note: note.map(String::from),
            warning: None,
        })
        .collect()
}

/// False for paths that would match everything (home, root) or that are
/// scratch space rather than a project.
pub fn is_meaningful_project(path: &str) -> bool {
    let p = Path::new(path);
    let h = home();
    if p == h || p == Path::new("/") || !p.is_absolute() {
        return false;
    }
    // Temp dirs (agents launched in scratch space) aren't projects.
    let s = path.to_lowercase();
    !(s.starts_with("/private/var/folders") || s.starts_with("/var/folders") || s.starts_with("/tmp"))
}
