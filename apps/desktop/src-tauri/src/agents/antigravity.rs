//! Antigravity: conversations are stored encoded in
//! `~/.gemini/antigravity/conversations/<id>.pb`, but each one gets a readable
//! "brain" folder of markdown artifacts (task list, implementation plan,
//! walkthrough) in `~/.gemini/antigravity/brain/<id>/`.

use super::{home, mtime_ms, truncate, AgentSession, SessionDetail, SessionEvent};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

pub fn base_dir() -> PathBuf {
    home().join(".gemini").join("antigravity")
}

fn markdown_files(dir: &Path) -> Vec<PathBuf> {
    let mut files: Vec<PathBuf> = std::fs::read_dir(dir)
        .map(|rd| rd.flatten().map(|e| e.path()).filter(|p| p.extension().is_some_and(|x| x == "md")).collect())
        .unwrap_or_default();
    files.sort_by_key(|p| mtime_ms(p));
    files
}

fn heading(path: &Path) -> Option<String> {
    let text = std::fs::read_to_string(path).ok()?;
    text.lines()
        .map(str::trim)
        .find(|l| l.starts_with('#'))
        .map(|l| truncate(l.trim_start_matches('#').trim(), 90))
}

fn entry<'a>(sessions: &'a mut BTreeMap<String, AgentSession>, id: String, path: &Path) -> &'a mut AgentSession {
    let s = sessions.entry(id.clone()).or_insert_with(|| AgentSession {
        agent: "antigravity".into(),
        id,
        partial: true,
        ..Default::default()
    });
    s.see_ts(mtime_ms(path));
    if path.is_file() {
        s.size_bytes += std::fs::metadata(path).map(|m| m.len()).unwrap_or(0);
    }
    s
}

pub fn list_sessions() -> Vec<AgentSession> {
    let base = base_dir();
    let mut sessions: BTreeMap<String, AgentSession> = BTreeMap::new();
    if let Ok(rd) = std::fs::read_dir(base.join("conversations")) {
        for p in rd.flatten().map(|e| e.path()) {
            if let Some(id) = p.file_stem().map(|s| s.to_string_lossy().into_owned()) {
                let s = entry(&mut sessions, id, &p);
                s.source_path = p.to_string_lossy().into_owned();
                s.message_count = s.message_count.max(1);
            }
        }
    }
    if let Ok(rd) = std::fs::read_dir(base.join("brain")) {
        for dir in rd.flatten().map(|e| e.path()).filter(|p| p.is_dir()) {
            let Some(id) = dir.file_name().map(|s| s.to_string_lossy().into_owned()) else { continue };
            let files = markdown_files(&dir);
            if files.is_empty() {
                continue;
            }
            let title = ["task.md", "implementation_plan.md", "walkthrough.md"]
                .iter()
                .find_map(|f| heading(&dir.join(f)))
                .or_else(|| files.iter().find_map(|f| heading(f)));
            for f in &files {
                entry(&mut sessions, id.clone(), f);
            }
            let s = entry(&mut sessions, id, &dir);
            if s.source_path.is_empty() {
                s.source_path = dir.to_string_lossy().into_owned();
            }
            s.message_count = s.message_count.max(files.len() as u32);
            if let Some(t) = title {
                s.title = t;
            }
        }
    }
    sessions
        .into_values()
        .map(|mut s| {
            if s.title.is_empty() {
                s.title = "Antigravity conversation".into();
            }
            s.finish();
            s
        })
        .collect()
}

pub fn detail(id: &str) -> Result<SessionDetail, String> {
    if id.contains('/') || id.contains('\\') || id.contains("..") {
        return Err("Invalid conversation id".into());
    }
    let session = list_sessions().into_iter().find(|s| s.id == id).ok_or("Conversation not found")?;
    let events = markdown_files(&base_dir().join("brain").join(id))
        .into_iter()
        .filter_map(|f| {
            let text = std::fs::read_to_string(&f).ok()?;
            Some(SessionEvent {
                ts: mtime_ms(&f),
                kind: "reply".into(),
                text: truncate(&text, 4000),
                detail: f.file_name().map(|n| n.to_string_lossy().into_owned()),
                risk: None,
                notice: None,
                matched: None,
            })
        })
        .collect();
    Ok(SessionDetail { session, events })
}
