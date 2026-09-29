use std::process::Command;

#[tauri::command]
pub async fn fetch_active_ports() -> Result<Vec<serde_json::Value>, String> {
    let output = Command::new("ss")
        .arg("-tlnp")
        .output()
        .map_err(|e| format!("Failed to read ports: {}", e))?;
    
    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut ports = Vec::new();
    
    for line in stdout.lines().skip(1) {
        if line.trim().is_empty() { continue; }
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() >= 4 {
            let local_addr = parts[3]; // State Recv-Q Send-Q Local Address:Port Peer Address:Port Process
            
            let port_number = local_addr.split(':').last().unwrap_or(local_addr);
            let process_info = parts.get(6).unwrap_or(&"Unknown");
            
            ports.push(serde_json::json!({
                "name": process_info.to_string(),
                "pid": process_info.to_string(),
                "user": "Unknown",
                "port": port_number,
                "full_address": local_addr
            }));
        }
    }
    
    // Deduplicate
    let mut unique_ports = Vec::new();
    let mut seen_ports = std::collections::HashSet::new();
    
    for port in ports {
        if let Some(port_num) = port["port"].as_str() {
            if seen_ports.insert(port_num.to_string()) {
                unique_ports.push(port);
            }
        }
    }
    
    unique_ports.sort_by(|a, b| {
        let port_a = a["port"].as_str().unwrap_or("0").parse::<i32>().unwrap_or(0);
        let port_b = b["port"].as_str().unwrap_or("0").parse::<i32>().unwrap_or(0);
        port_a.cmp(&port_b)
    });
    
    Ok(unique_ports)
}
