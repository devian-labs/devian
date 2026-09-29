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
    // ---- CPU Load ----
    let mut cpu_load_1 = 0.0_f64;
    let mut cpu_load_5 = 0.0_f64;
    let mut cpu_load_15 = 0.0_f64;
    if let Ok(output) = Command::new("sysctl").arg("-n").arg("vm.loadavg").output() {
        let s = String::from_utf8_lossy(&output.stdout).trim().to_string();
        // Format: "{ 1.23 1.45 1.67 }"
        let cleaned = s.replace('{', "").replace('}', "");
        let parts: Vec<&str> = cleaned.split_whitespace().collect();
        if parts.len() >= 3 {
            cpu_load_1 = parts[0].parse().unwrap_or(0.0);
            cpu_load_5 = parts[1].parse().unwrap_or(0.0);
            cpu_load_15 = parts[2].parse().unwrap_or(0.0);
        }
    }

    // ---- CPU Core Count (for load percentage) ----
    let mut cpu_cores: u32 = 1;
    if let Ok(output) = Command::new("sysctl").arg("-n").arg("hw.ncpu").output() {
        let s = String::from_utf8_lossy(&output.stdout).trim().to_string();
        cpu_cores = s.parse().unwrap_or(1);
    }

    // ---- RAM ----
    let mut ram_total: u64 = 0;
    let mut ram_used: u64 = 0;
    if let Ok(output) = Command::new("sysctl").arg("-n").arg("hw.memsize").output() {
        let s = String::from_utf8_lossy(&output.stdout).trim().to_string();
        ram_total = s.parse().unwrap_or(0);
    }
    if let Ok(output) = Command::new("vm_stat").output() {
        let s = String::from_utf8_lossy(&output.stdout).to_string();
        let mut pages_active: u64 = 0;
        let mut pages_wired: u64 = 0;
        let mut pages_compressed: u64 = 0;
        let mut pages_speculative: u64 = 0;
        for line in s.lines() {
            let parts: Vec<&str> = line.split(':').collect();
            if parts.len() == 2 {
                let val = parts[1].trim().trim_end_matches('.').parse::<u64>().unwrap_or(0);
                let key = parts[0].trim();
                if key.contains("Pages active") { pages_active = val; }
                else if key.contains("Pages wired") { pages_wired = val; }
                else if key.contains("Pages occupied by compressor") { pages_compressed = val; }
                else if key.contains("Pages speculative") { pages_speculative = val; }
            }
        }
        let page_size: u64 = 16384; // Apple Silicon default
        ram_used = (pages_active + pages_wired + pages_compressed + pages_speculative) * page_size;
    }
    let ram_percent = if ram_total > 0 { (ram_used as f64 / ram_total as f64 * 100.0).round() } else { 0.0 };

    // ---- Disk (APFS container-level via diskutil) ----
    let mut disk_total = String::from("0 GB");
    let mut disk_used = String::from("0 GB");
    let mut disk_percent = 0.0_f64;
    if let Ok(output) = Command::new("diskutil").arg("info").arg("/").output() {
        let s = String::from_utf8_lossy(&output.stdout).to_string();
        let mut container_total: f64 = 0.0;
        let mut container_free: f64 = 0.0;
        for line in s.lines() {
            let trimmed = line.trim();
            if trimmed.starts_with("Container Total Space:") {
                if let Some(paren) = trimmed.find('(') {
                    let after = &trimmed[paren + 1..];
                    if let Some(space) = after.find(' ') {
                        container_total = after[..space].parse().unwrap_or(0.0);
                    }
                }
            }
            if trimmed.starts_with("Container Free Space:") {
                if let Some(paren) = trimmed.find('(') {
                    let after = &trimmed[paren + 1..];
                    if let Some(space) = after.find(' ') {
                        container_free = after[..space].parse().unwrap_or(0.0);
                    }
                }
            }
        }
        if container_total > 0.0 {
            let used = container_total - container_free;
            disk_total = format!("{:.1} GB", container_total / 1_000_000_000.0);
            disk_used = format!("{:.1} GB", used / 1_000_000_000.0);
            disk_percent = (used / container_total * 100.0).round();
        }
    }

    // ---- Battery ----
    let mut battery_percent = -1.0_f64;
    let mut battery_charging = false;
    let mut battery_time = String::new();
    let mut battery_cycle_count: i64 = -1;
    let mut battery_health: f64 = -1.0;
    let mut battery_condition = String::from("Unknown");
    if let Ok(output) = Command::new("pmset").arg("-g").arg("batt").output() {
        let s = String::from_utf8_lossy(&output.stdout).to_string();
        for line in s.lines() {
            if line.contains('%') {
                if let Some(pct_pos) = line.find('%') {
                    let start = line[..pct_pos].rfind(|c: char| !c.is_ascii_digit()).map(|i| i+1).unwrap_or(0);
                    battery_percent = line[start..pct_pos].parse().unwrap_or(-1.0);
                }
                battery_charging = line.contains("charging") && !line.contains("discharging");
                if line.contains("remaining") {
                    if let Some(idx) = line.find("remaining") {
                        let before = line[..idx].trim();
                        if let Some(time_start) = before.rfind(';') {
                            battery_time = before[time_start+1..].trim().to_string();
                        }
                    }
                }
            }
        }
    }
    if battery_percent >= 0.0 {
        if let Ok(output) = Command::new("ioreg")
            .arg("-r")
            .arg("-c")
            .arg("AppleSmartBattery")
            .arg("-w0")
            .output()
        {
            let s = String::from_utf8_lossy(&output.stdout).to_string();
            let mut raw_max_cap: f64 = 0.0;
            let mut design_cap: f64 = 0.0;
            for line in s.lines() {
                let trimmed = line.trim();
                if trimmed.contains("\"CycleCount\"") && !trimmed.contains("DesignCycleCount") && !trimmed.contains("Lifetime") && !trimmed.contains("CycleCountLastQmax") {
                    if let Some(val) = trimmed.split('=').last() {
                        battery_cycle_count = val.trim().parse().unwrap_or(-1);
                    }
                }
                if trimmed.contains("\"AppleRawMaxCapacity\"") {
                    if let Some(val) = trimmed.split('=').last() {
                        raw_max_cap = val.trim().parse().unwrap_or(0.0);
                    }
                }
                if trimmed.starts_with("\"DesignCapacity\"") {
                    if let Some(val) = trimmed.split('=').last() {
                        design_cap = val.trim().parse().unwrap_or(0.0);
                    }
                }
                if trimmed.contains("\"BatteryInstalled\"") {
                    battery_condition = if trimmed.contains("Yes") { "Normal".to_string() } else { "Not Installed".to_string() };
                }
            }
            if raw_max_cap > 0.0 && design_cap > 0.0 {
                battery_health = (raw_max_cap / design_cap * 100.0).round();
            }
        }
    }

    // ---- Network Interface Bytes ----
    let mut net_rx: u64 = 0;
    let mut net_tx: u64 = 0;
    if let Ok(output) = Command::new("netstat").arg("-ib").output() {
        let s = String::from_utf8_lossy(&output.stdout);
        for line in s.lines() {
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() >= 10 && parts[0] == "en0" && parts[2] != "none" {
                net_rx = parts[6].parse().unwrap_or(0);
                net_tx = parts[9].parse().unwrap_or(0);
                break;
            }
        }
    }

    // ---- Uptime (from kern.boottime for accuracy) ----
    let mut uptime_str = String::from("Unknown");
    if let Ok(output) = Command::new("sysctl").arg("-n").arg("kern.boottime").output() {
        let s = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if let Some(sec_start) = s.find("sec = ") {
            let after = &s[sec_start + 6..];
            if let Some(comma) = after.find(',') {
                if let Ok(boot_sec) = after[..comma].trim().parse::<u64>() {
                    let now_sec = std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .unwrap_or_default()
                        .as_secs();
                    if now_sec > boot_sec {
                        let elapsed = now_sec - boot_sec;
                        let days = elapsed / 86400;
                        let hours = (elapsed % 86400) / 3600;
                        let mins = (elapsed % 3600) / 60;
                        if days > 0 {
                            uptime_str = format!("{} days, {}h {}m", days, hours, mins);
                        } else if hours > 0 {
                            uptime_str = format!("{}h {}m", hours, mins);
                        } else {
                            uptime_str = format!("{}m", mins);
                        }
                    }
                }
            }
        }
    }

    // ---- CPU Temperature (best effort) ----
    let mut cpu_temp = -1.0_f64;
    if let Ok(output) = Command::new("osx-cpu-temp").output() {
        if output.status.success() {
            let s = String::from_utf8_lossy(&output.stdout).trim().to_string();
            let cleaned = s.replace("°C", "").replace("°F", "");
            let parsed: f64 = cleaned.trim().parse().unwrap_or(-1.0);
            if parsed > 0.0 {
                cpu_temp = parsed;
            }
        }
    }

    // ---- Connected USB Devices ----
    let mut usb_devices: Vec<String> = Vec::new();
    if let Ok(output) = Command::new("system_profiler").arg("SPUSBDataType").arg("-detailLevel").arg("mini").output() {
        if output.status.success() {
            let s = String::from_utf8_lossy(&output.stdout);
            for line in s.lines() {
                let trimmed = line.trim();
                if trimmed.ends_with(':') && !trimmed.starts_with("USB") && !trimmed.contains("Bus") && !trimmed.is_empty() {
                    let name = trimmed.trim_end_matches(':').to_string();
                    if !name.is_empty() && name != "USB" {
                        usb_devices.push(name);
                    }
                }
            }
        }
    }

    Ok(serde_json::json!({
        "cpu": {
            "load_1": cpu_load_1,
            "load_5": cpu_load_5,
            "load_15": cpu_load_15,
            "cores": cpu_cores,
            "percent": ((cpu_load_1 / cpu_cores as f64) * 100.0).min(100.0).round()
        },
        "ram": {
            "total_bytes": ram_total,
            "used_bytes": ram_used,
            "percent": ram_percent
        },
        "disk": {
            "total": disk_total,
            "used": disk_used,
            "percent": disk_percent
        },
        "battery": {
            "percent": battery_percent,
            "charging": battery_charging,
            "time_remaining": battery_time,
            "cycle_count": battery_cycle_count,
            "health": battery_health,
            "condition": battery_condition
        },
        "network": {
            "rx_bytes": net_rx,
            "tx_bytes": net_tx
        },
        "uptime": uptime_str,
        "cpu_temp": cpu_temp,
        "usb_devices": usb_devices
    }))
}
