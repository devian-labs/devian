//! `devian-desktop --mcp`: a read-only MCP server over stdio.
//!
//! Lets any agent ask what is already running on the machine, pick a free port
//! instead of guessing, and see what other agents recently did in a project.
//! stdout carries protocol messages only.

use crate::agents::{self, runtime, AgentSession};
use serde_json::{json, Value};
use std::io::{BufRead, Write};

const PROTOCOL_VERSION: &str = "2025-06-18";

fn tools() -> Value {
    json!([
        {
            "name": "list_dev_servers",
            "description": "List every process listening on a local TCP port, with its command, working directory (project) and which AI agent started it, if any. Call this before starting a dev server to avoid duplicates and port conflicts.",
            "inputSchema": { "type": "object", "properties": {} }
        },
        {
            "name": "get_free_port",
            "description": "Return a free localhost TCP port. Checks `preferred` first, then scans upward from `start`.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "preferred": { "type": "integer", "description": "Port to try first, e.g. 3000" },
                    "start": { "type": "integer", "description": "Where to start scanning (default 3000)" }
                }
            }
        },
        {
            "name": "project_runtime",
            "description": "Everything running for one project: servers, background processes and Docker containers whose working directory is inside `path`, including ones left behind by earlier agent sessions.",
            "inputSchema": {
                "type": "object",
                "properties": { "path": { "type": "string", "description": "Absolute project path" } },
                "required": ["path"]
            }
        },
        {
            "name": "agent_leftovers",
            "description": "Processes and containers started by AI agent sessions that have ended but are still running.",
            "inputSchema": { "type": "object", "properties": {} }
        },
        {
            "name": "recent_agent_activity",
            "description": "Recent sessions from Claude Code, Codex, OpenCode, Cursor and Antigravity, optionally limited to one project: title, when, files changed and command count. Useful for picking up where another agent left off.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "Only sessions in this project" },
                    "limit": { "type": "integer", "description": "Max sessions (default 10)" }
                }
            }
        }
    ])
}

fn port_free(port: u16) -> bool {
    std::net::TcpListener::bind(("127.0.0.1", port)).is_ok() && std::net::TcpListener::bind(("0.0.0.0", port)).is_ok()
}

fn session_json(s: &AgentSession) -> Value {
    json!({
        "agent": agents::agent_label(&s.agent),
        "title": s.title,
        "project": s.project_path,
        "started": chrono::DateTime::from_timestamp_millis(s.started_at).map(|d| d.to_rfc3339()),
        "last_active": chrono::DateTime::from_timestamp_millis(s.updated_at).map(|d| d.to_rfc3339()),
        "models": s.models,
        "commands_run": s.command_count,
        "files_changed": s.files_touched.iter().take(25).collect::<Vec<_>>(),
        "flagged_actions": s.risky_count,
    })
}

async fn call(name: &str, args: &Value) -> Result<Value, String> {
    match name {
        "list_dev_servers" => {
            let sessions = agents::commands::sessions().await;
            let rep = runtime::report(&sessions).await;
            let raw = crate::commands::network::fetch_active_ports().await.unwrap_or_default();
            let servers: Vec<Value> = raw
                .iter()
                .map(|p| {
                    let pid: u32 = p["pid"].as_str().and_then(|s| s.parse().ok()).unwrap_or(0);
                    let port: u16 = p["port"].as_str().and_then(|s| s.parse().ok()).unwrap_or(0);
                    let owner = rep.items.iter().find(|i| i.pid == Some(pid) || i.ports.contains(&port));
                    json!({
                        "port": port,
                        "address": p["full_address"],
                        "process": p["name"],
                        "pid": pid,
                        "project": owner.and_then(|o| o.project_path.clone()),
                        "started_by": owner.map(|o| agents::agent_label(&o.agent)),
                        "left_behind": owner.map(|o| o.leftover),
                    })
                })
                .collect();
            Ok(json!({ "servers": servers }))
        }
        "get_free_port" => {
            if let Some(p) = args["preferred"].as_u64().and_then(|p| u16::try_from(p).ok()) {
                if port_free(p) {
                    return Ok(json!({ "port": p, "preferred_was_free": true }));
                }
            }
            let start = args["start"].as_u64().and_then(|p| u16::try_from(p).ok()).unwrap_or(3000);
            (start..=u16::MAX)
                .find(|p| port_free(*p))
                .map(|p| json!({ "port": p, "preferred_was_free": if args["preferred"].is_null() { Value::Null } else { json!(false) } }))
                .ok_or_else(|| "No free port found".into())
        }
        "project_runtime" => {
            let path = args["path"].as_str().ok_or("`path` is required")?;
            let sessions = agents::commands::sessions().await;
            let rep = runtime::report(&sessions).await;
            let in_project = |p: &Option<String>| p.as_deref().is_some_and(|x| std::path::Path::new(x).starts_with(path));
            let items: Vec<_> = rep.items.iter().filter(|i| in_project(&i.cwd) || in_project(&i.project_path)).collect();
            Ok(json!({ "project": path, "running": items }))
        }
        "agent_leftovers" => {
            let sessions = agents::commands::sessions().await;
            let rep = runtime::report(&sessions).await;
            let left: Vec<_> = rep.items.iter().filter(|i| i.leftover).collect();
            Ok(json!({ "leftovers": left, "memory_bytes": rep.leftover_memory_bytes }))
        }
        "recent_agent_activity" => {
            let limit = args["limit"].as_u64().unwrap_or(10).clamp(1, 50) as usize;
            let path = args["path"].as_str();
            let sessions = agents::commands::sessions().await;
            let list: Vec<Value> = sessions
                .iter()
                .filter(|s| path.is_none_or(|p| s.project_path.as_deref().is_some_and(|sp| std::path::Path::new(sp).starts_with(p))))
                .take(limit)
                .map(session_json)
                .collect();
            Ok(json!({ "sessions": list }))
        }
        _ => Err(format!("Unknown tool: {name}")),
    }
}

async fn handle(msg: Value) -> Option<Value> {
    let id = msg.get("id").cloned();
    let method = msg["method"].as_str().unwrap_or("");
    // Notifications carry no id and get no response.
    let id = id?;
    let result = match method {
        "initialize" => Ok(json!({
            "protocolVersion": msg["params"]["protocolVersion"].as_str().unwrap_or(PROTOCOL_VERSION),
            "capabilities": { "tools": {} },
            "serverInfo": { "name": "devian", "version": env!("CARGO_PKG_VERSION") },
            "instructions": "Devian sees what is running on this machine and what AI agents did. Use list_dev_servers or get_free_port before starting servers, and project_runtime to find existing ones."
        })),
        "ping" => Ok(json!({})),
        "tools/list" => Ok(json!({ "tools": tools() })),
        "tools/call" => {
            let name = msg["params"]["name"].as_str().unwrap_or("");
            let args = msg["params"].get("arguments").cloned().unwrap_or(json!({}));
            Ok(match call(name, &args).await {
                Ok(v) => json!({
                    "content": [{ "type": "text", "text": serde_json::to_string_pretty(&v).unwrap_or_default() }],
                    "structuredContent": v
                }),
                Err(e) => json!({ "content": [{ "type": "text", "text": e }], "isError": true }),
            })
        }
        _ => Err(json!({ "code": -32601, "message": format!("Method not found: {method}") })),
    };
    Some(match result {
        Ok(r) => json!({ "jsonrpc": "2.0", "id": id, "result": r }),
        Err(e) => json!({ "jsonrpc": "2.0", "id": id, "error": e }),
    })
}

pub fn run() {
    crate::commands::os_utils::fix_macos_path();
    let rt = tokio::runtime::Builder::new_multi_thread().enable_all().build().expect("tokio runtime");
    let stdin = std::io::stdin();
    let mut stdout = std::io::stdout();
    for line in stdin.lock().lines().map_while(Result::ok) {
        if line.trim().is_empty() {
            continue;
        }
        let response = match serde_json::from_str::<Value>(&line) {
            Ok(msg) => rt.block_on(handle(msg)),
            Err(e) => Some(json!({ "jsonrpc": "2.0", "id": null, "error": { "code": -32700, "message": e.to_string() } })),
        };
        if let Some(r) = response {
            let _ = writeln!(stdout, "{r}");
            let _ = stdout.flush();
        }
    }
}
