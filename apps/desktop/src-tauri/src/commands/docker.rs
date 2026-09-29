use serde::Serialize;
use std::process::Command;

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "PascalCase")]
pub struct DockerContainerInfo {
    pub id: String,
    pub names: String,
    pub status: String,
    pub ports: String,
    pub state: String,
    pub size: String,
    pub image: String,
    pub command: String,
    pub compose_project: String,
    pub compose_service: String,
    pub compose_working_dir: String,
    pub compose_config_files: String,
    pub port_mappings: Vec<String>,
    pub project_path: String,
    pub project_name: String,
}

#[cfg(target_os = "macos")]
fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

fn parse_port_mappings(ports: &serde_json::Value) -> Vec<String> {
    let mut mappings = std::collections::BTreeSet::new();
    if let Some(obj) = ports.as_object() {
        for (container_port, bindings) in obj {
            if let Some(bindings) = bindings.as_array() {
                for binding in bindings {
                    let host_port = binding.get("HostPort").and_then(|v| v.as_str()).unwrap_or("");
                    if !host_port.is_empty() {
                        mappings.insert(format!("{} -> {}", host_port, container_port.split('/').next().unwrap_or(container_port)));
                    }
                }
            }
        }
    }
    mappings.into_iter().collect()
}

#[tauri::command]
pub async fn check_docker_status() -> Result<bool, String> {
    let output = Command::new("docker")
        .arg("info")
        .output()
        .map_err(|e| format!("Docker command not found. Is Docker Desktop installed? ({})", e))?;
    
    if output.status.success() {
        Ok(true)
    } else {
        // Capture stderr to see exactly why it failed (e.g. daemon not running)
        let err_msg = String::from_utf8_lossy(&output.stderr);
        Err(format!("Docker daemon is not running or accessible. {}", err_msg))
    }
}

#[tauri::command]
pub async fn fetch_docker_containers() -> Result<Vec<DockerContainerInfo>, String> {
    let output = Command::new("docker")
        .arg("ps")
        .arg("-a")
        .arg("--format")
        .arg("{{json .}}")
        .output()
        .map_err(|e| format!("Failed to read Docker: {}", e))?;
    
    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut base_rows = Vec::new();
    let mut ids = Vec::new();
    
    for line in stdout.lines() {
        if line.trim().is_empty() {
            continue;
        }
        if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(line) {
            if let Some(id) = parsed.get("ID").and_then(|v| v.as_str()) {
                ids.push(id.to_string());
            }
            base_rows.push(parsed);
        }
    }

    if ids.is_empty() {
        return Ok(Vec::new());
    }

    let inspect_output = Command::new("docker")
        .arg("inspect")
        .args(&ids)
        .output()
        .map_err(|e| format!("Failed to inspect Docker containers: {}", e))?;

    let inspect_rows: Vec<serde_json::Value> = if inspect_output.status.success() {
        serde_json::from_slice(&inspect_output.stdout).unwrap_or_default()
    } else {
        Vec::new()
    };

    let mut inspect_map = std::collections::HashMap::new();
    for inspect in inspect_rows {
        if let Some(id) = inspect.get("Id").and_then(|v| v.as_str()) {
            inspect_map.insert(id.to_string(), inspect.clone());
            inspect_map.insert(id.chars().take(12).collect::<String>(), inspect);
        }
    }

    let mut containers = Vec::new();
    for parsed in base_rows {
        let base_id = parsed.get("ID").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let inspect = inspect_map.get(&base_id);
        let resolved_id = inspect
            .and_then(|row| row.get("Id"))
            .and_then(|v| v.as_str())
            .unwrap_or(&base_id)
            .to_string();
        let labels = inspect
            .and_then(|row| row.get("Config"))
            .and_then(|config| config.get("Labels"))
            .and_then(|labels| labels.as_object());
        let network_ports = inspect
            .and_then(|row| row.get("NetworkSettings"))
            .and_then(|network| network.get("Ports"))
            .cloned()
            .unwrap_or(serde_json::Value::Null);

        containers.push(DockerContainerInfo {
            id: resolved_id,
            names: parsed.get("Names").and_then(|v| v.as_str()).unwrap_or("").to_string(),
            status: parsed.get("Status").and_then(|v| v.as_str()).unwrap_or("").to_string(),
            ports: parsed.get("Ports").and_then(|v| v.as_str()).unwrap_or("").to_string(),
            state: parsed.get("State").and_then(|v| v.as_str()).unwrap_or("").to_string(),
            size: parsed.get("Size").and_then(|v| v.as_str()).unwrap_or("").to_string(),
            image: parsed.get("Image").and_then(|v| v.as_str()).unwrap_or("").to_string(),
            command: parsed.get("Command").and_then(|v| v.as_str()).unwrap_or("").to_string(),
            compose_project: labels.and_then(|l| l.get("com.docker.compose.project")).and_then(|v| v.as_str()).unwrap_or("").to_string(),
            compose_service: labels.and_then(|l| l.get("com.docker.compose.service")).and_then(|v| v.as_str()).unwrap_or("").to_string(),
            compose_working_dir: labels.and_then(|l| l.get("com.docker.compose.project.working_dir")).and_then(|v| v.as_str()).unwrap_or("").to_string(),
            compose_config_files: labels.and_then(|l| l.get("com.docker.compose.project.config_files")).and_then(|v| v.as_str()).unwrap_or("").to_string(),
            port_mappings: parse_port_mappings(&network_ports),
            project_path: labels.and_then(|l| l.get("devian.project_path")).and_then(|v| v.as_str()).unwrap_or("").to_string(),
            project_name: labels.and_then(|l| l.get("devian.project_name")).and_then(|v| v.as_str()).unwrap_or("").to_string(),
        });
    }

    Ok(containers)
}

#[tauri::command]
pub async fn prune_all_docker_builds() -> Result<String, String> {
    let output = Command::new("docker")
        .arg("builder").arg("prune").arg("-a").arg("-f")
        .output();
        
    match output {
        Ok(o) if o.status.success() => Ok(String::from_utf8_lossy(&o.stdout).to_string()),
        Ok(o) => Err(String::from_utf8_lossy(&o.stderr).to_string()),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub async fn fetch_docker_system_df() -> Result<Vec<serde_json::Value>, String> {
    let output = Command::new("docker")
        .arg("system")
        .arg("df")
        .arg("--format")
        .arg("{{json .}}")
        .output()
        .map_err(|e| format!("Failed to read Docker system df: {}", e))?;
    
    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut resources = Vec::new();
    
    for line in stdout.lines() {
        if line.trim().is_empty() { continue; }
        if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(line) {
            resources.push(parsed);
        }
    }
    
    Ok(resources)
}

#[tauri::command]
pub async fn prune_docker_system() -> Result<(), String> {
    let output = Command::new("docker")
        .arg("system")
        .arg("prune")
        .arg("-a")
        .arg("-f")
        .arg("--volumes")
        .output()
        .map_err(|e| format!("Failed to execute docker system prune: {}", e))?;
    if output.status.success() { Ok(()) } else { Err(String::from_utf8_lossy(&output.stderr).to_string()) }
}

#[tauri::command]
pub async fn start_docker_container(id: String) -> Result<(), String> {
    let output = Command::new("docker")
        .arg("start")
        .arg(&id)
        .output()
        .map_err(|e| format!("Failed to execute docker start: {}", e))?;
        
    if output.status.success() {
        Ok(())
    } else {
        let err = String::from_utf8_lossy(&output.stderr);
        Err(format!("Could not start container {} ({})", id, err))
    }
}

#[tauri::command]
pub async fn stop_docker_container(id: String) -> Result<(), String> {
    let output = Command::new("docker")
        .arg("stop")
        .arg(&id)
        .output()
        .map_err(|e| format!("Failed to execute docker stop: {}", e))?;
        
    if output.status.success() {
        Ok(())
    } else {
        let err = String::from_utf8_lossy(&output.stderr);
        Err(format!("Could not stop container {} ({})", id, err))
    }
}

#[tauri::command]
pub async fn restart_docker_container(id: String) -> Result<(), String> {
    let output = Command::new("docker")
        .arg("restart")
        .arg(&id)
        .output()
        .map_err(|e| format!("Failed to execute docker restart: {}", e))?;

    if output.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}

#[tauri::command]
pub async fn fetch_docker_container_logs(id: String, tail: Option<u32>) -> Result<String, String> {
    let tail_arg = tail.unwrap_or(500).to_string();
    let output = Command::new("docker")
        .arg("logs")
        .arg("--timestamps")
        .arg("--tail")
        .arg(&tail_arg)
        .arg(&id)
        .output()
        .map_err(|e| format!("Failed to execute docker logs: {}", e))?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}

#[cfg(target_os = "macos")]
#[tauri::command]
pub async fn open_docker_exec_shell(id: String, terminal: String) -> Result<(), String> {
    let command = format!(
        "docker exec -it {} sh || docker exec -it {} bash || echo \"No interactive shell available in container.\"; exec $SHELL -l",
        shell_quote(&id),
        shell_quote(&id)
    );
    let escaped_command = command.replace('\\', "\\\\").replace('"', "\\\"");

    match terminal.as_str() {
        "iTerm" => {
            let script = format!(
                "tell application \"iTerm\"\n\
                    activate\n\
                    set newWindow to (create window with default profile)\n\
                    tell current session of newWindow\n\
                        write text \"{}\"\n\
                    end tell\n\
                end tell",
                escaped_command
            );
            Command::new("osascript")
                .arg("-e")
                .arg(&script)
                .spawn()
                .map_err(|e| format!("Failed to open iTerm exec shell: {}", e))?;
        }
        _ => {
            let script = format!("tell application \"Terminal\" to do script \"{}\"", escaped_command);
            Command::new("osascript")
                .arg("-e")
                .arg(&script)
                .arg("-e")
                .arg("tell application \"Terminal\" to activate")
                .spawn()
                .map_err(|e| format!("Failed to open Terminal exec shell: {}", e))?;
        }
    }

    Ok(())
}

#[cfg(target_os = "linux")]
#[tauri::command]
pub async fn open_docker_exec_shell(id: String, _terminal: String) -> Result<(), String> {
    let command = format!(
        "docker exec -it {} sh || docker exec -it {} bash || echo \"No interactive shell available in container.\"; exec $SHELL -l",
        id,
        id
    );
    Command::new("x-terminal-emulator")
        .arg("-e")
        .arg("sh")
        .arg("-lc")
        .arg(&command)
        .output()
        .map_err(|e| format!("Failed to open exec shell: {}", e))?;
    Ok(())
}

#[cfg(target_os = "windows")]
#[tauri::command]
pub async fn open_docker_exec_shell(id: String, _terminal: String) -> Result<(), String> {
    Command::new("cmd")
        .args([
            "/C",
            "start",
            "cmd",
            "/K",
            &format!("docker exec -it {} cmd || docker exec -it {} powershell", id, id),
        ])
        .output()
        .map_err(|e| format!("Failed to open exec shell: {}", e))?;
    Ok(())
}

#[derive(serde::Serialize, serde::Deserialize)]
pub struct ContainerResourceStats {
    pub id: String,
    pub name: String,
    pub cpu_percent: f64,
    pub mem_mb: f64,
    pub mem_percent: f64,
}

fn _parse_pct(s: &str) -> f64 { s.trim().trim_end_matches('%').parse::<f64>().unwrap_or(0.0) }
fn _parse_mem(s: &str) -> (f64, f64) {
    let parts: Vec<&str> = s.splitn(2, '/').collect();
    let u = _to_mb(parts.first().copied().unwrap_or("").trim());
    let l = _to_mb(parts.get(1).copied().unwrap_or("").trim());
    (u, l)
}
fn _to_mb(s: &str) -> f64 {
    if s.ends_with("GiB") || s.ends_with("GB") { s.trim_end_matches("GiB").trim_end_matches("GB").trim().parse::<f64>().unwrap_or(0.0)*1024.0 }
    else if s.ends_with("MiB") || s.ends_with("MB") { s.trim_end_matches("MiB").trim_end_matches("MB").trim().parse::<f64>().unwrap_or(0.0) }
    else if s.ends_with("KiB") || s.ends_with("kB") { s.trim_end_matches("KiB").trim_end_matches("kB").trim().parse::<f64>().unwrap_or(0.0)/1024.0 }
    else { 0.0 }
}
