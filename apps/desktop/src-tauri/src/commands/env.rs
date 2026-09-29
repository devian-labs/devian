use std::fs;
use std::path::PathBuf;
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize)]
pub struct EnvVariable {
    pub key: String,
    pub value: String,
}

#[tauri::command]
pub async fn read_env_file(path: String) -> Result<Vec<EnvVariable>, String> {
    let env_path = PathBuf::from(&path).join(".env");
    if !env_path.exists() {
        return Ok(Vec::new());
    }

    match fs::read_to_string(&env_path) {
        Ok(content) => {
            let mut vars = Vec::new();
            for line in content.lines() {
                let line_trimmed = line.trim();
                if line_trimmed.is_empty() || line_trimmed.starts_with('#') {
                    continue;
                }
                
                if let Some(idx) = line_trimmed.find('=') {
                    let key = line_trimmed[..idx].trim().to_string();
                    let value = line_trimmed[idx + 1..].trim();
                    let value = value.trim_matches('"').trim_matches('\'').to_string();
                    vars.push(EnvVariable { key, value });
                }
            }
            Ok(vars)
        },
        Err(e) => Err(format!("Failed to read .env file: {}", e))
    }
}

#[tauri::command]
pub async fn write_env_file(path: String, env_vars: Vec<EnvVariable>) -> Result<(), String> {
    let env_path = PathBuf::from(&path).join(".env");
    
    let mut content = String::new();
    for var in env_vars {
        // Basic escaping/quoting for values with spaces
        let value = if var.value.contains(' ') && !var.value.starts_with('"') && !var.value.starts_with('\'') {
            format!("\"{}\"", var.value.replace('"', "\\\""))
        } else {
            var.value
        };
        content.push_str(&format!("{}={}\n", var.key, value));
    }

    fs::write(&env_path, content).map_err(|e| format!("Failed to write .env file: {}", e))
}

/// Detect which sensitive config files exist in a project directory.
/// Returns names of found files — never their content.
/// These files are always protected from cleanup (database.yml, secrets.yml, etc.)
#[derive(Serialize, Deserialize)]
pub struct ConfigFileInfo {
    pub name: String,        // Display name, e.g. "config/secrets.yml"
    pub kind: String,        // "env" | "rails" | "rails_credentials"
    pub protected: bool,     // always true — these are never deleted
}

#[tauri::command]
pub async fn list_env_config_files(path: String) -> Vec<ConfigFileInfo> {
    let base = PathBuf::from(&path);
    let mut found = Vec::new();

    let env_files = [
        (".env",             "env"),
        (".env.local",       "env"),
        (".env.development", "env"),
        (".env.test",        "env"),
        (".env.production",  "env"),
    ];
    for (file, kind) in &env_files {
        if base.join(file).exists() {
            found.push(ConfigFileInfo { name: file.to_string(), kind: kind.to_string(), protected: false });
        }
    }

    // Rails-style sensitive config files — all marked protected
    let rails_files: &[(&str, &str)] = &[
        ("config/database.yml",         "rails"),
        ("config/secrets.yml",           "rails"),
        ("config/credentials.yml",       "rails_credentials"),
        ("config/credentials.yml.enc",   "rails_credentials"),
        ("config/master.key",            "rails_credentials"),
        ("config/application.yml",       "rails"),       // Figaro gem
        ("config/storage.yml",           "rails"),
        ("config/cable.yml",             "rails"),
    ];
    for (file, kind) in rails_files {
        if base.join(file).exists() {
            found.push(ConfigFileInfo { name: file.to_string(), kind: kind.to_string(), protected: true });
        }
    }

    found
}
