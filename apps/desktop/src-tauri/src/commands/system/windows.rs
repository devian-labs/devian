use std::process::Command;

#[tauri::command]
pub async fn fetch_disk_details() -> Result<serde_json::Value, String> {
    // Basic implementation for windows using fsutil or wmic
    let output = Command::new("wmic")
        .args(&["logicaldisk", "get", "size,freespace,caption"])
        .output()
        .map_err(|e| format!("Failed to read disk: {}", e))?;
    
    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut total_bytes = 0.0_f64;
    let mut free_bytes = 0.0_f64;
    
    // Skip empty lines and header
    for line in stdout.lines().skip(1) {
        if line.trim().is_empty() { continue; }
        let parts: Vec<&str> = line.split_whitespace().collect();
        // Typically: C: FreeSpace Size
        if parts.len() >= 3 && parts[0] == "C:" {
            free_bytes = parts[1].parse().unwrap_or(0.0);
            total_bytes = parts[2].parse().unwrap_or(0.0);
            break;
        }
    }
    
    let total_gb = total_bytes / 1024.0 / 1024.0 / 1024.0;
    let used_gb = (total_bytes - free_bytes) / 1024.0 / 1024.0 / 1024.0;
    let percent = if total_bytes > 0.0 { ((total_bytes - free_bytes) / total_bytes * 100.0).round() } else { 0.0 };
    
    Ok(serde_json::json!({
        "total": format!("{:.1} GB", total_gb),
        "used": format!("{:.1} GB", used_gb),
        "percent": percent
    }))
}

#[tauri::command]
pub async fn fetch_system_resources() -> Result<serde_json::Value, String> {
    // Dummy / Basic Implementation for Windows
    // A robust implementation would use powershell or WMI via rs-wmi
    // we'll provide mostly empty/derived values to compile and run safely
    
    let mut cpu_percent = 0.0;
    if let Ok(output) = Command::new("wmic").args(&["cpu", "get", "loadpercentage"]).output() {
        let s = String::from_utf8_lossy(&output.stdout);
        for line in s.lines().skip(1) {
            let t = line.trim();
            if !t.is_empty() {
                cpu_percent = t.parse().unwrap_or(0.0);
                break;
            }
        }
    }

    Ok(serde_json::json!({
        "cpu": {
            "load_1": 0.0,
            "load_5": 0.0,
            "load_15": 0.0,
            "cores": 1,
            "percent": cpu_percent
        },
        "ram": {
            "total_bytes": 0,
            "used_bytes": 0,
            "percent": 0.0
        },
        "disk": {
            "total": "0 GB",
            "used": "0 GB",
            "percent": 0.0
        },
        "battery": {
            "percent": -1.0,
            "charging": false,
            "time_remaining": "",
            "cycle_count": -1,
            "health": 100.0,
            "condition": "Unknown"
        },
        "network": {
            "rx_bytes": 0,
            "tx_bytes": 0
        },
        "uptime": "Unknown",
        "cpu_temp": -1.0,
        "usb_devices": <Vec<String>>::new()
    }))
}
