//! OpenCode: sessions, messages and parts live in `opencode.db` under the XDG
//! data directory (`~/.local/share/opencode` on every platform by default).

use super::{home, risk, title_from_prompt, truncate, AgentSession, SessionDetail, SessionEvent, TokenUsage};
use rusqlite::{Connection, OpenFlags};
use serde_json::Value;
use std::collections::HashMap;
use std::path::PathBuf;

pub fn data_dir() -> PathBuf {
    std::env::var("XDG_DATA_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|_| home().join(".local/share"))
        .join("opencode")
}

pub fn open_db(path: &std::path::Path) -> Option<Connection> {
    if !path.exists() {
        return None;
    }
    Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX).ok()
}

fn db() -> Option<Connection> {
    open_db(&data_dir().join("opencode.db"))
}

fn base_sessions(conn: &Connection) -> rusqlite::Result<Vec<AgentSession>> {
    let mut stmt = conn.prepare("SELECT id, directory, title, time_created, time_updated FROM session")?;
    let rows = stmt.query_map([], |r| {
        let title: String = r.get(2)?;
        Ok(AgentSession {
            agent: "opencode".into(),
            id: r.get(0)?,
            project_path: Some(r.get::<_, String>(1)?),
            title: if title.starts_with("New session - ") { String::new() } else { title },
            started_at: r.get(3)?,
            updated_at: r.get(4)?,
            source_path: data_dir().join("opencode.db").to_string_lossy().into_owned(),
            ..Default::default()
        })
    })?;
    Ok(rows.flatten().collect())
}

fn apply_message(s: &mut AgentSession, created: i64, data: &Value) {
    s.message_count += 1;
    if data["role"].as_str() != Some("assistant") {
        return;
    }
    if let Some(m) = data["modelID"].as_str() {
        s.add_model(m);
    }
    let t = &data["tokens"];
    let n = |v: &Value| v.as_u64().unwrap_or(0);
    let u = TokenUsage {
        input: n(&t["input"]),
        output: n(&t["output"]) + n(&t["reasoning"]),
        cache_read: n(&t["cache"]["read"]),
        cache_write: n(&t["cache"]["write"]),
        reasoning: n(&t["reasoning"]),
    };
    s.add_daily(created, u.total());
    s.tokens.add(&u);
    // OpenCode records the provider's actual cost per message.
    if let Some(c) = data["cost"].as_f64().filter(|c| *c > 0.0) {
        s.add_cost(created, c);
    }
}

/// Returns the event for a tool part and updates counters on the session.
fn apply_tool(s: &mut AgentSession, created: i64, data: &Value) -> Option<SessionEvent> {
    let tool = data["tool"].as_str().unwrap_or("");
    let input = &data["state"]["input"];
    let str_of = |k: &str| input[k].as_str().unwrap_or("").to_string();
    match tool {
        "bash" => {
            let cmd = str_of("command");
            s.command_count += 1;
            let (r, notice, matched) = super::apply_finding(s, risk::command_risk(&cmd));
            let desc = str_of("description");
            Some(SessionEvent { ts: created, kind: "command".into(), text: truncate(&cmd, 2000), detail: (!desc.is_empty()).then_some(desc), risk: r, notice, matched })
        }
        "edit" | "write" | "patch" | "multiedit" => {
            let file = str_of("filePath");
            if file.is_empty() {
                return None;
            }
            s.touch_file(&file);
            let (r, notice, matched) = super::apply_finding(s, risk::file_risk(&file, s.project_path.as_deref()));
            Some(SessionEvent { ts: created, kind: if tool == "write" { "write" } else { "edit" }.into(), text: file, detail: None, risk: r, notice, matched })
        }
        _ => {
            let hint = ["pattern", "url", "query", "filePath", "description"].iter().map(|k| str_of(k)).find(|v| !v.is_empty());
            Some(SessionEvent { ts: created, kind: "tool".into(), text: tool.to_string(), detail: hint.map(|h| truncate(&h, 160)), risk: None, notice: None, matched: None })
        }
    }
}

pub fn list_sessions() -> Vec<AgentSession> {
    let Some(conn) = db() else { return vec![] };
    let Ok(sessions) = base_sessions(&conn) else { return vec![] };
    let mut by_id: HashMap<String, AgentSession> = sessions.into_iter().map(|s| (s.id.clone(), s)).collect();

    if let Ok(mut stmt) = conn.prepare("SELECT session_id, time_created, data FROM message") {
        let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?, r.get::<_, String>(2)?)));
        for (sid, created, data) in rows.into_iter().flatten().flatten() {
            if let (Some(s), Ok(v)) = (by_id.get_mut(&sid), serde_json::from_str::<Value>(&data)) {
                apply_message(s, created, &v);
            }
        }
    }
    if let Ok(mut stmt) = conn.prepare("SELECT session_id, time_created, data FROM part WHERE data LIKE '%\"type\":\"tool\"%' OR data LIKE '%\"type\":\"text\"%' ORDER BY time_created") {
        let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?, r.get::<_, String>(2)?)));
        for (sid, created, data) in rows.into_iter().flatten().flatten() {
            let (Some(s), Ok(v)) = (by_id.get_mut(&sid), serde_json::from_str::<Value>(&data)) else { continue };
            match v["type"].as_str() {
                Some("tool") => {
                    apply_tool(s, created, &v);
                }
                Some("text") if s.title.is_empty() && v["synthetic"].as_bool() != Some(true) => {
                    s.title = title_from_prompt(v["text"].as_str().unwrap_or(""));
                }
                _ => {}
            }
        }
    }
    by_id
        .into_values()
        .filter(|s| s.message_count > 0)
        .map(|mut s| {
            s.finish();
            s
        })
        .collect()
}

pub fn detail(id: &str) -> Result<SessionDetail, String> {
    let conn = db().ok_or("OpenCode database not found")?;
    let mut session = base_sessions(&conn)
        .map_err(|e| e.to_string())?
        .into_iter()
        .find(|s| s.id == id)
        .ok_or("Session not found")?;

    let mut roles: HashMap<String, String> = HashMap::new();
    let mut stmt = conn
        .prepare("SELECT id, time_created, data FROM message WHERE session_id = ?1")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([id], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?, r.get::<_, String>(2)?)))
        .map_err(|e| e.to_string())?;
    for (mid, created, data) in rows.flatten() {
        if let Ok(v) = serde_json::from_str::<Value>(&data) {
            roles.insert(mid, v["role"].as_str().unwrap_or("").to_string());
            apply_message(&mut session, created, &v);
        }
    }

    let mut events = Vec::new();
    let mut stmt = conn
        .prepare("SELECT message_id, time_created, data FROM part WHERE session_id = ?1 ORDER BY time_created")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([id], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?, r.get::<_, String>(2)?)))
        .map_err(|e| e.to_string())?;
    for (mid, created, data) in rows.flatten() {
        let Ok(v) = serde_json::from_str::<Value>(&data) else { continue };
        match v["type"].as_str() {
            Some("tool") => events.extend(apply_tool(&mut session, created, &v)),
            Some("text") if v["synthetic"].as_bool() != Some(true) => {
                let text = v["text"].as_str().unwrap_or("");
                if text.trim().is_empty() {
                    continue;
                }
                let user = roles.get(&mid).map(String::as_str) == Some("user");
                if user && session.title.is_empty() {
                    session.title = title_from_prompt(text);
                }
                events.push(SessionEvent {
                    ts: created,
                    kind: if user { "prompt" } else { "reply" }.into(),
                    text: truncate(text, if user { 2000 } else { 600 }),
                    detail: None,
                    risk: None,
                    notice: None,
                    matched: None,
                });
            }
            _ => {}
        }
    }
    session.finish();
    Ok(SessionDetail { session, events })
}
