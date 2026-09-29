pub mod agents;
pub mod commands;
mod diagnostics;
mod mcp;

use commands::docker::*;
use commands::projects::*;
use commands::process::*;
use commands::network::*;
use commands::os_utils::*;
use commands::ai::*;
use commands::runner::*;
use commands::deps::*;
use commands::env::*;
use agents::commands::*;
use std::sync::Arc;

/// Runs Devian as a stdio MCP server instead of opening the app.
pub fn run_mcp() {
    diagnostics::install_panic_hook("mcp");
    mcp::run();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    diagnostics::install_panic_hook("app");
    fix_macos_path();
    let script_registry = Arc::new(ScriptRegistry::new());
    tauri::Builder::default()
        .manage(script_registry)
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, None))
        .invoke_handler(tauri::generate_handler![
            check_docker_status,
            request_disk_access,
            check_full_disk_access,
            fetch_docker_containers,
            restart_docker_container,
            fetch_docker_container_logs,
            fetch_system_processes,
            fetch_active_ports,
            kill_process,
            scan_local_projects,
            start_docker_container,
            stop_docker_container,
            get_user_settings,
            save_user_settings,
            open_in_finder,
            open_in_terminal,
            open_in_editor,
            delete_dependency_folder,
            fetch_project_commits,
            fetch_commit_timeline,
            start_project_docker_stack,
            stop_project_docker_stack,
            fetch_docker_system_df,
            prune_all_docker_builds,
            prune_docker_system,
            add_cleanup_entry,
            archive_project,
            delete_project,
            check_model_status,
            download_model,
            delete_model,
            fetch_git_branch,
            fetch_git_branches,
            git_fetch,
            git_pull,
            git_push,
            git_stash_changes,
            git_create_branch,
            git_switch_branch,
            run_script_background,
            stop_running_script,
            get_running_scripts,
            get_project_context,
            check_llama_server_status,
            download_llama_server,
            start_llama_server,
            stop_llama_server,
            ai_generate_summary,
            save_ai_project_summary,
            load_ai_project_summary,
            check_dep_status,
            update_npm_package,
            update_package_to_latest,
            update_all_patch_packages,
            remove_unused_npm_packages,
            read_env_file,
            write_env_file,
            list_env_config_files,
            update_project_metadata,
            analyze_repository_insights,
            show_notification,
            read_project_config,
            write_project_config,
            agents_detect,
            agents_list_sessions,
            agents_session_detail,
            agents_runtime,
            agents_machine,
            agents_claude_instances,
            agents_limits,
            agents_stop,
            agents_list_memories,
            agents_open_memory,
            agents_save_memory,
            agents_delete_memory,
            agents_scan_dirt,
            agents_clean_dirt,
            agents_mcp_info,
            agents_mcp_status,
            agents_mcp_connect,
            diagnostics::diagnostics_info,
            diagnostics::diagnostics_pending_crash,
            diagnostics::diagnostics_dismiss_crash
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
