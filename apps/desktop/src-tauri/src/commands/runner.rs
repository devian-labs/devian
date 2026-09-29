use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use regex::Regex;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

// ─── State ────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RunningScript {
    pub key: String,         // "{path}::{script}"
    pub project_path: String,
    pub script: String,
    pub pid: u32,
    pub port: Option<u16>,   // discovered port, if any
}

pub struct ScriptRegistry {
    pub processes: Mutex<HashMap<String, (u32, Option<u16>)>>, // key -> (pid, port)
}

impl ScriptRegistry {
    pub fn new() -> Self {
        Self { processes: Mutex::new(HashMap::new()) }
    }
}

fn make_key(path: &str, script: &str) -> String {
    format!("{}::{}", path, script)
}

// ─── Port detection ───────────────────────────────────────────────────────────

fn detect_port(line: &str) -> Option<u16> {
    // Common patterns emitted by dev servers:
    //  - "localhost:3000", "127.0.0.1:3000", "0.0.0.0:3000"
    //  - "ready on port 3000", "listening on port 3000", "Port 3000"
    //  - "http://localhost:3000", "started on :3000"
    let re = Regex::new(
        r"(?i)(?:localhost|127\.0\.0\.1|0\.0\.0\.0|port|:)\s*:?\s*(\d{2,5})"
    ).ok()?;
    for cap in re.captures_iter(line) {
        if let Some(m) = cap.get(1) {
            if let Ok(port) = m.as_str().parse::<u16>() {
                if port >= 1024 {
                    return Some(port);
                }
            }
        }
    }
    None
}

// ─── Commands ─────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn run_script_background(
    app: AppHandle,
    path: String,
    script: String,
) -> Result<u32, String> {
    let key = make_key(&path, &script);
    let registry = app.state::<Arc<ScriptRegistry>>();

    // Kill existing process for same key if running
    {
        let mut map = registry.processes.lock().unwrap();
        if let Some((old_pid, _)) = map.remove(&key) {
            #[cfg(not(target_os = "windows"))]
            let _ = Command::new("kill").arg(old_pid.to_string()).status();
            #[cfg(target_os = "windows")]
            let _ = Command::new("taskkill").args(["/F", "/PID", &old_pid.to_string()]).status();
        }
    }

    #[cfg(target_os = "windows")]
    let mut child: Child = {
        let cmd = format!("cd /d \"{}\" && npm run {}", path, script);
        Command::new("cmd")
            .args(["/C", &cmd])
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("Failed to start script: {}", e))?
    };
    #[cfg(not(target_os = "windows"))]
    let mut child: Child = {
        let safe_path = path.replace('\'', "'\\''");
        let cmd = format!("cd '{}' && npm run {}", safe_path, script);
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string());
        Command::new(&shell)
            .arg("-i")
            .arg("-c")
            .arg(&cmd)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("Failed to start script: {}", e))?
    };

    let pid = child.id();

    // Register immediately so UI knows it's running
    {
        let mut map = registry.processes.lock().unwrap();
        map.insert(key.clone(), (pid, None));
    }

    // Emit started event
    let _ = app.emit("script:started", RunningScript {
        key: key.clone(),
        project_path: path.clone(),
        script: script.clone(),
        pid,
        port: None,
    });

    // Spawn background thread to watch stdout for port
    let app_clone = app.clone();
    let key_clone = key.clone();
    let path_clone = path.clone();
    let script_clone = script.clone();
    let registry_clone = registry.inner().clone();

    std::thread::spawn(move || {
        let stdout = child.stdout.take();
        let stderr = child.stderr.take();

        // Thread for stderr
        let app_err = app_clone.clone();
        let key_err = key_clone.clone();
        if let Some(stderr_pipe) = stderr {
            std::thread::spawn(move || {
                let reader = BufReader::new(stderr_pipe);
                for line in reader.lines().flatten() {
                    let _ = app_err.emit("script:output", serde_json::json!({
                        "key": key_err,
                        "line": line,
                        "stream": "stderr"
                    }));
                }
            });
        }

        // Read stdout lines for port detection AND output streaming
        if let Some(stdout_pipe) = stdout {
            let reader = BufReader::new(stdout_pipe);
            for line in reader.lines().flatten() {
                // Stream to frontend console
                let _ = app_clone.emit("script:output", serde_json::json!({
                    "key": key_clone,
                    "line": line.clone(),
                    "stream": "stdout"
                }));

                // Check for port
                if let Some(port) = detect_port(&line) {
                    let mut map = registry_clone.processes.lock().unwrap();
                    if let Some(entry) = map.get_mut(&key_clone) {
                        if entry.1.is_none() {
                            entry.1 = Some(port);
                            let _ = app_clone.emit("script:port_detected", RunningScript {
                                key: key_clone.clone(),
                                project_path: path_clone.clone(),
                                script: script_clone.clone(),
                                pid: entry.0,
                                port: Some(port),
                            });
                        }
                    }
                }
            }
        }

        // Wait for process to exit
        let _ = child.wait();

        // Remove from registry and emit stopped
        let mut map = registry_clone.processes.lock().unwrap();
        map.remove(&key_clone);
        let _ = app_clone.emit("script:stopped", serde_json::json!({
            "key": key_clone,
            "project_path": path_clone,
            "script": script_clone,
        }));
    });

    Ok(pid)
}

#[tauri::command]
pub async fn stop_running_script(
    app: AppHandle,
    path: String,
    script: String,
) -> Result<(), String> {
    let key = make_key(&path, &script);
    let registry = app.state::<Arc<ScriptRegistry>>();
    let mut map = registry.processes.lock().unwrap();

    if let Some((pid, _)) = map.remove(&key) {
        #[cfg(not(target_os = "windows"))]
        {
            // Kill all child processes first (e.g. vite/next/node spawned by npm)
            let _ = Command::new("pkill")
                .args(["-TERM", "-P", &pid.to_string()])
                .status();
            // Small delay so children can exit before parent
            std::thread::sleep(std::time::Duration::from_millis(300));
            // Then kill the parent shell process
            let _ = Command::new("kill")
                .args(["-9", &pid.to_string()])
                .status();
        }
        #[cfg(target_os = "windows")]
        {
            // /T kills the process tree (children + parent), /F forces immediate termination
            let _ = Command::new("taskkill")
                .args(["/F", "/T", "/PID", &pid.to_string()])
                .status();
        }
        let _ = app.emit("script:stopped", serde_json::json!({
            "key": key,
            "project_path": path,
            "script": script,
        }));
        Ok(())
    } else {
        Err("Script is not running".to_string())
    }
}

#[tauri::command]
pub async fn get_running_scripts(app: AppHandle) -> Vec<RunningScript> {
    let registry = app.state::<Arc<ScriptRegistry>>();
    let map = registry.processes.lock().unwrap();
    map.iter().map(|(key, (pid, port))| {
        let parts: Vec<&str> = key.splitn(2, "::").collect();
        RunningScript {
            key: key.clone(),
            project_path: parts.first().unwrap_or(&"").to_string(),
            script: parts.get(1).unwrap_or(&"").to_string(),
            pid: *pid,
            port: *port,
        }
    }).collect()
}
