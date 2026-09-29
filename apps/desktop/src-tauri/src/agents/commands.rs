//! Tauri commands for the agent views. File and database reads run on the
//! blocking pool so the UI thread never waits on a large transcript.

use super::{dirt, memory, runtime, AgentInfo, AgentSession, SessionDetail};
use serde::Serialize;

async fn blocking<T: Send + 'static>(f: impl FnOnce() -> T + Send + 'static) -> Result<T, String> {
    tokio::task::spawn_blocking(f).await.map_err(|e| e.to_string())
}

pub async fn sessions() -> Vec<AgentSession> {
    blocking(super::list_all_sessions).await.unwrap_or_default()
}

#[tauri::command]
pub async fn agents_detect() -> Result<Vec<AgentInfo>, String> {
    let s = sessions().await;
    blocking(move || super::with_health(super::detect_agents(), &s)).await
}

#[tauri::command]
pub async fn agents_list_sessions() -> Result<Vec<AgentSession>, String> {
    Ok(sessions().await)
}

#[tauri::command]
pub async fn agents_session_detail(agent: String, source_path: String, id: String) -> Result<SessionDetail, String> {
    blocking(move || super::session_detail(&agent, &source_path, &id)).await?
}

#[tauri::command]
pub async fn agents_runtime() -> Result<runtime::RuntimeReport, String> {
    let s = sessions().await;
    Ok(runtime::report(&s).await)
}

#[tauri::command]
pub async fn agents_claude_instances() -> Result<Vec<super::claude::ClaudeInstance>, String> {
    blocking(super::claude::instances).await
}

/// Plan limits for the accounts the user turned on; others are returned
/// without their credentials being touched.
#[tauri::command]
pub async fn agents_limits(enabled: Vec<String>, force: bool) -> Result<Vec<super::limits::ProviderLimits>, String> {
    Ok(super::limits::fetch(&enabled, force).await)
}

#[tauri::command]
pub async fn agents_machine() -> Result<super::machine::MachineStats, String> {
    blocking(super::machine::stats).await
}

#[tauri::command]
pub async fn agents_stop(keys: Vec<String>) -> Result<usize, String> {
    let s = sessions().await;
    runtime::stop_items(&s, &keys).await
}

#[tauri::command]
pub async fn agents_list_memories() -> Result<Vec<memory::MemoryItem>, String> {
    let s = sessions().await;
    blocking(move || memory::list_memories(&s)).await
}

#[tauri::command]
pub async fn agents_open_memory(id: String) -> Result<memory::MemoryDoc, String> {
    let s = sessions().await;
    blocking(move || memory::open_memory(&s, &id)).await?
}

#[tauri::command]
pub async fn agents_save_memory(id: String, content: String, expected_modified: i64, force: bool) -> Result<i64, String> {
    let s = sessions().await;
    blocking(move || memory::save_memory(&s, &id, &content, expected_modified, force)).await?
}

#[tauri::command]
pub async fn agents_delete_memory(id: String) -> Result<(), String> {
    let s = sessions().await;
    blocking(move || memory::delete_memory(&s, &id)).await?
}

#[tauri::command]
pub async fn agents_scan_dirt(days: u32) -> Result<Vec<dirt::DirtItem>, String> {
    let s = sessions().await;
    blocking(move || dirt::scan(&s, days.max(1))).await
}

#[tauri::command]
pub async fn agents_clean_dirt(ids: Vec<String>, days: u32) -> Result<dirt::CleanResult, String> {
    let s = sessions().await;
    let result = blocking(move || {
        let running = runtime::running_agent_ids();
        dirt::clean(&s, days.max(1), &ids, &running)
    })
    .await?;
    if result.freed_bytes > 0 {
        let _ = crate::commands::projects::add_cleanup_entry("AI agent data".into(), result.freed_bytes as f64).await;
    }
    Ok(result)
}

#[tauri::command]
pub async fn agents_mcp_status() -> Result<Vec<super::mcp_setup::McpStatus>, String> {
    blocking(super::mcp_setup::status).await
}

#[tauri::command]
pub async fn agents_mcp_connect(agent: String) -> Result<String, String> {
    blocking(move || super::mcp_setup::connect(&agent)).await?
}

#[derive(Serialize)]
pub struct McpInfo {
    pub executable: String,
    pub args: Vec<String>,
    /// Set when this path is temporary and must not be written into configs.
    pub warning: Option<String>,
}

#[tauri::command]
pub async fn agents_mcp_info() -> Result<McpInfo, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?.to_string_lossy().into_owned();
    let warning = super::mcp_setup::unstable_location(&exe);
    Ok(McpInfo { executable: exe, args: vec!["--mcp".into()], warning })
}
