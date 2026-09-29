//! Crash reports and app info for bug reports. A panic is written to
//! ~/.devian/crashes, never sent anywhere: on next launch the app offers to
//! include it in a report, and the user decides.

use serde::Serialize;
use std::path::PathBuf;

fn crash_dir() -> Option<PathBuf> {
    let home = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE"))?;
    Some(PathBuf::from(home).join(".devian").join("crashes"))
}

/// Replaces the home folder with `~`, so reports don't carry the user's name.
pub fn scrub(text: &str) -> String {
    let home = std::env::var("HOME").or_else(|_| std::env::var("USERPROFILE")).unwrap_or_default();
    if home.len() > 1 {
        text.replace(&home, "~")
    } else {
        text.to_string()
    }
}

/// Records panics to disk, then defers to the default hook (stderr).
pub fn install_panic_hook(mode: &'static str) {
    let default = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let _ = write_crash(mode, info);
        default(info);
    }));
}

fn write_crash(mode: &str, info: &std::panic::PanicHookInfo) -> std::io::Result<()> {
    let dir = crash_dir().ok_or_else(|| std::io::Error::other("no home"))?;
    std::fs::create_dir_all(&dir)?;
    let message = info
        .payload()
        .downcast_ref::<&str>()
        .map(|s| s.to_string())
        .or_else(|| info.payload().downcast_ref::<String>().cloned())
        .unwrap_or_else(|| "unknown panic".into());
    let location = info.location().map(|l| format!("{}:{}", l.file(), l.line())).unwrap_or_default();
    let report = format!(
        "Devian {} ({mode}) on {} {}\nthread: {}\npanic: {message}\nat: {location}\n\n{}",
        env!("CARGO_PKG_VERSION"),
        std::env::consts::OS,
        std::env::consts::ARCH,
        std::thread::current().name().unwrap_or("unnamed"),
        std::backtrace::Backtrace::force_capture(),
    );
    let at = chrono::Utc::now().timestamp_millis();
    std::fs::write(dir.join(format!("{at}.log")), scrub(&report))
}

#[derive(Serialize)]
pub struct CrashReport {
    pub id: String,
    /// Unix milliseconds.
    pub at: i64,
    pub text: String,
}

/// The newest crash the user hasn't dealt with yet.
fn pending_crash() -> Option<CrashReport> {
    let dir = crash_dir()?;
    let mut logs: Vec<(i64, PathBuf)> = std::fs::read_dir(&dir)
        .ok()?
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|x| x == "log"))
        .filter_map(|p| Some((p.file_stem()?.to_str()?.parse().ok()?, p)))
        .collect();
    logs.sort_by_key(|(at, _)| *at);
    let (at, path) = logs.pop()?;
    let text = std::fs::read_to_string(&path).ok()?;
    // Backtraces can be long; the top is what matters.
    let text: String = text.lines().take(80).collect::<Vec<_>>().join("\n");
    Some(CrashReport { id: at.to_string(), at, text })
}

#[derive(Serialize)]
pub struct AppInfo {
    pub version: String,
    pub os: String,
    pub os_version: String,
    pub arch: String,
}

#[tauri::command]
pub fn diagnostics_info() -> AppInfo {
    AppInfo {
        version: env!("CARGO_PKG_VERSION").into(),
        os: std::env::consts::OS.into(),
        os_version: sysinfo::System::long_os_version().unwrap_or_default(),
        arch: std::env::consts::ARCH.into(),
    }
}

#[tauri::command]
pub fn diagnostics_pending_crash() -> Option<CrashReport> {
    pending_crash()
}

/// Marks every crash up to `id` as handled, whether it was sent or dismissed.
#[tauri::command]
pub fn diagnostics_dismiss_crash(id: String) -> Result<(), String> {
    let upto: i64 = id.parse().map_err(|_| "bad id".to_string())?;
    let Some(dir) = crash_dir() else { return Ok(()) };
    for p in std::fs::read_dir(&dir).map_err(|e| e.to_string())?.flatten().map(|e| e.path()) {
        let at = p.file_stem().and_then(|s| s.to_str()).and_then(|s| s.parse::<i64>().ok());
        if p.extension().is_some_and(|x| x == "log") && at.is_some_and(|at| at <= upto) {
            let _ = std::fs::rename(&p, p.with_extension("seen"));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scrub_removes_home() {
        let home = std::env::var("HOME").unwrap();
        assert_eq!(scrub(&format!("{home}/code/app")), "~/code/app");
    }
}
