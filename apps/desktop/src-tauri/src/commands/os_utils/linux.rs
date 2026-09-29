use std::process::Command;

#[tauri::command]
pub async fn request_disk_access() -> Result<bool, String> {
    Ok(true)
}

#[tauri::command]
pub async fn check_full_disk_access() -> Result<bool, String> {
    Ok(true)
}

#[tauri::command]
pub async fn open_in_finder(path: String) -> Result<(), String> {
    Command::new("xdg-open")
        .arg(&path)
        .spawn()
        .map_err(|e| format!("Failed to open file manager: {}", e))?;
    Ok(())
}

#[tauri::command]
pub async fn open_in_terminal(path: String, _terminal: String) -> Result<(), String> {
    Command::new("x-terminal-emulator")
        .arg("--working-directory")
        .arg(&path)
        .spawn()
        .map_err(|e| format!("Failed to open terminal: {}", e))?;
    Ok(())
}

#[tauri::command]
pub async fn open_in_editor(path: String, editor: String) -> Result<(), String> {
    let cmd = match editor.as_str() {
        "Cursor" => "cursor",
        "Antigravity" => "antigravity",
        "IntelliJ" => "idea",
        "Sublime Text" => "subl",
        _ => "code",
    };

    Command::new(cmd)
        .arg(&path)
        .spawn()
        .map_err(|e| format!("Failed to open editor: {}", e))?;
    Ok(())
}

