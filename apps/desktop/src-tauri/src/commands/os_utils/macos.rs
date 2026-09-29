use std::process::Command;

fn has_full_disk_access() -> bool {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/".to_string());

    let tcc_db = format!("{}/Library/Application Support/com.apple.TCC/TCC.db", home);

    match std::fs::File::open(tcc_db) {
        Ok(_) => true,
        Err(_) => false,
    }
}

#[tauri::command]
pub async fn request_disk_access() -> Result<bool, String> {
    // Dev builds run unsigned, where the TCC check is meaningless.
    if cfg!(debug_assertions) {
        return Ok(true);
    }

    if has_full_disk_access() {
        return Ok(true);
    }

    // FDA not granted — open System Settings to the Full Disk Access pane
    Command::new("open")
        .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles")
        .spawn()
        .map_err(|e| format!("Failed to open System Settings: {}", e))?;

    Err("Full Disk Access is required. Please grant Devian Desktop access in System Settings, then click 'Verify Access'.".to_string())
}

#[tauri::command]
pub async fn check_full_disk_access() -> Result<bool, String> {
    // Dev builds run unsigned, where the TCC check is meaningless.
    if cfg!(debug_assertions) {
        return Ok(true);
    }

    if has_full_disk_access() {
        Ok(true)
    } else {
        Err("Full Disk Access has not been granted yet. Please enable it in System Settings > Privacy & Security > Full Disk Access.".to_string())
    }
}

#[tauri::command]
pub async fn open_in_finder(path: String) -> Result<(), String> {
    // macOS specific
    Command::new("open")
        .arg(&path)
        .spawn()
        .map_err(|e| format!("Failed to open finder: {}", e))?;
    Ok(())
}

#[tauri::command]
pub async fn open_in_terminal(path: String, terminal: String) -> Result<(), String> {
    // macOS specific handling for standard terminal apps
    let app_name = match terminal.as_str() {
        "iTerm" => "iTerm",
        "Warp" => "Warp",
        _ => "Terminal", // "Native Terminal" or fallback
    };

    Command::new("open")
        .arg("-a")
        .arg(app_name)
        .arg(&path)
        .spawn()
        .map_err(|e| format!("Failed to open terminal: {}", e))?;
    Ok(())
}

#[tauri::command]
pub async fn open_in_editor(path: String, editor: String) -> Result<(), String> {
    // Editor CLI commands
    let cmd = match editor.as_str() {
        "Cursor" => "cursor",
        "Antigravity" => "antigravity", // assuming global CLI exists
        "IntelliJ" => "idea",
        "Sublime Text" => "subl",
        _ => "code", // VS Code fallback
    };

    Command::new(cmd)
        .arg(&path)
        .spawn()
        .map_err(|e| format!("Failed to open editor: {}", e))?;
    Ok(())
}

