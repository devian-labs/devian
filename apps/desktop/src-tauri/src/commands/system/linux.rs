use std::process::Command;

#[tauri::command]
pub async fn fetch_disk_details() -> Result<serde_json::Value, String> {
    let output = Command::new("df")
        .arg("-k")
        .arg("/")
        .output()
        .map_err(|e| format!("Failed to read disk: {}", e))?;
    
    let stdout = String::from_utf8_lossy(&output.stdout);
    let lines: Vec<&str> = stdout.lines().collect();
    if lines.len() < 2 {
        return Err("Unexpected df output format".into());
    }
    
    let parts: Vec<&str> = lines[1].split_whitespace().collect();
    if parts.len() < 5 {
        return Err("Unexpected df output columns".into());
    }
    
    let total_kb: f64 = parts[1].parse().unwrap_or(0.0);
    let used_kb: f64 = parts[2].parse().unwrap_or(0.0);
    
    let total_gb = total_kb / 1024.0 / 1024.0;
    let used_gb = used_kb / 1024.0 / 1024.0;
    let percent = parts[4].trim_end_matches('%').parse::<f64>().unwrap_or(0.0);
    
    Ok(serde_json::json!({
        "total": format!("{:.1} GB", total_gb),
        "used": format!("{:.1} GB", used_gb),
        "percent": percent
    }))
}

#[tauri::command]
pub async fn fetch_system_resources() -> Result<serde_json::Value, String> {
    // Basic Implementation for Linux
    // A robust implementation would parse /proc/stat, /proc/meminfo etc.
    // Providing mostly empty/derived values to compile and run safely for now.
    
    let cpu_percent = 0.0;

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
