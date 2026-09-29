//! Codex (CLI, IDE extension and desktop app): rollout transcripts in
//! `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` (and `archived_sessions/`).

use super::{cached_parse, home, parse_ts, risk, title_from_prompt, truncate, AgentSession, SessionDetail, SessionEvent, TokenUsage};
use serde_json::Value;
use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};

pub fn codex_home() -> PathBuf {
    std::env::var("CODEX_HOME").map(PathBuf::from).unwrap_or_else(|_| home().join(".codex"))
}

pub fn rollout_files() -> Vec<PathBuf> {
    let base = codex_home();
    ["sessions", "archived_sessions"]
        .iter()
        .flat_map(|d| walkdir::WalkDir::new(base.join(d)).max_depth(5).into_iter().flatten())
        .map(|e| e.into_path())
        .filter(|p| {
            p.extension().is_some_and(|x| x == "jsonl")
                && p.file_name().is_some_and(|n| n.to_string_lossy().starts_with("rollout-"))
        })
        .collect()
}

fn thread_names() -> HashMap<String, String> {
    let mut names = HashMap::new();
    let Ok(f) = std::fs::File::open(codex_home().join("session_index.jsonl")) else { return names };
    for line in BufReader::new(f).lines().map_while(Result::ok) {
        if let Ok(o) = serde_json::from_str::<Value>(&line) {
            if let (Some(id), Some(n)) = (o["id"].as_str(), o["thread_name"].as_str()) {
                names.insert(id.to_string(), n.to_string());
            }
        }
    }
    names
}

/// Codex Desktop can import other agents' transcripts (e.g. Claude Code) as
/// its own threads. Those are copies, so they're skipped to avoid double counting.
fn imported_thread_ids() -> std::collections::HashSet<String> {
    std::fs::read_to_string(codex_home().join("external_agent_session_imports.json"))
        .ok()
        .and_then(|t| serde_json::from_str::<Value>(&t).ok())
        .and_then(|v| v["records"].as_array().cloned())
        .unwrap_or_default()
        .iter()
        .filter_map(|r| r["imported_thread_id"].as_str().map(String::from))
        .collect()
}

pub fn list_sessions() -> Vec<AgentSession> {
    let names = thread_names();
    let imported = imported_thread_ids();
    rollout_files()
        .iter()
        .filter_map(|f| cached_parse(f, |p| Some(parse(p, None))))
        .filter(|s| s.message_count > 0 && !imported.contains(&s.id))
        .map(|mut s| {
            if let Some(n) = names.get(&s.id) {
                s.title = n.clone();
            }
            s.finish();
            s
        })
        .collect()
}

pub fn detail(path: &Path) -> Result<SessionDetail, String> {
    let base = codex_home();
    if !path.starts_with(base.join("sessions")) && !path.starts_with(base.join("archived_sessions")) {
        return Err("Not a Codex rollout".into());
    }
    let mut events = Vec::new();
    let mut session = parse(path, Some(&mut events));
    if let Some(n) = thread_names().get(&session.id) {
        session.title = n.clone();
    }
    session.finish();
    Ok(SessionDetail { session, events })
}

fn shell_text(cmd: &Value) -> String {
    match cmd {
        Value::String(s) => s.clone(),
        Value::Array(parts) => {
            let parts: Vec<&str> = parts.iter().filter_map(Value::as_str).collect();
            // ["/bin/zsh", "-lc", "<script>"] → "<script>"
            if parts.len() >= 3 && (parts[1] == "-lc" || parts[1] == "-c") {
                parts[2..].join(" ")
            } else {
                parts.join(" ")
            }
        }
        _ => String::new(),
    }
}

fn patch_files(patch: &str) -> Vec<String> {
    patch
        .lines()
        .filter_map(|l| {
            ["*** Add File: ", "*** Update File: ", "*** Delete File: "]
                .iter()
                .find_map(|p| l.strip_prefix(p))
                .map(|f| f.trim().to_string())
        })
        .collect()
}

struct Parser<'a> {
    s: AgentSession,
    events: Option<&'a mut Vec<SessionEvent>>,
    last_total: TokenUsage,
    last_cmd: Option<(String, i64)>,
    /// File changes are resolved at the end, once the real project is known.
    pending_files: Vec<(i64, String, &'static str)>,
    cmd_cwds: HashMap<String, usize>,
}

impl Parser<'_> {
    fn command(&mut self, ts: i64, cmd: String, cwd: Option<String>) {
        if cmd.trim().is_empty() {
            return;
        }
        // The same command can surface both as a tool call and as a completed item.
        if let Some((prev, pts)) = &self.last_cmd {
            if *prev == cmd && (ts - pts).abs() < 15_000 {
                return;
            }
        }
        self.last_cmd = Some((cmd.clone(), ts));
        self.s.command_count += 1;
        if let Some(c) = &cwd {
            *self.cmd_cwds.entry(c.trim_start_matches("file://").to_string()).or_insert(0) += 1;
        }
        let (r, notice, matched) = super::apply_finding(&mut self.s, risk::command_risk(&cmd));
        if let Some(ev) = self.events.as_deref_mut() {
            let detail = cwd.map(|c| c.trim_start_matches("file://").to_string());
            ev.push(SessionEvent { ts, kind: "command".into(), text: truncate(&cmd, 2000), detail, risk: r, notice, matched });
        }
    }

    fn file(&mut self, ts: i64, path: String, kind: &'static str) {
        self.pending_files.push((ts, path, kind));
    }

    /// Codex Desktop starts threads in scratch folders (`~/Documents/Codex/<date>/…`)
    /// and works on a real repo from there; prefer where the commands actually ran.
    fn resolve_project(&mut self) {
        let scratch = self.s.project_path.as_deref().is_none_or(|p| p.contains("/Documents/Codex/") || !super::is_meaningful_project(p));
        if scratch {
            if let Some((cwd, _)) = self
                .cmd_cwds
                .iter()
                .filter(|(c, _)| super::is_meaningful_project(c))
                .max_by_key(|(_, n)| **n)
            {
                self.s.project_path = Some(cwd.clone());
            }
        }
        for (ts, path, kind) in std::mem::take(&mut self.pending_files) {
            self.s.touch_file(&path);
            let finding = risk::file_risk(&path, self.s.project_path.as_deref());
            let (r, notice, matched) = super::apply_finding(&mut self.s, finding);
            if let Some(ev) = self.events.as_deref_mut() {
                ev.push(SessionEvent { ts, kind: kind.into(), text: path, detail: None, risk: r, notice, matched });
            }
        }
    }

    fn prompt(&mut self, ts: i64, text: &str) {
        let t = text.trim();
        if t.is_empty() || t.starts_with("<command-") || t.starts_with("<environment_context") || t.starts_with("<user_instructions") {
            return;
        }
        self.s.message_count += 1;
        self.s.see_ts(ts);
        if self.s.title.is_empty() {
            self.s.title = title_from_prompt(t);
        }
        if let Some(ev) = self.events.as_deref_mut() {
            ev.push(SessionEvent { ts, kind: "prompt".into(), text: truncate(t, 2000), detail: None, risk: None, notice: None, matched: None });
        }
    }

    fn tokens(&mut self, ts: i64, total: &Value) {
        let n = |k: &str| total.get(k).and_then(Value::as_u64).unwrap_or(0);
        let cached = n("cached_input_tokens");
        let cur = TokenUsage {
            input: n("input_tokens").saturating_sub(cached),
            output: n("output_tokens"),
            cache_read: cached,
            cache_write: n("cache_write_input_tokens"),
            reasoning: n("reasoning_output_tokens"),
        };
        // Totals are cumulative per thread; a smaller total means the counter restarted.
        let delta = if cur.total() >= self.last_total.total() {
            TokenUsage {
                input: cur.input.saturating_sub(self.last_total.input),
                output: cur.output.saturating_sub(self.last_total.output),
                cache_read: cur.cache_read.saturating_sub(self.last_total.cache_read),
                cache_write: cur.cache_write.saturating_sub(self.last_total.cache_write),
                reasoning: cur.reasoning.saturating_sub(self.last_total.reasoning),
            }
        } else {
            cur.clone()
        };
        self.s.add_daily(ts, delta.total());
        self.s.tokens.add(&delta);
        self.last_total = cur;
    }
}

fn parse(path: &Path, events: Option<&mut Vec<SessionEvent>>) -> AgentSession {
    let file_id = path
        .file_stem()
        .map(|s| s.to_string_lossy().chars().rev().take(36).collect::<String>().chars().rev().collect())
        .unwrap_or_default();
    let mut p = Parser {
        s: AgentSession {
            agent: "codex".into(),
            id: file_id,
            source_path: path.to_string_lossy().into_owned(),
            size_bytes: std::fs::metadata(path).map(|m| m.len()).unwrap_or(0),
            ..Default::default()
        },
        events,
        last_total: TokenUsage::default(),
        last_cmd: None,
        pending_files: Vec::new(),
        cmd_cwds: HashMap::new(),
    };
    let Ok(f) = std::fs::File::open(path) else { return p.s };
    let mut fallback_prompts: Vec<(i64, String)> = Vec::new();
    let mut saw_user_message = false;

    for line in BufReader::new(f).lines().map_while(Result::ok) {
        let Ok(o) = serde_json::from_str::<Value>(&line) else { continue };
        let ts = o.get("timestamp").and_then(Value::as_str).map(parse_ts).unwrap_or(0);
        let payload = &o["payload"];
        let ptype = payload.get("type").and_then(Value::as_str).unwrap_or("");
        match o.get("type").and_then(Value::as_str).unwrap_or("") {
            "session_meta" => {
                if let Some(id) = payload["id"].as_str() {
                    p.s.id = id.to_string();
                }
                if let Some(cwd) = payload["cwd"].as_str() {
                    p.s.project_path = Some(cwd.to_string());
                }
                p.s.see_ts(payload["timestamp"].as_str().map(parse_ts).unwrap_or(ts));
            }
            "turn_context" => {
                if let Some(m) = payload["model"].as_str() {
                    p.s.add_model(m);
                }
                if p.s.project_path.is_none() {
                    p.s.project_path = payload["cwd"].as_str().map(String::from);
                }
            }
            "event_msg" => match ptype {
                "user_message" => {
                    saw_user_message = true;
                    p.prompt(ts, payload["message"].as_str().unwrap_or(""));
                }
                "token_count" => {
                    p.s.see_ts(ts);
                    if let Some(total) = payload["info"].get("total_token_usage") {
                        p.tokens(ts, total);
                    }
                }
                "item_completed" => {
                    let item = &payload["item"];
                    match item["type"].as_str().unwrap_or("") {
                        "CommandExecution" => {
                            p.s.see_ts(ts);
                            p.command(ts, shell_text(&item["command"]), item["cwd"].as_str().map(String::from));
                        }
                        "FileChange" => {
                            if let Some(changes) = item["changes"].as_object() {
                                for (file, change) in changes {
                                    let kind = if change["type"].as_str() == Some("add") { "write" } else { "edit" };
                                    p.file(ts, file.clone(), kind);
                                }
                            }
                        }
                        "UserMessage" => {
                            let text = item["content"]
                                .as_array()
                                .and_then(|c| c.iter().find_map(|x| x["text"].as_str()))
                                .unwrap_or("");
                            fallback_prompts.push((ts, text.to_string()));
                        }
                        _ => {}
                    }
                }
                _ => {}
            },
            "response_item" => match ptype {
                "message" if payload["role"].as_str() == Some("assistant") => {
                    p.s.see_ts(ts);
                    if let Some(ev) = p.events.as_deref_mut() {
                        let text = payload["content"]
                            .as_array()
                            .and_then(|c| c.iter().find_map(|x| x["text"].as_str()))
                            .unwrap_or("");
                        if !text.trim().is_empty() {
                            ev.push(SessionEvent { ts, kind: "reply".into(), text: truncate(text, 600), detail: None, risk: None, notice: None, matched: None });
                        }
                    }
                }
                "function_call" => {
                    let name = payload["name"].as_str().unwrap_or("");
                    let args: Value = payload["arguments"].as_str().and_then(|a| serde_json::from_str(a).ok()).unwrap_or(Value::Null);
                    if matches!(name, "shell" | "exec_command" | "shell_command" | "container.exec") {
                        let cmd = if args["command"].is_null() { &args["cmd"] } else { &args["command"] };
                        p.command(ts, shell_text(cmd), args["workdir"].as_str().map(String::from));
                    }
                }
                "local_shell_call" => {
                    p.command(ts, shell_text(&payload["action"]["command"]), None);
                }
                "custom_tool_call" if payload["name"].as_str() == Some("apply_patch") => {
                    for f in patch_files(payload["input"].as_str().unwrap_or("")) {
                        p.file(ts, f, "edit");
                    }
                }
                _ => {}
            },
            _ => {}
        }
    }
    if !saw_user_message {
        for (ts, t) in fallback_prompts {
            p.prompt(ts, &t);
        }
    }
    p.resolve_project();
    if let Some(ev) = p.events.as_deref_mut() {
        ev.sort_by_key(|e| e.ts);
    }
    p.s
}
