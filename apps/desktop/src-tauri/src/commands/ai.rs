use serde::Serialize;
use serde::Deserialize;
use std::fs;
use std::path::PathBuf;
use tauri::{Emitter, Window};

const MODEL_FILENAME: &str = "Qwen_Qwen3-4B-Instruct-2507-Q4_K_M.gguf";
const MODEL_URL: &str = "https://huggingface.co/bartowski/Qwen_Qwen3-4B-Instruct-2507-GGUF/resolve/main/Qwen_Qwen3-4B-Instruct-2507-Q4_K_M.gguf";

fn devian_home() -> PathBuf {
    std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .map(PathBuf::from)
        .unwrap_or_else(|_| std::env::temp_dir())
}

fn models_dir() -> PathBuf {
    devian_home().join(".devian").join("models")
}

fn model_path() -> PathBuf {
    models_dir().join(MODEL_FILENAME)
}

#[derive(Serialize, Clone)]
pub struct ModelStatus {
    pub exists: bool,
    pub size_bytes: u64,
    pub path: String,
}

#[derive(Serialize, Clone)]
pub struct DownloadProgress {
    pub downloaded: u64,
    pub total: u64,
    pub percent: f64,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

#[tauri::command]
pub async fn check_model_status() -> Result<ModelStatus, String> {
    let path = model_path();
    if path.exists() {
        let metadata = fs::metadata(&path).map_err(|e| e.to_string())?;
        Ok(ModelStatus {
            exists: true,
            size_bytes: metadata.len(),
            path: path.to_string_lossy().to_string(),
        })
    } else {
        Ok(ModelStatus {
            exists: false,
            size_bytes: 0,
            path: path.to_string_lossy().to_string(),
        })
    }
}

#[tauri::command]
pub async fn download_model(window: Window) -> Result<(), String> {
    let dir = models_dir();
    fs::create_dir_all(&dir).map_err(|e| format!("Failed to create models directory: {}", e))?;

    let path = model_path();

    // Check if already downloaded
    if path.exists() {
        return Ok(());
    }

    let client = reqwest::Client::new();
    let response = client
        .get(MODEL_URL)
        .send()
        .await
        .map_err(|e| format!("Failed to start download: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("Download failed with status: {}", response.status()));
    }

    let total = response.content_length().unwrap_or(0);
    let mut downloaded: u64 = 0;

    // Write to a temp file first, then rename on completion
    let temp_path = path.with_extension("gguf.part");

    let mut file = fs::File::create(&temp_path)
        .map_err(|e| format!("Failed to create file: {}", e))?;

    use futures_util::StreamExt;
    use std::io::Write;

    let mut stream = response.bytes_stream();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("Download error: {}", e))?;
        file.write_all(&chunk)
            .map_err(|e| format!("Write error: {}", e))?;

        downloaded += chunk.len() as u64;

        let percent = if total > 0 {
            (downloaded as f64 / total as f64) * 100.0
        } else {
            0.0
        };

        let _ = window.emit(
            "model-download-progress",
            DownloadProgress {
                downloaded,
                total,
                percent,
            },
        );
    }

    file.flush().map_err(|e| format!("Flush error: {}", e))?;
    drop(file);

    // Rename temp file to final file
    fs::rename(&temp_path, &path)
        .map_err(|e| format!("Failed to finalize download: {}", e))?;

    Ok(())
}

#[tauri::command]
pub async fn delete_model() -> Result<(), String> {
    let path = model_path();
    if path.exists() {
        fs::remove_file(&path).map_err(|e| format!("Failed to delete model: {}", e))?;
    }
    // Also clean up any partial downloads
    let temp_path = path.with_extension("gguf.part");
    if temp_path.exists() {
        let _ = fs::remove_file(&temp_path);
    }
    Ok(())
}

// ======= AI Inference Infrastructure =======

const LLAMA_SERVER_PORT: u16 = 8413;

fn bin_dir() -> PathBuf {
    devian_home().join(".devian").join("bin")
}

fn llama_server_path() -> PathBuf {
    #[cfg(target_os = "windows")]
    return bin_dir().join("llama-server.exe");
    #[cfg(not(target_os = "windows"))]
    return bin_dir().join("llama-server");
}

#[derive(Serialize, Clone)]
pub struct LlamaServerStatus {
    pub running: bool,
    pub model_loaded: bool,
    pub binary_exists: bool,
}

#[tauri::command]
pub async fn check_llama_server_status() -> Result<LlamaServerStatus, String> {
    let binary_exists = llama_server_path().exists();

    // Check if server is responding
    let running = if let Ok(resp) = reqwest::Client::new()
        .get(format!("http://127.0.0.1:{}/health", LLAMA_SERVER_PORT))
        .timeout(std::time::Duration::from_secs(2))
        .send()
        .await
    {
        resp.status().is_success()
    } else {
        false
    };

    Ok(LlamaServerStatus {
        running,
        model_loaded: running, // If running, model is loaded
        binary_exists,
    })
}

#[tauri::command]
pub async fn download_llama_server(window: Window) -> Result<(), String> {
    let dir = bin_dir();
    fs::create_dir_all(&dir).map_err(|e| format!("Failed to create bin directory: {}", e))?;

    let server_path = llama_server_path();
    if server_path.exists() {
        return Ok(());
    }

    // Detect architecture
    let arch = std::env::consts::ARCH;
    let arch_suffix = match arch {
        "aarch64" => "arm64",
        "x86_64" => "x64",
        _ => return Err(format!("Unsupported architecture: {}", arch)),
    };

    // Platform-specific release asset pattern and archive format
    let (target_pattern, archive_ext) = match std::env::consts::OS {
        "macos"   => (format!("macos-{}", arch_suffix), "tar.gz"),
        "linux"   => (format!("ubuntu-{}", arch_suffix), "tar.gz"),
        "windows" => (format!("win-{}", arch_suffix), "zip"),
        os        => return Err(format!("Unsupported OS: {}", os)),
    };

    let _ = window.emit("llama-server-download", "Finding latest release...");

    let client = reqwest::Client::builder()
        .user_agent("devian-desktop")
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    let release_info: serde_json::Value = client
        .get("https://api.github.com/repos/ggml-org/llama.cpp/releases/latest")
        .send()
        .await
        .map_err(|e| format!("Failed to fetch release info: {}", e))?
        .json()
        .await
        .map_err(|e| format!("Failed to parse release info: {}", e))?;

    let assets = release_info.get("assets")
        .and_then(|a| a.as_array())
        .ok_or("No assets found in release")?;

    let archive_suffix = format!(".{}", archive_ext);
    let asset_url = assets.iter()
        .filter_map(|a| {
            let name = a.get("name")?.as_str()?;
            if name.contains(&target_pattern) && name.ends_with(&archive_suffix) {
                a.get("browser_download_url")?.as_str().map(|s| s.to_string())
            } else {
                None
            }
        })
        .next()
        .ok_or_else(|| format!("No {} binary found in release assets", target_pattern))?;

    let _ = window.emit("llama-server-download", "Downloading llama.cpp...");

    let response = client
        .get(&asset_url)
        .send()
        .await
        .map_err(|e| format!("Failed to download: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("Download failed with status: {}", response.status()));
    }

    let bytes = response.bytes().await.map_err(|e| format!("Download error: {}", e))?;

    let _ = window.emit("llama-server-download", "Extracting llama-server...");

    let tmp_archive = dir.join(format!("llama-release.{}", archive_ext));
    let tmp_extract = dir.join("llama-extract");

    use std::io::Write;
    let mut file = fs::File::create(&tmp_archive)
        .map_err(|e| format!("Failed to create temp file: {}", e))?;
    file.write_all(&bytes).map_err(|e| format!("Write error: {}", e))?;
    drop(file);

    let _ = fs::remove_dir_all(&tmp_extract);
    fs::create_dir_all(&tmp_extract).map_err(|e| format!("Failed to create extract dir: {}", e))?;

    // tar is available on macOS, Linux, and Windows 10+
    let tar_flag = if archive_ext == "tar.gz" { "xzf" } else { "xf" };
    let output = std::process::Command::new("tar")
        .arg(tar_flag)
        .arg(&tmp_archive)
        .arg("-C")
        .arg(&tmp_extract)
        .output()
        .map_err(|e| format!("Failed to extract: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Extraction failed: {}", stderr));
    }

    // Find the llama-server binary inside the extracted archive using walkdir
    let server_bin_name = if cfg!(target_os = "windows") { "llama-server.exe" } else { "llama-server" };
    let bin_src_dir = walkdir::WalkDir::new(&tmp_extract)
        .into_iter()
        .filter_map(|e| e.ok())
        .find(|e| e.file_type().is_file() && e.file_name().to_string_lossy() == server_bin_name)
        .and_then(|e| e.path().parent().map(|p| p.to_path_buf()))
        .ok_or("No llama-server binary found in extracted archive")?;

    // Copy all files from the located bin directory to the final bin dir
    for entry in walkdir::WalkDir::new(&bin_src_dir).max_depth(1).into_iter().filter_map(|e| e.ok()) {
        if entry.file_type().is_file() {
            let dest = dir.join(entry.file_name());
            let _ = fs::copy(entry.path(), &dest);
        }
    }

    // Set executable permission — Unix only
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Ok(meta) = fs::metadata(&server_path) {
            let mut perms = meta.permissions();
            perms.set_mode(0o755);
            let _ = fs::set_permissions(&server_path, perms);
        }
    }

    // Create short symlinks for versioned dylibs — macOS only
    #[cfg(target_os = "macos")]
    {
        let _ = std::process::Command::new("bash")
            .arg("-c")
            .arg(format!(
                "cd '{}' && for f in *.dylib; do base=$(echo \"$f\" | sed -E 's/\\.[0-9]+\\.[0-9]+\\.dylib/.dylib/'); if [ \"$f\" != \"$base\" ] && [ ! -e \"$base\" ]; then ln -sf \"$f\" \"$base\"; fi; done",
                dir.display()
            ))
            .output();
    }

    let _ = fs::remove_file(&tmp_archive);
    let _ = fs::remove_dir_all(&tmp_extract);

    let _ = window.emit("llama-server-download", "llama-server ready!");

    Ok(())
}

#[tauri::command]
pub async fn start_llama_server() -> Result<(), String> {
    let server_bin = llama_server_path();
    if !server_bin.exists() {
        return Err("llama-server binary not found. Please download it first.".to_string());
    }

    let model = model_path();
    if !model.exists() {
        return Err("Model not found. Please download the model first.".to_string());
    }

    // Check if already running
    if let Ok(resp) = reqwest::Client::new()
        .get(format!("http://127.0.0.1:{}/health", LLAMA_SERVER_PORT))
        .timeout(std::time::Duration::from_secs(1))
        .send()
        .await
    {
        if resp.status().is_success() {
            return Ok(()); // Already running
        }
    }

    // Use all available threads for faster model loading
    let thread_count = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(4)
        .to_string();

    // Start llama-server in background
    std::process::Command::new(&server_bin)
        .arg("-m").arg(&model)
        .arg("--port").arg(LLAMA_SERVER_PORT.to_string())
        .arg("-c").arg("4096")
        .arg("--threads").arg(&thread_count)
        .arg("--log-disable")
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map_err(|e| format!("Failed to start llama-server: {}", e))?;

    // Wait for server to be ready — up to 90 seconds (model loading can be slow)
    let client = reqwest::Client::new();
    for _ in 0..180 {
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
        if let Ok(resp) = client
            .get(format!("http://127.0.0.1:{}/health", LLAMA_SERVER_PORT))
            .timeout(std::time::Duration::from_secs(2))
            .send()
            .await
        {
            if resp.status().is_success() {
                return Ok(());
            }
        }
    }

    Err("llama-server did not respond within 90 seconds. It may still be loading — check again in a moment.".to_string())
}

#[tauri::command]
pub async fn stop_llama_server() -> Result<(), String> {
    #[cfg(not(target_os = "windows"))]
    {
        std::process::Command::new("pkill")
            .arg("-f")
            .arg("llama-server")
            .output()
            .map_err(|e| format!("Failed to stop server: {}", e))?;
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("taskkill")
            .args(["/F", "/IM", "llama-server.exe"])
            .output()
            .map_err(|e| format!("Failed to stop server: {}", e))?;
    }
    Ok(())
}

#[tauri::command]
pub async fn ai_generate_summary(prompt: String) -> Result<String, String> {
    // Check if server is running
    let client = reqwest::Client::new();
    let health = client
        .get(format!("http://127.0.0.1:{}/health", LLAMA_SERVER_PORT))
        .timeout(std::time::Duration::from_secs(2))
        .send()
        .await
        .map_err(|_| "AI server is not running. Please start it from Settings.".to_string())?;

    if !health.status().is_success() {
        return Err("AI server is not healthy".to_string());
    }

    let body = serde_json::json!({
        "messages": [
            {
                "role": "system",
                "content": "You are a helpful software engineer assistant. Analyze the project details provided and return a very concise 2-3 sentence summary."
            },
            {
                "role": "user",
                "content": prompt
            }
        ],
        "temperature": 0.3,
        "max_tokens": 512
    });

    let response = client
        .post(format!("http://127.0.0.1:{}/v1/chat/completions", LLAMA_SERVER_PORT))
        .json(&body)
        .timeout(std::time::Duration::from_secs(60))
        .send()
        .await
        .map_err(|e| format!("AI request failed: {}", e))?;

    if !response.status().is_success() {
        let error_body = response.text().await.unwrap_or_default();
        return Err(format!("AI server returned error: {}", error_body));
    }

    let result: serde_json::Value = response.json().await
        .map_err(|e| format!("Failed to parse AI response: {}", e))?;

    let message = result
        .get("choices")
        .and_then(|c| c.as_array())
        .and_then(|c| c.first())
        .and_then(|c| c.get("message"));

    let mut content = String::new();
    if let Some(m) = message {
        // Skip reasoning_content — never show Qwen3's internal thinking chain
        if let Some(text) = m.get("content").and_then(|v| v.as_str()) {
            content.push_str(text);
        }
    }

    let content = strip_think_blocks(content.trim());
    let content = if content.is_empty() { "No response generated".to_string() } else { content };

    Ok(content)
}

fn strip_think_blocks(s: &str) -> String {
    // Remove <think>...</think> blocks that Qwen3 may embed in the content field
    let mut out = s.to_string();
    while let (Some(start), Some(end)) = (out.find("<think>"), out.find("</think>")) {
        if start <= end {
            let end_full = end + "</think>".len();
            out.replace_range(start..end_full, "");
        } else {
            break;
        }
    }
    // Also strip any orphaned opening <think> with no closing tag (truncated output)
    if let Some(pos) = out.find("<think>") {
        out.truncate(pos);
    }
    out.trim().to_string()
}

// ── Ollama integration ─────────────────────────────────────────────────────

#[derive(Serialize)]
pub struct OllamaStatus {
    pub running: bool,
    pub models: Vec<String>,
}

fn summaries_dir() -> PathBuf {
    devian_home().join(".devian").join("summaries")
}

use base64::{engine::general_purpose, Engine as _};

#[tauri::command]
pub async fn save_ai_project_summary(path: String, summary: String) -> Result<(), String> {
    let dir = summaries_dir();
    fs::create_dir_all(&dir).map_err(|e| format!("Failed to create summaries directory: {}", e))?;
    
    let encoded_path = general_purpose::URL_SAFE_NO_PAD.encode(path.as_bytes());
    let file_path = dir.join(format!("{}.md", encoded_path));
    
    fs::write(file_path, summary).map_err(|e| format!("Failed to save summary: {}", e))?;
    Ok(())
}

#[tauri::command]
pub async fn load_ai_project_summary(path: String) -> Result<String, String> {
    let encoded_path = general_purpose::URL_SAFE_NO_PAD.encode(path.as_bytes());
    let file_path = summaries_dir().join(format!("{}.md", encoded_path));
    
    if file_path.exists() {
        if let Ok(content) = fs::read_to_string(&file_path) {
            return Ok(content);
        }
    }
    
    Err("Summary not found".to_string())
}
