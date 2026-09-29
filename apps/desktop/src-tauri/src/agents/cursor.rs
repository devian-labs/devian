//! Cursor: composer (agent) conversations in the global `state.vscdb`
//! key-value store. Cursor syncs much of its history to its own cloud, so what
//! is readable locally is partial.
//!
//! The composer records also hold encryption keys and other internals; only
//! the specific fields below are ever read out.

use super::{app_support_dir, risk, title_from_prompt, truncate, AgentSession, SessionDetail, SessionEvent, TokenUsage};
use rusqlite::Connection;
use serde_json::Value;
use std::collections::HashMap;
use std::path::PathBuf;

pub fn state_db_path() -> PathBuf {
    app_support_dir("Cursor").join("User/globalStorage/state.vscdb")
}

fn db() -> Option<Connection> {
    super::opencode::open_db(&state_db_path())
}

fn find_fs_path(v: &Value, depth: u8) -> Option<String> {
    if depth > 4 {
        return None;
    }
    match v {
        Value::Object(m) => {
            for k in ["fsPath", "path", "rootPath"] {
                if let Some(s) = m.get(k).and_then(Value::as_str).filter(|s| s.starts_with('/') || s.contains(":\\")) {
                    return Some(s.to_string());
                }
            }
            m.values().find_map(|x| find_fs_path(x, depth + 1))
        }
        Value::Array(a) => a.iter().find_map(|x| find_fs_path(x, depth + 1)),
        _ => None,
    }
}

fn composer_session(id: &str, v: &Value) -> Option<AgentSession> {
    let headers = v["fullConversationHeadersOnly"].as_array().map(Vec::len).unwrap_or(0);
    if headers == 0 && v["conversation"].as_array().map(Vec::len).unwrap_or(0) == 0 {
        return None;
    }
    let mut s = AgentSession {
        agent: "cursor".into(),
        id: id.to_string(),
        title: v["name"].as_str().unwrap_or("").to_string(),
        project_path: find_fs_path(&v["workspaceIdentifier"], 0).or_else(|| find_fs_path(&v["trackedGitRepos"], 0)),
        started_at: v["createdAt"].as_i64().unwrap_or(0),
        updated_at: v["lastUpdatedAt"].as_i64().or(v["createdAt"].as_i64()).unwrap_or(0),
        message_count: headers as u32,
        source_path: state_db_path().to_string_lossy().into_owned(),
        partial: true,
        ..Default::default()
    };
    if let Some(m) = v["modelConfig"]["modelName"].as_str() {
        s.add_model(m);
    }
    Some(s)
}

/// Applies one bubble (message) to its session and returns its timeline event.
fn apply_bubble(s: &mut AgentSession, b: &Value) -> Option<SessionEvent> {
    let ts = b["createdAt"]
        .as_i64()
        .or_else(|| b["createdAt"].as_str().map(super::parse_ts))
        .unwrap_or(s.updated_at);
    let tc = &b["tokenCount"];
    let u = TokenUsage {
        input: tc["inputTokens"].as_u64().unwrap_or(0),
        output: tc["outputTokens"].as_u64().unwrap_or(0),
        ..Default::default()
    };
    s.add_daily(ts, u.total());
    s.tokens.add(&u);

    let tool = &b["toolFormerData"];
    if let Some(name) = tool["name"].as_str() {
        let args: Value = tool["rawArgs"]
            .as_str()
            .and_then(|a| serde_json::from_str(a).ok())
            .or_else(|| tool["params"].as_str().and_then(|a| serde_json::from_str(a).ok()))
            .unwrap_or(Value::Null);
        let arg = |k: &str| args[k].as_str().unwrap_or("").to_string();
        if name.contains("terminal") || name.contains("shell") {
            let cmd = arg("command");
            s.command_count += 1;
            let (r, notice, matched) = super::apply_finding(s, risk::command_risk(&cmd));
            return Some(SessionEvent { ts, kind: "command".into(), text: truncate(&cmd, 2000), detail: None, risk: r, notice, matched });
        }
        if name.contains("edit") || name.contains("write") || name.contains("replace") {
            let file = [arg("target_file"), arg("file_path"), arg("path")].into_iter().find(|f| !f.is_empty())?;
            s.touch_file(&file);
            let (r, notice, matched) = super::apply_finding(s, risk::file_risk(&file, s.project_path.as_deref()));
            return Some(SessionEvent { ts, kind: "edit".into(), text: file, detail: None, risk: r, notice, matched });
        }
        return Some(SessionEvent { ts, kind: "tool".into(), text: name.to_string(), detail: None, risk: None, notice: None, matched: None });
    }
    let text = b["text"].as_str().unwrap_or("");
    if text.trim().is_empty() {
        return None;
    }
    let user = b["type"].as_i64() == Some(1);
    if user && s.title.is_empty() {
        s.title = title_from_prompt(text);
    }
    Some(SessionEvent {
        ts,
        kind: if user { "prompt" } else { "reply" }.into(),
        text: truncate(text, if user { 2000 } else { 600 }),
        detail: None,
        risk: None,
        notice: None,
        matched: None,
    })
}

fn kv_rows(conn: &Connection, pattern: &str) -> Vec<(String, Value)> {
    let Ok(mut stmt) = conn.prepare("SELECT key, CAST(value AS TEXT) FROM cursorDiskKV WHERE key LIKE ?1") else { return vec![] };
    let Ok(rows) = stmt.query_map([pattern], |r| Ok((r.get::<_, String>(0)?, r.get::<_, Option<String>>(1)?))) else { return vec![] };
    rows.flatten()
        .filter_map(|(k, v)| Some((k, serde_json::from_str::<Value>(&v?).ok()?)))
        .collect()
}

pub fn list_sessions() -> Vec<AgentSession> {
    let Some(conn) = db() else { return vec![] };
    let mut sessions: HashMap<String, AgentSession> = kv_rows(&conn, "composerData:%")
        .into_iter()
        .filter_map(|(k, v)| {
            let id = k.trim_start_matches("composerData:").to_string();
            composer_session(&id, &v).map(|s| (id, s))
        })
        .collect();
    for (k, b) in kv_rows(&conn, "bubbleId:%") {
        let composer = k.split(':').nth(1).unwrap_or("");
        if let Some(s) = sessions.get_mut(composer) {
            apply_bubble(s, &b);
        }
    }
    sessions
        .into_values()
        .map(|mut s| {
            s.finish();
            s
        })
        .collect()
}

pub fn detail(id: &str) -> Result<SessionDetail, String> {
    let conn = db().ok_or("Cursor state database not found")?;
    let (_, v) = kv_rows(&conn, &format!("composerData:{id}"))
        .into_iter()
        .next()
        .ok_or("Conversation not found")?;
    let mut session = composer_session(id, &v).ok_or("Conversation is empty")?;
    let mut events: Vec<SessionEvent> = kv_rows(&conn, &format!("bubbleId:{id}:%"))
        .iter()
        .filter_map(|(_, b)| apply_bubble(&mut session, b))
        .collect();
    events.sort_by_key(|e| e.ts);
    session.finish();
    Ok(SessionDetail { session, events })
}
