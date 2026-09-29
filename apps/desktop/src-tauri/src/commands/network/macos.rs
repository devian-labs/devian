use std::process::Command;

#[tauri::command]
pub async fn fetch_active_ports() -> Result<Vec<serde_json::Value>, String> {
    let output = Command::new("lsof")
        .arg("-iTCP")
        .arg("-sTCP:LISTEN")
        .arg("-P")
        .arg("-n")
        .output()
        .map_err(|e| format!("Failed to read ports: {}", e))?;
    
    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut ports = Vec::new();
    
    for line in stdout.lines().skip(1) {
        if line.trim().is_empty() { continue; }
        
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() < 9 { continue; }
        
        let name = parts[0];
        let pid = parts[1];
        let user = parts[2];
        let node_port = parts[8]; // Usually e.g. "*:3000" or "localhost:8080"
        
        // Extract just the port number if possible
        let port_number = node_port.split(':').last().unwrap_or(node_port);

        ports.push(serde_json::json!({
            "name": name,
            "pid": pid,
            "user": user,
            "port": port_number,
            "full_address": node_port
        }));
    }
    
    // Deduplicate by Port string
    let mut unique_ports = Vec::new();
    let mut seen_ports = std::collections::HashSet::new();
    
    for port in ports {
        if let Some(port_num) = port["port"].as_str() {
            if seen_ports.insert(port_num.to_string()) {
                unique_ports.push(port);
            }
        }
    }
    
    // Sort by port number
    unique_ports.sort_by(|a, b| {
        let port_a = a["port"].as_str().unwrap_or("0").parse::<i32>().unwrap_or(0);
        let port_b = b["port"].as_str().unwrap_or("0").parse::<i32>().unwrap_or(0);
        port_a.cmp(&port_b)
    });
    
    Ok(unique_ports)
}
