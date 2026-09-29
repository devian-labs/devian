use std::process::Command;

#[tauri::command]
pub async fn request_process_access() -> Result<bool, String> {
    // Windows allows reading most basic process attributes without UAC prompts 
    // depending on the user token. We assume true for standard user processes.
    Ok(true)
}

#[tauri::command]
pub async fn fetch_system_processes() -> Result<Vec<serde_json::Value>, String> {
    // Dummy / Basic Implementation for Windows
    // A robust impl would use WMI or Native API to get cpu/memory.
    let mut processes = Vec::new();
    
    if let Ok(output) = Command::new("tasklist").args(&["/FO", "CSV", "/NH"]).output() {
        let stdout = String::from_utf8_lossy(&output.stdout);
        for line in stdout.lines().take(100) {
            if line.trim().is_empty() { continue; }
            let cleaned = line.replace('"', "");
            let parts: Vec<&str> = cleaned.split(',').collect();
            if parts.len() >= 5 {
                processes.push(serde_json::json!({
                    "pid": parts[1],
                    "cpu": "0", // tasklist doesn't provide CPU %
                    "mem": "0",
                    "rss": parts[4].replace(" K", ""),
                    "state": "Running",
                    "time": "0:00",
                    "user": "Unknown",
                    "name": parts[0]
                }));
            }
        }
    }
    
    Ok(processes)
}

#[tauri::command]
pub async fn suspend_process(_pid: String) -> Result<String, String> {
    Err("Suspend is not natively supported on Windows via simple commands.".to_string())
}

#[tauri::command]
pub async fn resume_process(_pid: String) -> Result<String, String> {
    Err("Resume is not natively supported on Windows via simple commands.".to_string())
}

#[tauri::command]
pub async fn kill_process(pid: String) -> Result<(), String> {
    let output = Command::new("taskkill")
        .arg("/F")
        .arg("/PID")
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
