#[cfg(target_os = "macos")]
pub mod macos;
#[cfg(target_os = "macos")]
pub use macos::*;

#[cfg(target_os = "windows")]
pub mod windows;
#[cfg(target_os = "windows")]
pub use windows::*;

#[cfg(target_os = "linux")]
pub mod linux;
#[cfg(target_os = "linux")]
pub use linux::*;

use std::env;
use std::fs;
use std::path::Path;
use serde::{Deserialize, Serialize};
use serde_json::json;

#[derive(Serialize, Deserialize)]
pub struct UserSettings {
    pub terminal: String,
    pub editor: String,
}

pub fn fix_macos_path() {
    #[cfg(target_os = "macos")]
    {
        let path = env::var("PATH").unwrap_or_default();
        let common_paths = "/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin:/opt/homebrew/sbin";
        
        let mut new_path = path.clone();
        for p in common_paths.split(':') {
            if !path.contains(p) {
                if !new_path.is_empty() {
                    new_path.push(':');
                }
                new_path.push_str(p);
            }
        }
        
        if new_path != path {
            env::set_var("PATH", new_path);
        }
    }
}

fn devian_home() -> std::path::PathBuf {
    env::var("HOME")
        .or_else(|_| env::var("USERPROFILE"))
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|_| env::temp_dir())
}

pub fn get_config_path() -> String {
    devian_home()
        .join(".devian_settings.json")
        .to_string_lossy()
        .to_string()
}

#[tauri::command]
pub async fn get_user_settings() -> Result<serde_json::Value, String> {
    let path = get_config_path();
    if Path::new(&path).exists() {
        match fs::read_to_string(&path) {
            Ok(content) => {
                match serde_json::from_str(&content) {
                    Ok(val) => Ok(val),
                    Err(_) => Ok(json!({ "terminal": "Native Terminal", "editor": "VS Code" }))
                }
            },
            Err(_) => Ok(json!({ "terminal": "Native Terminal", "editor": "VS Code" }))
        }
    } else {
        Ok(json!({ "terminal": "Native Terminal", "editor": "VS Code" }))
    }
}

#[tauri::command]
pub async fn save_user_settings(terminal: String, editor: String) -> Result<(), String> {
    let settings = UserSettings { terminal, editor };
    let json_str = serde_json::to_string_pretty(&settings)
        .map_err(|e| format!("Serialization error: {}", e))?;
    
    fs::write(get_config_path(), json_str)
        .map_err(|e| format!("Failed to save settings: {}", e))
}

// ── OS Notifications ───────────────────────────────────────────────────────

#[tauri::command]
pub async fn show_notification(title: String, body: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let script = format!(
            "display notification \"{}\" with title \"{}\"",
            body.replace('"', "'"),
            title.replace('"', "'")
        );
        let _ = std::process::Command::new("osascript")
            .args(["-e", &script])
            .spawn();
    }
    #[cfg(target_os = "linux")]
    {
        let _ = std::process::Command::new("notify-send")
            .args([&title, &body])
            .spawn();
    }
    #[cfg(target_os = "windows")]
    {
        // Simple balloon tooltip via PowerShell
        let ps = format!(
            r#"[reflection.assembly]::loadwithpartialname('System.Windows.Forms') | Out-Null;
               $n = New-Object System.Windows.Forms.NotifyIcon;
               $n.Icon = [System.Drawing.SystemIcons]::Information;
               $n.BalloonTipTitle = '{}';
               $n.BalloonTipText = '{}';
               $n.Visible = $true;
               $n.ShowBalloonTip(3000)"#,
            title.replace('\'', ""),
            body.replace('\'', "")
        );
        let _ = std::process::Command::new("powershell")
            .args(["-NoProfile", "-NonInteractive", "-Command", &ps])
            .spawn();
    }
    Ok(())
}

// ── Per-project config (.devian/config.json) ──────────────────────────────

#[derive(serde::Serialize, serde::Deserialize, Default, Clone)]
pub struct DevianProjectConfig {
    pub notes: Option<String>,
    pub tags: Option<Vec<String>>,
    pub cleanup_ignore: Option<Vec<String>>,
    // Runbook fields
    pub how_to_run: Option<String>,
    pub required_services: Option<String>,
    pub environment: Option<String>,
}

fn project_config_path(project_path: &str) -> std::path::PathBuf {
    std::path::PathBuf::from(project_path).join(".devian").join("config.json")
}

#[tauri::command]
pub async fn read_project_config(path: String) -> Result<DevianProjectConfig, String> {
    let config_path = project_config_path(&path);
    if !config_path.exists() {
        return Ok(DevianProjectConfig::default());
    }
    let content = fs::read_to_string(&config_path)
        .map_err(|e| format!("Failed to read config: {}", e))?;
    serde_json::from_str::<DevianProjectConfig>(&content)
        .map_err(|e| format!("Failed to parse config: {}", e))
}

#[tauri::command]
pub async fn write_project_config(path: String, config: DevianProjectConfig) -> Result<(), String> {
    let config_path = project_config_path(&path);
    if let Some(parent) = config_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create .devian directory: {}", e))?;
    }
    let json = serde_json::to_string_pretty(&config)
        .map_err(|e| format!("Failed to serialize config: {}", e))?;
    fs::write(&config_path, json)
        .map_err(|e| format!("Failed to write config: {}", e))
}
