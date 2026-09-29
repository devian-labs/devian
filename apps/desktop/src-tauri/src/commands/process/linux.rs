use std::process::Command;
use std::path::Path;

#[tauri::command]
pub async fn request_process_access() -> Result<bool, String> {
    // Linux typically does not require special accessibility permissions for standard process reading via /proc
    Ok(true)
}

#[tauri::command]
pub async fn fetch_system_processes() -> Result<Vec<serde_json::Value>, String> {
    let output = Command::new("ps")
        .arg("-eo")
        .arg("pid,pcpu,pmem,rss,state,time,user,comm")
        .output()
        .map_err(|e| format!("Failed to read processes: {}", e))?;
    
    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut processes = Vec::new();
    
    for line in stdout.lines().skip(1).take(100) {
        if line.trim().is_empty() { continue; }
        
        let mut parts = line.split_whitespace();
        let pid = parts.next().unwrap_or("");
        let cpu = parts.next().unwrap_or("");
        let mem = parts.next().unwrap_or("");
        let rss = parts.next().unwrap_or("");
        let state = parts.next().unwrap_or("");
        let time = parts.next().unwrap_or("");
        let user = parts.next().unwrap_or("");
        
        let cmd_parts: Vec<&str> = parts.collect();
        let command = cmd_parts.join(" ");
        
        let name = Path::new(&command)
            .file_name()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or(command);

        processes.push(serde_json::json!({
            "pid": pid,
            "cpu": cpu,
            "mem": mem,
            "rss": rss,
            "state": state,
            "time": time,
            "user": user,
            "name": name
        }));
    }
    
    Ok(processes)
}

#[tauri::command]
pub async fn suspend_process(pid: String) -> Result<String, String> {
    let output = Command::new("kill")
        .arg("-STOP")
        .arg(&pid)
        .output()
        .map_err(|e| format!("Failed to execute suspend command: {}", e))?;
        
    if output.status.success() {
        Ok(format!("Process {} suspended.", pid))
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}

#[tauri::command]
pub async fn resume_process(pid: String) -> Result<String, String> {
    let output = Command::new("kill")
        .arg("-CONT")
        .arg(&pid)
        .output()
        .map_err(|e| format!("Failed to execute resume command: {}", e))?;
        
    if output.status.success() {
        Ok(format!("Process {} resumed.", pid))
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}

#[tauri::command]
pub async fn kill_process(pid: String) -> Result<(), String> {
    let output = Command::new("kill")
        .arg("-9")
        .arg(&pid)
        .output()
        .map_err(|e| format!("Failed to execute kill command: {}", e))?;
        
    if output.status.success() {
        Ok(())
    } else {
        let err = String::from_utf8_lossy(&output.stderr);
        Err(format!("Access Denied: Could not kill pid {} ({})", pid, err))
    }
}
