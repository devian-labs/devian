//! Detects whether each agent already has Devian's MCP server configured, and
//! adds it on request. Claude Code is configured through its own CLI; the
//! others through their config files, which are backed up before any write.
//! OpenCode's config is JSONC (comments), so it's left to the user.

use super::{codex::codex_home, home};
use serde::Serialize;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

#[derive(Serialize, Clone)]
pub struct McpStatus {
    pub agent: String,
    pub connected: bool,
    /// Devian can add itself without the user editing files.
    pub can_connect: bool,
    pub config_path: String,
    pub note: Option<String>,
}

/// Why the running binary's path shouldn't be written into agent configs, if it
/// shouldn't. macOS runs quarantined apps opened outside /Applications from a
/// random temporary copy (App Translocation), and a DMG path disappears on eject.
pub fn unstable_location(path: &str) -> Option<String> {
    if path.contains("/AppTranslocation/") {
        return Some("macOS is running Devian from a temporary copy. Move Devian to your Applications folder, reopen it, then connect.".into());
    }
    if path.starts_with("/Volumes/") {
        return Some("Devian is running from the disk image. Drag it to your Applications folder, reopen it, then connect.".into());
    }
    None
}

fn exe() -> Result<String, String> {
    let p = std::env::current_exe().map(|p| p.to_string_lossy().into_owned()).map_err(|e| e.to_string())?;
    match unstable_location(&p) {
        Some(why) => Err(why),
        None => Ok(p),
    }
}

fn cursor_config() -> PathBuf {
    home().join(".cursor/mcp.json")
}

fn antigravity_config() -> PathBuf {
    home().join(".gemini/config/mcp_config.json")
}

fn opencode_config() -> PathBuf {
    let dir = home().join(".config/opencode");
    let jsonc = dir.join("opencode.jsonc");
    if jsonc.exists() { jsonc } else { dir.join("opencode.json") }
}

fn read_json(p: &Path) -> Option<Value> {
    serde_json::from_str(&std::fs::read_to_string(p).ok()?).ok()
}

fn has_server(v: Option<Value>, key: &str) -> bool {
    v.map(|v| v[key].get("devian").is_some()).unwrap_or(false)
}

fn claude_cli() -> Option<PathBuf> {
    let candidates = [home().join(".local/bin/claude"), home().join(".claude/local/claude"), PathBuf::from("/opt/homebrew/bin/claude"), PathBuf::from("/usr/local/bin/claude")];
    candidates.into_iter().find(|p| p.exists()).or_else(|| {
        let finder = if cfg!(target_os = "windows") { "where" } else { "which" };
        let out = std::process::Command::new(finder).arg("claude").output().ok()?;
        let s = String::from_utf8_lossy(&out.stdout).lines().next().unwrap_or("").trim().to_string();
        (!s.is_empty()).then(|| PathBuf::from(s))
    })
}

pub fn status() -> Vec<McpStatus> {
    let claude_json = home().join(".claude.json");
    let claude_connected = read_json(&claude_json)
        .map(|v| v["mcpServers"].get("devian").is_some() || v["projects"].as_object().is_some_and(|p| p.values().any(|x| x["mcpServers"].get("devian").is_some())))
        .unwrap_or(false);
    let codex_toml = codex_home().join("config.toml");
    let codex_connected = std::fs::read_to_string(&codex_toml).map(|t| t.contains("[mcp_servers.devian]")).unwrap_or(false);
    let oc = opencode_config();
    let oc_connected = std::fs::read_to_string(&oc).map(|t| t.contains("\"devian\"")).unwrap_or(false);
    let has_claude_cli = claude_cli().is_some();
    let current = std::env::current_exe().map(|p| p.to_string_lossy().into_owned()).unwrap_or_default();
    // A connection made from another copy of Devian (an old build, a dev build)
    // still counts as connected, but the user should know it points elsewhere.
    let points_elsewhere = |path: &Path| {
        !current.is_empty() && std::fs::read_to_string(path).is_ok_and(|t| points_to_other_copy(&t, &current))
    };
    let mut list = vec![
        McpStatus {
            agent: "claude".into(),
            connected: claude_connected,
            can_connect: has_claude_cli,
            config_path: claude_json.to_string_lossy().into_owned(),
            note: (!has_claude_cli).then(|| "The claude CLI wasn't found; run the command yourself.".into()),
        },
        McpStatus { agent: "codex".into(), connected: codex_connected, can_connect: true, config_path: codex_toml.to_string_lossy().into_owned(), note: None },
        McpStatus { agent: "cursor".into(), connected: has_server(read_json(&cursor_config()), "mcpServers"), can_connect: true, config_path: cursor_config().to_string_lossy().into_owned(), note: None },
        McpStatus {
            agent: "opencode".into(),
            connected: oc_connected,
            can_connect: false,
            config_path: oc.to_string_lossy().into_owned(),
            note: Some("OpenCode's config can contain comments, so add the snippet yourself.".into()),
        },
        McpStatus {
            agent: "antigravity".into(),
            connected: has_server(read_json(&antigravity_config()), "mcpServers"),
            can_connect: true,
            config_path: antigravity_config().to_string_lossy().into_owned(),
            note: None,
        },
    ];
    for s in list.iter_mut().filter(|s| s.connected && s.agent != "opencode") {
        if points_elsewhere(Path::new(&s.config_path)) {
            s.note = Some("Connected to a different copy of Devian. Reconnect to use this one.".into());
            s.connected = false;
        }
    }
    list
}

/// True when a config mentions Devian but not this executable. JSON and TOML
/// store the path escaped, which matters for Windows backslashes.
fn points_to_other_copy(config: &str, exe: &str) -> bool {
    let escaped = serde_json::to_string(exe).unwrap_or_default();
    let escaped = escaped.trim_matches('"');
    config.contains("devian") && !config.contains(exe) && !config.contains(escaped)
}

fn backup(p: &Path) -> Result<(), String> {
    if p.exists() {
        let mut b = p.as_os_str().to_owned();
        b.push(".devian-backup");
        std::fs::copy(p, PathBuf::from(b)).map_err(|e| format!("Couldn't back up {}: {e}", p.display()))?;
    }
    Ok(())
}

/// Adds `"devian"` under `key` in a JSON config, keeping everything else.
fn merge_json(p: &Path, key: &str, server: Value) -> Result<(), String> {
    let mut v = if p.exists() {
        let text = std::fs::read_to_string(p).map_err(|e| e.to_string())?;
        if text.trim().is_empty() { json!({}) } else { serde_json::from_str::<Value>(&text).map_err(|_| format!("{} isn't plain JSON, so Devian won't edit it. Add the snippet by hand.", p.display()))? }
    } else {
        json!({})
    };
    let obj = v.as_object_mut().ok_or("Config isn't a JSON object")?;
    let servers = obj.entry(key).or_insert_with(|| json!({}));
    servers.as_object_mut().ok_or(format!("`{key}` isn't an object"))?.insert("devian".into(), server);
    backup(p)?;
    if let Some(dir) = p.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    std::fs::write(p, serde_json::to_string_pretty(&v).unwrap_or_default() + "\n").map_err(|e| e.to_string())
}

/// Returns `toml` with exactly one `[mcp_servers.devian]` table pointing at
/// `exe`, dropping any earlier one and leaving every other line untouched.
fn codex_config_with_devian(toml: &str, exe: &str) -> String {
    let mut out: Vec<&str> = Vec::new();
    let mut skipping = false;
    for line in toml.lines() {
        let t = line.trim();
        if t.starts_with('[') {
            // Sub-tables like [mcp_servers.devian.env] belong to the old entry too.
            skipping = t == "[mcp_servers.devian]" || t.starts_with("[mcp_servers.devian.");
        }
        if !skipping {
            out.push(line);
        }
    }
    while out.last().is_some_and(|l| l.trim().is_empty()) {
        out.pop();
    }
    let mut text = out.join("\n");
    if !text.is_empty() {
        text.push_str("\n\n");
    }
    text.push_str(&format!("[mcp_servers.devian]\ncommand = {}\nargs = [\"--mcp\"]\n", serde_json::to_string(exe).unwrap_or_default()));
    text
}

pub fn connect(agent: &str) -> Result<String, String> {
    let exe = exe()?;
    match agent {
        "claude" => {
            let cli = claude_cli().ok_or("The claude CLI wasn't found. Copy the command from Settings instead.")?;
            // Replace any earlier entry (e.g. one pointing at an old copy of Devian).
            let _ = std::process::Command::new(&cli).args(["mcp", "remove", "devian", "--scope", "user"]).output();
            let out = std::process::Command::new(&cli)
                .args(["mcp", "add", "devian", "--scope", "user", "--", &exe, "--mcp"])
                .output()
                .map_err(|e| e.to_string())?;
            if out.status.success() {
                Ok("Claude Code will load Devian in new sessions.".into())
            } else {
                Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
            }
        }
        "codex" => {
            let p = codex_home().join("config.toml");
            let existing = std::fs::read_to_string(&p).unwrap_or_default();
            backup(&p)?;
            std::fs::write(&p, codex_config_with_devian(&existing, &exe)).map_err(|e| e.to_string())?;
            Ok("Codex will load Devian in new sessions.".into())
        }
        "cursor" => {
            merge_json(&cursor_config(), "mcpServers", json!({ "command": exe, "args": ["--mcp"] }))?;
            Ok("Cursor picks this up after a restart.".into())
        }
        "antigravity" => {
            merge_json(&antigravity_config(), "mcpServers", json!({ "command": exe, "args": ["--mcp"] }))?;
            Ok("Antigravity picks this up after a restart.".into())
        }
        _ => Err("This agent needs the snippet added by hand.".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recognises_this_copy_in_escaped_windows_paths() {
        let exe = r"C:\Program Files\Devian\devian-desktop.exe";
        let toml = codex_config_with_devian("", exe);
        assert!(!points_to_other_copy(&toml, exe), "{toml}");
        let json = serde_json::to_string_pretty(&json!({"mcpServers": {"devian": {"command": exe}}})).unwrap();
        assert!(!points_to_other_copy(&json, exe), "{json}");
        assert!(points_to_other_copy(&codex_config_with_devian("", r"D:\old\devian.exe"), exe));
    }

    #[test]
    fn merge_keeps_existing_servers_and_backs_up() {
        let dir = std::env::temp_dir().join(format!("devian-mcp-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let p = dir.join("mcp.json");
        std::fs::write(&p, r#"{"mcpServers":{"other":{"command":"x"}},"theme":"dark"}"#).unwrap();
        merge_json(&p, "mcpServers", json!({"command": "/bin/devian", "args": ["--mcp"]})).unwrap();
        let v = read_json(&p).unwrap();
        assert_eq!(v["mcpServers"]["other"]["command"], "x");
        assert_eq!(v["mcpServers"]["devian"]["args"][0], "--mcp");
        assert_eq!(v["theme"], "dark");
        assert!(dir.join("mcp.json.devian-backup").exists());
        std::fs::write(&p, "// comment\n{}").unwrap();
        assert!(merge_json(&p, "mcpServers", json!({})).is_err(), "must refuse non-JSON");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
