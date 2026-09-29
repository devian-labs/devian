//! Claude Code: `<config dir>/projects/<encoded-cwd>/<session>.jsonl`, with
//! subagent transcripts in `<session>/subagents/*.jsonl`.
//!
//! People often run several Claude Code setups side by side, each with its own
//! `CLAUDE_CONFIG_DIR` (e.g. `~/.claude-work`, `~/.claude-bedrock`). Each one
//! is an *instance* with its own sessions, memory, account and login.

use super::{cached_parse, home, parse_ts, pricing, risk, title_from_prompt, truncate, AgentSession, SessionDetail, SessionEvent, TokenUsage};
use serde::Serialize;
use serde_json::Value;
use std::collections::HashSet;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};

#[derive(Serialize, Clone, Debug)]
pub struct ClaudeInstance {
    /// Folder name, e.g. ".claude" or ".claude-work". Stable across runs.
    pub id: String,
    pub path: String,
    /// "Claude — Team", "Claude — Bedrock", ...
    pub label: String,
    /// anthropic | bedrock | vertex | custom
    pub provider: String,
    /// "Pro", "Team · Standard seat", ... when signed in to a Claude plan.
    pub plan: Option<String>,
    pub account_name: Option<String>,
    pub organization: Option<String>,
    /// True when this is the folder Claude Code uses without CLAUDE_CONFIG_DIR.
    pub is_default: bool,
    /// Keychain item Claude Code stores this instance's login under.
    #[serde(skip)]
    pub keychain_service: String,
}

impl ClaudeInstance {
    pub fn projects_dir(&self) -> PathBuf {
        Path::new(&self.path).join("projects")
    }
}

fn pretty(raw: &str) -> String {
    let s = raw.trim_start_matches("claude_").replace('_', " ");
    let mut c = s.chars();
    c.next().map(|f| f.to_uppercase().collect::<String>() + c.as_str()).unwrap_or_default()
}

/// Every Claude Code config folder on this machine.
pub fn instances() -> Vec<ClaudeInstance> {
    let h = home();
    let default_dir = h.join(".claude");
    let mut dirs: Vec<PathBuf> = std::fs::read_dir(&h)
        .map(|rd| {
            rd.flatten()
                .map(|e| e.path())
                .filter(|p| p.is_dir() && p.file_name().is_some_and(|n| n.to_string_lossy().starts_with(".claude")))
                .collect()
        })
        .unwrap_or_default();
    for extra in [std::env::var("CLAUDE_CONFIG_DIR").ok().map(PathBuf::from), Some(h.join(".config/claude"))].into_iter().flatten() {
        if extra.is_dir() && !dirs.contains(&extra) {
            dirs.push(extra);
        }
    }
    // Only folders Claude Code has actually used.
    dirs.retain(|d| d.join("projects").is_dir() || d.join("settings.json").is_file());
    dirs.sort_by_key(|d| (d != &default_dir, d.to_string_lossy().into_owned()));

    dirs.into_iter()
        .map(|dir| {
            let is_default = dir == default_dir;
            let id = dir.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
            // Account metadata only; tokens live in the keychain, not here.
            let account_file = if is_default { h.join(".claude.json") } else { dir.join(".claude.json") };
            let account: Value = std::fs::read_to_string(&account_file)
                .ok()
                .and_then(|t| serde_json::from_str::<Value>(&t).ok())
                .map(|v| v["oauthAccount"].clone())
                .unwrap_or(Value::Null);
            let settings_env: Value = std::fs::read_to_string(dir.join("settings.json"))
                .ok()
                .and_then(|t| serde_json::from_str::<Value>(&t).ok())
                .map(|v| v["env"].clone())
                .unwrap_or(Value::Null);
            let lower = id.to_lowercase();
            let provider = if settings_env["CLAUDE_CODE_USE_BEDROCK"].is_string() || lower.contains("bedrock") {
                "bedrock"
            } else if settings_env["CLAUDE_CODE_USE_VERTEX"].is_string() || lower.contains("vertex") {
                "vertex"
            } else if account.is_object() && account.get("organizationType").is_some() {
                "anthropic"
            } else {
                "custom"
            };
            let org_type = account["organizationType"].as_str().unwrap_or("");
            let organization = account["organizationName"].as_str().map(String::from);
            let account_name = account["displayName"].as_str().map(String::from);
            let plan = (provider == "anthropic").then(|| {
                let seat = account["seatTier"].as_str().map(|t| format!(" · {} seat", pretty(t.trim_start_matches("team_").trim_start_matches("enterprise_"))));
                format!("{}{}", pretty(org_type), seat.unwrap_or_default())
            });
            let is_org = org_type.contains("team") || org_type.contains("enterprise");
            let label = match provider {
                "bedrock" => "Claude — Bedrock".to_string(),
                "vertex" => "Claude — Vertex".to_string(),
                "anthropic" if is_org => format!("Claude — {}", organization.clone().unwrap_or_else(|| pretty(org_type))),
                "anthropic" => format!("Claude — {}", account_name.clone().unwrap_or_else(|| pretty(org_type))),
                _ if is_default => "Claude Code".to_string(),
                _ => format!("Claude — {}", id.trim_start_matches(".claude").trim_start_matches('-')),
            };
            // Claude Code keys each config dir's login by the first 8 hex
            // chars of sha256(dir path); the default dir has no suffix.
            let keychain_service = if is_default && std::env::var("CLAUDE_CONFIG_DIR").is_err() {
                "Claude Code-credentials".to_string()
            } else {
                use sha2::{Digest, Sha256};
                let digest = Sha256::digest(dir.to_string_lossy().as_bytes());
                format!("Claude Code-credentials-{}", digest.iter().take(4).map(|b| format!("{b:02x}")).collect::<String>())
            };
            ClaudeInstance {
                id,
                path: dir.to_string_lossy().into_owned(),
                label,
                provider: provider.into(),
                plan,
                account_name,
                organization,
                is_default,
                keychain_service,
            }
        })
        .collect()
}

/// Every instance's `projects` folder.
pub fn projects_dirs() -> Vec<PathBuf> {
    instances().iter().map(|i| i.projects_dir()).collect()
}

fn jsonl_files(dir: &Path) -> Vec<PathBuf> {
    std::fs::read_dir(dir)
        .map(|rd| {
            rd.flatten()
                .map(|e| e.path())
                .filter(|p| p.extension().is_some_and(|x| x == "jsonl"))
                .collect()
        })
        .unwrap_or_default()
}

pub fn list_sessions() -> Vec<AgentSession> {
    let mut out = Vec::new();
    for inst in instances() {
        let Ok(projects) = std::fs::read_dir(inst.projects_dir()) else { continue };
        for proj in projects.flatten().map(|e| e.path()).filter(|p| p.is_dir()) {
            sessions_in(&proj, &inst.id, &mut out);
        }
    }
    out
}

fn sessions_in(proj: &Path, instance: &str, out: &mut Vec<AgentSession>) {
    {
        for file in jsonl_files(proj) {
            let Some(mut s) = cached_parse(&file, |p| Some(parse(p, None))) else { continue };
            s.instance = Some(instance.to_string());
            let stem = file.file_stem().unwrap_or_default();
            for sub in jsonl_files(&proj.join(stem).join("subagents")) {
                if let Some(sub_s) = cached_parse(&sub, |p| Some(parse(p, None))) {
                    merge_subagent(&mut s, &sub_s);
                }
            }
            s.finish();
            if s.message_count > 0 {
                out.push(s);
            }
        }
    }
}

fn merge_subagent(s: &mut AgentSession, sub: &AgentSession) {
    s.tokens.add(&sub.tokens);
    for (d, t) in &sub.daily_tokens {
        *s.daily_tokens.entry(d.clone()).or_insert(0) += t;
    }
    if let Some(c) = sub.cost_usd {
        *s.cost_usd.get_or_insert(0.0) += c;
        s.cost_estimated = true;
    }
    for (d, c) in &sub.daily_cost {
        *s.daily_cost.entry(d.clone()).or_insert(0.0) += c;
    }
    s.command_count += sub.command_count;
    s.risky_count += sub.risky_count;
    s.size_bytes += sub.size_bytes;
    for m in &sub.models {
        s.add_model(m);
    }
    for f in &sub.files_touched {
        s.touch_file(f);
    }
    if sub.updated_at > s.updated_at {
        s.updated_at = sub.updated_at;
    }
}

pub fn detail(path: &Path) -> Result<SessionDetail, String> {
    let Some(inst) = instances().into_iter().find(|i| path.starts_with(i.projects_dir())) else {
        return Err("Not a Claude Code transcript".into());
    };
    let mut events = Vec::new();
    let mut session = parse(path, Some(&mut events));
    session.instance = Some(inst.id);
    let stem = path.file_stem().unwrap_or_default();
    let sub_dir = path.parent().unwrap_or(Path::new("")).join(stem).join("subagents");
    for sub in jsonl_files(&sub_dir) {
        let mut sub_events = Vec::new();
        let sub_s = parse(&sub, Some(&mut sub_events));
        merge_subagent(&mut session, &sub_s);
        events.extend(sub_events.into_iter().map(|mut e| {
            e.detail = Some(match e.detail {
                Some(d) => format!("subagent · {d}"),
                None => "subagent".into(),
            });
            e
        }));
    }
    session.finish();
    events.sort_by_key(|e| e.ts);
    Ok(SessionDetail { session, events })
}

fn usage_of(u: &Value) -> TokenUsage {
    let n = |k: &str| u.get(k).and_then(Value::as_u64).unwrap_or(0);
    TokenUsage {
        input: n("input_tokens"),
        output: n("output_tokens"),
        cache_read: n("cache_read_input_tokens"),
        cache_write: n("cache_creation_input_tokens"),
        reasoning: 0,
    }
}

fn is_user_prompt(text: &str) -> bool {
    let t = text.trim_start();
    !(t.is_empty()
        || t.starts_with("<command-")
        || t.starts_with("<local-command")
        || t.starts_with("<system-reminder>")
        || t.starts_with("Caveat:")
        || t.starts_with("[Request interrupted"))
}

fn parse(path: &Path, mut events: Option<&mut Vec<SessionEvent>>) -> AgentSession {
    let mut s = AgentSession {
        agent: "claude".into(),
        id: path.file_stem().unwrap_or_default().to_string_lossy().into_owned(),
        source_path: path.to_string_lossy().into_owned(),
        size_bytes: std::fs::metadata(path).map(|m| m.len()).unwrap_or(0),
        ..Default::default()
    };
    let Ok(f) = std::fs::File::open(path) else { return s };
    let want_events = events.is_some();
    let mut seen_msgs = HashSet::new();
    let mut seen_tools = HashSet::new();
    let (mut ai_title, mut summary, mut first_prompt) = (None, None, None);

    for line in BufReader::new(f).lines().map_while(Result::ok) {
        // Tool results are the bulk of a transcript and carry nothing we summarise.
        if !want_events && line.contains("\"tool_result\"") && !line.contains("\"type\":\"assistant\"") {
            continue;
        }
        let Ok(o) = serde_json::from_str::<Value>(&line) else { continue };
        let ts = o.get("timestamp").and_then(Value::as_str).map(parse_ts).unwrap_or(0);
        if s.project_path.is_none() {
            if let Some(cwd) = o.get("cwd").and_then(Value::as_str) {
                s.project_path = Some(cwd.to_string());
            }
        }
        match o.get("type").and_then(Value::as_str).unwrap_or("") {
            "ai-title" => ai_title = o.get("aiTitle").and_then(Value::as_str).map(String::from),
            "summary" => summary = o.get("summary").and_then(Value::as_str).map(String::from),
            "user" => {
                if o.get("isMeta").and_then(Value::as_bool) == Some(true) {
                    continue;
                }
                let content = &o["message"]["content"];
                let text = match content {
                    Value::String(t) => Some(t.clone()),
                    Value::Array(items) => items
                        .iter()
                        .find(|i| i.get("type").and_then(Value::as_str) == Some("text"))
                        .and_then(|i| i.get("text").and_then(Value::as_str))
                        .map(String::from),
                    _ => None,
                };
                if let Some(t) = text.filter(|t| is_user_prompt(t)) {
                    s.see_ts(ts);
                    s.message_count += 1;
                    if first_prompt.is_none() {
                        first_prompt = Some(title_from_prompt(&t));
                    }
                    if let Some(ev) = events.as_deref_mut() {
                        ev.push(SessionEvent { ts, kind: "prompt".into(), text: truncate(&t, 2000), detail: None, risk: None, notice: None, matched: None });
                    }
                }
            }
            "assistant" => {
                s.see_ts(ts);
                let msg = &o["message"];
                let msg_id = msg.get("id").and_then(Value::as_str).unwrap_or("").to_string();
                if seen_msgs.insert(msg_id) {
                    s.message_count += 1;
                    if let Some(m) = msg.get("model").and_then(Value::as_str) {
                        s.add_model(m);
                    }
                    let u = usage_of(&msg["usage"]);
                    s.add_daily(ts, u.total());
                    s.tokens.add(&u);
                    if let Some(c) = msg["model"].as_str().and_then(|m| pricing::claude_message_cost(m, &msg["usage"])) {
                        s.add_cost(ts, c);
                        s.cost_estimated = true;
                    }
                }
                let Some(blocks) = msg.get("content").and_then(Value::as_array) else { continue };
                for b in blocks {
                    match b.get("type").and_then(Value::as_str) {
                        Some("tool_use") => {
                            let tool_id = b.get("id").and_then(Value::as_str).unwrap_or("").to_string();
                            if !seen_tools.insert(tool_id) {
                                continue;
                            }
                            let name = b.get("name").and_then(Value::as_str).unwrap_or("");
                            let input = &b["input"];
                            record_tool(&mut s, events.as_deref_mut(), ts, name, input);
                        }
                        Some("text") if want_events => {
                            if let (Some(ev), Some(t)) = (events.as_deref_mut(), b.get("text").and_then(Value::as_str)) {
                                if !t.trim().is_empty() {
                                    ev.push(SessionEvent { ts, kind: "reply".into(), text: truncate(t, 600), detail: None, risk: None, notice: None, matched: None });
                                }
                            }
                        }
                        _ => {}
                    }
                }
            }
            _ => {}
        }
    }
    s.title = ai_title.or(summary).or(first_prompt).unwrap_or_default();
    s
}

fn record_tool(s: &mut AgentSession, events: Option<&mut Vec<SessionEvent>>, ts: i64, name: &str, input: &Value) {
    let str_of = |k: &str| input.get(k).and_then(Value::as_str).unwrap_or("").to_string();
    let (kind, text, detail, finding) = match name {
        "Bash" | "PowerShell" => {
            let cmd = str_of("command");
            s.command_count += 1;
            let r = risk::command_risk(&cmd);
            let desc = str_of("description");
            ("command", cmd, (!desc.is_empty()).then_some(desc), r)
        }
        "Edit" | "MultiEdit" | "Write" | "NotebookEdit" => {
            let file = if name == "NotebookEdit" { str_of("notebook_path") } else { str_of("file_path") };
            s.touch_file(&file);
            let r = risk::file_risk(&file, s.project_path.as_deref());
            (if name == "Write" { "write" } else { "edit" }, file, None, r)
        }
        _ => {
            let hint = ["pattern", "url", "query", "file_path", "path", "description", "prompt"]
                .iter()
                .map(|k| str_of(k))
                .find(|v| !v.is_empty())
                .unwrap_or_default();
            ("tool", name.to_string(), (!hint.is_empty()).then(|| truncate(&hint, 160)), None)
        }
    };
    let (risk, notice, matched) = super::apply_finding(s, finding);
    if let Some(ev) = events {
        ev.push(SessionEvent { ts, kind: kind.into(), text: truncate(&text, 2000), detail, risk, notice, matched });
    }
}
