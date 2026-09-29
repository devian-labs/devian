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
    Command::new("explorer")
        .arg(&path)
        .spawn()
        .map_err(|e| format!("Failed to open explorer: {}", e))?;
    Ok(())
}

#[tauri::command]
pub async fn open_in_terminal(path: String, _terminal: String) -> Result<(), String> {
    // Windows fallback natively to cmd
    Command::new("cmd")
        .arg("/c")
        .arg("start")
        .arg("cmd")
        .arg("/K")
        .arg(format!("cd /d {}", path))
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
        _ => "code", // VS Code fallback
    };

    // Need to use cmd /c start to execute shell commands in windows from rust sometimes, but directly works for path binaries
    Command::new("cmd")
        .arg("/c")
        .arg(&cmd)
        .arg(&path)
        .spawn()
        .map_err(|e| format!("Failed to open editor: {}", e))?;
    Ok(())
}

