//! Which running processes and containers came from an AI agent, and which
//! ones the agent left behind.
//!
//! Attribution has three levels of confidence:
//! - `direct`: the process is a descendant of a live agent process.
//! - `tracked`: Devian saw it under an agent earlier; the agent has since exited
//!   (or the shell that launched it did, re-parenting it to init).
//! - `likely`: an orphaned process or container whose working directory is a
//!   project an agent session was active in when it started.

use super::{home, is_meaningful_project, now_ms, AgentSession};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, Signal, System, UpdateKind};

#[derive(Serialize, Clone)]
pub struct RunningAgent {
    pub agent: String,
    pub pid: u32,
    pub name: String,
    pub cwd: Option<String>,
    pub started_at: i64,
    pub memory_bytes: u64,
    pub child_count: usize,
}

#[derive(Serialize, Clone)]
pub struct AttributedItem {
    /// `pid:<pid>:<start>` or `container:<id>`; used to stop it.
    pub key: String,
    /// process | container
    pub kind: String,
    pub pid: Option<u32>,
    pub container_id: Option<String>,
    pub name: String,
    pub command: String,
    pub cwd: Option<String>,
    pub ports: Vec<u16>,
    pub memory_bytes: u64,
    pub process_count: usize,
    pub started_at: i64,
    pub agent: String,
    /// direct | tracked | likely | ide
    pub confidence: String,
    pub leftover: bool,
    pub session_id: Option<String>,
    pub session_title: Option<String>,
    pub project_path: Option<String>,
}

#[derive(Serialize, Clone)]
pub struct RuntimeReport {
    pub agents: Vec<RunningAgent>,
    pub items: Vec<AttributedItem>,
    pub leftover_count: usize,
    pub leftover_memory_bytes: u64,
    pub generated_at: i64,
}

#[derive(Serialize, Deserialize, Clone)]
struct Tracked {
    agent: String,
    agent_pid: u32,
    agent_start: u64,
    first_seen: i64,
}

// ── Process snapshot ─────────────────────────────────────────────────────────

struct Proc {
    pid: u32,
    parent: Option<u32>,
    name: String,
    cmd: String,
    exe: String,
    cwd: Option<String>,
    start: u64,
    memory: u64,
    own_user: bool,
}

fn system() -> &'static Mutex<System> {
    static SYS: OnceLock<Mutex<System>> = OnceLock::new();
    SYS.get_or_init(|| Mutex::new(System::new()))
}

fn snapshot() -> HashMap<u32, Proc> {
    let Ok(mut sys) = system().lock() else { return HashMap::new() };
    sys.refresh_processes_specifics(
        ProcessesToUpdate::All,
        true,
        ProcessRefreshKind::nothing()
            .with_memory()
            .with_cmd(UpdateKind::OnlyIfNotSet)
            .with_exe(UpdateKind::OnlyIfNotSet)
            .with_cwd(UpdateKind::Always)
            .with_user(UpdateKind::OnlyIfNotSet),
    );
    let me = sys.process(Pid::from_u32(std::process::id())).and_then(|p| p.user_id().cloned());
    sys.processes()
        .iter()
        .map(|(pid, p)| {
            let cmd = p.cmd().iter().map(|s| s.to_string_lossy()).collect::<Vec<_>>().join(" ");
            (
                pid.as_u32(),
                Proc {
                    pid: pid.as_u32(),
                    parent: p.parent().map(|x| x.as_u32()),
                    name: p.name().to_string_lossy().into_owned(),
                    cmd,
                    exe: p.exe().map(|e| e.to_string_lossy().into_owned()).unwrap_or_default(),
                    cwd: p.cwd().map(|c| c.to_string_lossy().into_owned()).filter(|c| !c.is_empty()),
                    start: p.start_time(),
                    memory: p.memory(),
                    own_user: me.is_none() || p.user_id() == me.as_ref(),
                },
            )
        })
        .collect()
}

pub fn classify(name: &str, exe: &str, cmd: &str) -> Option<&'static str> {
    let n = name.to_lowercase();
    let n = n.trim_end_matches(".exe");
    let e = exe.to_lowercase();
    let c: String = cmd.to_lowercase().chars().take(400).collect();
    if n == "devian" || n == "devian-desktop" {
        return None;
    }
    // Claude Code's native binary is named after its version (e.g. ~/.local/share/claude/versions/2.1.284).
    if n == "claude" || e.contains("/claude.app/") || e.contains("/claude/versions/") || e.contains("/.claude/local/") || c.contains("@anthropic-ai/claude-code") || c.contains("claude-code/cli") {
        return Some("claude");
    }
    if n == "codex" || e.contains("/codex.app/") || c.contains("@openai/codex") || e.ends_with("/codex") {
        return Some("codex");
    }
    if n == "opencode" || c.contains("opencode-ai") || e.ends_with("/opencode") {
        return Some("opencode");
    }
    if n == "cursor" || n == "cursor-agent" || n.starts_with("cursor helper") || e.contains("/cursor.app/") || e.contains("\\cursor\\") || c.contains("cursor-agent") {
        return Some("cursor");
    }
    if n.starts_with("antigravity") || e.contains("/antigravity.app/") || e.contains("\\antigravity\\") {
        return Some("antigravity");
    }
    None
}

fn is_shell(name: &str) -> bool {
    let n = name.to_lowercase();
    let n = n.trim_end_matches(".exe").trim_start_matches('-');
    matches!(n, "sh" | "bash" | "zsh" | "fish" | "dash" | "nu" | "pwsh" | "powershell" | "cmd")
}

fn is_noise(name: &str) -> bool {
    matches!(name.to_lowercase().as_str(), "sleep" | "caffeinate" | "login" | "ps" | "lsof")
}

fn is_system_binary(exe: &str) -> bool {
    let e = exe.to_lowercase();
    e.contains(".app/contents/")
        || ["/system/", "/usr/libexec/", "/usr/sbin/", "/sbin/", "/library/", "c:\\windows\\"].iter().any(|p| e.starts_with(p))
}

fn is_init(procs: &HashMap<u32, Proc>, pid: Option<u32>) -> bool {
    match pid {
        None | Some(0) | Some(1) => true,
        Some(p) => procs.get(&p).is_none_or(|pp| matches!(pp.name.as_str(), "launchd" | "systemd" | "init")),
    }
}

// ── Tracker persistence ──────────────────────────────────────────────────────

fn tracker_path() -> PathBuf {
    home().join(".devian").join("agent-tracker.json")
}

fn tracker() -> &'static Mutex<HashMap<String, Tracked>> {
    static T: OnceLock<Mutex<HashMap<String, Tracked>>> = OnceLock::new();
    T.get_or_init(|| {
        let loaded = std::fs::read_to_string(tracker_path())
            .ok()
            .and_then(|t| serde_json::from_str(&t).ok())
            .unwrap_or_default();
        Mutex::new(loaded)
    })
}

fn save_tracker(map: &HashMap<String, Tracked>) {
    let p = tracker_path();
    if let Some(dir) = p.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    if let Ok(text) = serde_json::to_string(map) {
        let _ = std::fs::write(p, text);
    }
}

// ── Ports & containers ───────────────────────────────────────────────────────

pub async fn listening_ports() -> HashMap<u32, Vec<u16>> {
    let mut m: HashMap<u32, Vec<u16>> = HashMap::new();
    let ports = crate::commands::network::fetch_active_ports().await.unwrap_or_default();
    for p in ports {
        let pid = p["pid"].as_str().and_then(|s| s.parse::<u32>().ok());
        let port = p["port"].as_str().and_then(|s| s.parse::<u16>().ok());
        if let (Some(pid), Some(port)) = (pid, port) {
            m.entry(pid).or_default().push(port);
        }
    }
    m
}

struct Container {
    id: String,
    name: String,
    image: String,
    working_dir: Option<String>,
    created_ms: i64,
    ports: Vec<u16>,
}

fn containers() -> Vec<Container> {
    let Ok(out) = std::process::Command::new("docker")
        .args(["ps", "--format", "{{json .}}"])
        .output()
    else {
        return vec![];
    };
    if !out.status.success() {
        return vec![];
    }
    let port_re = regex::Regex::new(r":(\d+)->").ok();
    String::from_utf8_lossy(&out.stdout)
        .lines()
        .filter_map(|l| serde_json::from_str::<serde_json::Value>(l).ok())
        .map(|v| {
            let labels = v["Labels"].as_str().unwrap_or("");
            let working_dir = labels
                .split(',')
                .find_map(|kv| kv.strip_prefix("com.docker.compose.project.working_dir="))
                .map(String::from);
            // "2026-09-29 10:00:00 +0530 IST"
            let created = v["CreatedAt"].as_str().unwrap_or("");
            let created_ms = created
                .rsplit_once(' ')
                .and_then(|(head, _)| chrono::DateTime::parse_from_str(head, "%Y-%m-%d %H:%M:%S %z").ok())
                .map(|d| d.timestamp_millis())
                .unwrap_or(0);
            let ports_s = v["Ports"].as_str().unwrap_or("");
            let mut ports: Vec<u16> = port_re
                .as_ref()
                .map(|r| r.captures_iter(ports_s).filter_map(|c| c[1].parse().ok()).collect())
                .unwrap_or_default();
            ports.dedup();
            Container {
                id: v["ID"].as_str().unwrap_or("").to_string(),
                name: v["Names"].as_str().unwrap_or("").to_string(),
                image: v["Image"].as_str().unwrap_or("").to_string(),
                working_dir,
                created_ms,
                ports,
            }
        })
        .collect()
}

// ── Report ───────────────────────────────────────────────────────────────────

fn descendants(procs: &HashMap<u32, Proc>, children: &HashMap<u32, Vec<u32>>, root: u32) -> Vec<u32> {
    let mut out = vec![];
    let mut stack = vec![root];
    while let Some(p) = stack.pop() {
        for c in children.get(&p).into_iter().flatten() {
            if procs.get(c).is_some_and(|cp| classify(&cp.name, &cp.exe, &cp.cmd).is_none()) {
                out.push(*c);
                stack.push(*c);
            }
        }
    }
    out
}

fn within(path: &str, project: &str) -> bool {
    Path::new(path).starts_with(project)
}

/// The session in `project` that was active when something started at `start_ms`.
fn session_at<'a>(sessions: &'a [AgentSession], cwd: &str, start_ms: i64, agent: Option<&str>) -> Option<&'a AgentSession> {
    sessions
        .iter()
        .filter(|s| agent.is_none_or(|a| s.agent == a))
        .filter(|s| s.project_path.as_deref().is_some_and(|p| is_meaningful_project(p) && within(cwd, p)))
        .filter(|s| start_ms >= s.started_at - 60_000 && start_ms <= s.updated_at + 120_000)
        .max_by_key(|s| s.project_path.as_ref().map(|p| p.len()).unwrap_or(0))
}

pub fn running_agent_ids() -> HashSet<String> {
    snapshot()
        .values()
        .filter_map(|p| classify(&p.name, &p.exe, &p.cmd))
        .map(String::from)
        .collect()
}

pub async fn report(sessions: &[AgentSession]) -> RuntimeReport {
    let ports = listening_ports().await;
    let sessions = sessions.to_vec();
    tokio::task::spawn_blocking(move || build_report(&sessions, &ports, containers()))
        .await
        .unwrap_or(RuntimeReport { agents: vec![], items: vec![], leftover_count: 0, leftover_memory_bytes: 0, generated_at: now_ms() })
}

fn build_report(sessions: &[AgentSession], ports: &HashMap<u32, Vec<u16>>, containers: Vec<Container>) -> RuntimeReport {
    let procs = snapshot();
    let now = now_ms();
    let mut children: HashMap<u32, Vec<u32>> = HashMap::new();
    for p in procs.values() {
        if let Some(pp) = p.parent {
            children.entry(pp).or_default().push(p.pid);
        }
    }
    let agent_of: HashMap<u32, &'static str> = procs
        .values()
        .filter_map(|p| classify(&p.name, &p.exe, &p.cmd).map(|a| (p.pid, a)))
        .collect();
    let alive = |pid: u32, start: u64| procs.get(&pid).is_some_and(|p| p.start == start);

    // Top-level agent processes (not helpers of the same agent).
    let mut agents: Vec<RunningAgent> = agent_of
        .iter()
        .filter(|(pid, a)| procs[pid].parent.and_then(|pp| agent_of.get(&pp)) != Some(a))
        .map(|(pid, a)| {
            let p = &procs[pid];
            let desc = descendants(&procs, &children, *pid);
            RunningAgent {
                agent: a.to_string(),
                pid: *pid,
                name: p.name.clone(),
                cwd: p.cwd.clone(),
                started_at: p.start as i64 * 1000,
                memory_bytes: p.memory + desc.iter().map(|d| procs[d].memory).sum::<u64>(),
                child_count: desc.len(),
            }
        })
        .collect();
    agents.sort_by_key(|a| a.started_at);

    let mut tracked = tracker().lock().map(|t| t.clone()).unwrap_or_default();
    let mut items: Vec<AttributedItem> = vec![];
    let mut claimed: HashSet<u32> = HashSet::new();

    let mut push_process = |root: &Proc, agent: &str, confidence: &str, leftover: bool, session: Option<&AgentSession>, claimed: &mut HashSet<u32>| {
        let desc = descendants(&procs, &children, root.pid);
        let mut all = vec![root.pid];
        all.extend(desc.iter().copied());
        claimed.extend(all.iter().copied());
        let mut item_ports: Vec<u16> = all.iter().flat_map(|p| ports.get(p).cloned().unwrap_or_default()).collect();
        item_ports.sort_unstable();
        item_ports.dedup();
        items.push(AttributedItem {
            key: format!("pid:{}:{}", root.pid, root.start),
            kind: "process".into(),
            pid: Some(root.pid),
            container_id: None,
            name: root.name.clone(),
            command: super::truncate(&root.cmd, 300),
            cwd: root.cwd.clone(),
            ports: item_ports,
            memory_bytes: all.iter().map(|p| procs[p].memory).sum(),
            process_count: all.len(),
            started_at: root.start as i64 * 1000,
            agent: agent.to_string(),
            confidence: confidence.to_string(),
            leftover,
            session_id: session.map(|s| s.id.clone()),
            session_title: session.map(|s| s.title.clone()),
            project_path: session.and_then(|s| s.project_path.clone()).or_else(|| root.cwd.clone()),
        });
    };

    // 1. Direct: command roots (parent is a shell or the agent) under a live agent.
    let mut roots: Vec<&Proc> = procs.values().collect();
    roots.sort_by_key(|p| p.start);
    for p in &roots {
        if agent_of.contains_key(&p.pid) || is_shell(&p.name) || is_noise(&p.name) || claimed.contains(&p.pid) {
            continue;
        }
        let Some(parent) = p.parent.and_then(|pp| procs.get(&pp)) else { continue };
        if !is_shell(&parent.name) && !agent_of.contains_key(&parent.pid) {
            continue;
        }
        // Walk up to the agent, requiring a shell on the way (commands, not internal helpers).
        let mut cur = p.parent;
        let mut saw_shell = false;
        let mut found = None;
        for _ in 0..64 {
            let Some(c) = cur.and_then(|c| procs.get(&c)) else { break };
            if let Some(a) = agent_of.get(&c.pid) {
                found = Some((*a, c));
                break;
            }
            saw_shell |= is_shell(&c.name);
            cur = c.parent;
        }
        let Some((agent, agent_proc)) = found else { continue };
        let has_port = ports.contains_key(&p.pid);
        let age_s = (now / 1000) as u64 - p.start.min((now / 1000) as u64);
        if !(saw_shell || has_port) || (age_s < 10 && !has_port) {
            continue;
        }
        let ide = matches!(agent, "cursor" | "antigravity");
        tracked.entry(format!("pid:{}:{}", p.pid, p.start)).or_insert(Tracked {
            agent: agent.to_string(),
            agent_pid: agent_proc.pid,
            agent_start: agent_proc.start,
            first_seen: now,
        });
        let session = p.cwd.as_deref().and_then(|c| session_at(sessions, c, p.start as i64 * 1000, Some(agent)));
        push_process(p, agent, if ide { "ide" } else { "direct" }, false, session, &mut claimed);
    }

    // 2. Tracked: seen under an agent before, now detached or the agent is gone.
    tracked.retain(|key, _| {
        let mut parts = key.split(':').skip(1);
        let pid = parts.next().and_then(|s| s.parse().ok()).unwrap_or(0);
        let start = parts.next().and_then(|s| s.parse().ok()).unwrap_or(0);
        alive(pid, start)
    });
    for (key, t) in &tracked {
        let pid: u32 = key.split(':').nth(1).and_then(|s| s.parse().ok()).unwrap_or(0);
        if claimed.contains(&pid) {
            continue;
        }
        let Some(p) = procs.get(&pid) else { continue };
        let agent_alive = alive(t.agent_pid, t.agent_start);
        let session = p.cwd.as_deref().and_then(|c| session_at(sessions, c, p.start as i64 * 1000, Some(&t.agent)));
        push_process(p, &t.agent, "tracked", !agent_alive, session, &mut claimed);
    }

    // 3. Likely: orphaned processes started in an agent's project during a session.
    let live_agent_cwds: Vec<(&str, String)> = agents.iter().filter_map(|a| a.cwd.clone().map(|c| (a.agent.as_str(), c))).collect();
    let agent_active_in = |agent: &str, project: &str| {
        live_agent_cwds.iter().any(|(a, c)| *a == agent && (within(c, project) || within(project, c)))
    };
    for p in &roots {
        if claimed.contains(&p.pid) || agent_of.contains_key(&p.pid) || is_shell(&p.name) || is_noise(&p.name) {
            continue;
        }
        if !p.own_user || !is_init(&procs, p.parent) || is_system_binary(&p.exe) {
            continue;
        }
        let Some(cwd) = p.cwd.as_deref().filter(|c| is_meaningful_project(c)) else { continue };
        let start_ms = p.start as i64 * 1000;
        if now - start_ms < 10_000 {
            continue;
        }
        let Some(session) = session_at(sessions, cwd, start_ms, None) else { continue };
        let project = session.project_path.clone().unwrap_or_default();
        let leftover = !agent_active_in(&session.agent, &project) || now - session.updated_at > 10 * 60_000;
        let agent = session.agent.clone();
        push_process(p, &agent, "likely", leftover, Some(session), &mut claimed);
    }

    // Containers started from a project while an agent session was active there.
    for c in containers {
        let Some(dir) = c.working_dir.as_deref().filter(|d| is_meaningful_project(d)) else { continue };
        let Some(session) = session_at(sessions, dir, c.created_ms, None) else { continue };
        let project = session.project_path.clone().unwrap_or_default();
        let leftover = !agent_active_in(&session.agent, &project) || now - session.updated_at > 10 * 60_000;
        items.push(AttributedItem {
            key: format!("container:{}", c.id),
            kind: "container".into(),
            pid: None,
            container_id: Some(c.id.clone()),
            name: c.name,
            command: c.image,
            cwd: Some(dir.to_string()),
            ports: c.ports,
            memory_bytes: 0,
            process_count: 1,
            started_at: c.created_ms,
            agent: session.agent.clone(),
            confidence: "likely".into(),
            leftover,
            session_id: Some(session.id.clone()),
            session_title: Some(session.title.clone()),
            project_path: session.project_path.clone(),
        });
    }

    if let Ok(mut t) = tracker().lock() {
        *t = tracked.clone();
    }
    save_tracker(&tracked);

    items.sort_by(|a, b| b.leftover.cmp(&a.leftover).then(b.started_at.cmp(&a.started_at)));
    let leftovers: Vec<&AttributedItem> = items.iter().filter(|i| i.leftover).collect();
    RuntimeReport {
        leftover_count: leftovers.len(),
        leftover_memory_bytes: leftovers.iter().map(|i| i.memory_bytes).sum(),
        agents,
        items,
        generated_at: now,
    }
}

/// Stops processes (with their child processes) and containers from a report.
/// Only keys present in a fresh report are acted on.
pub async fn stop_items(sessions: &[AgentSession], keys: &[String]) -> Result<usize, String> {
    let rep = report(sessions).await;
    let wanted: Vec<AttributedItem> = rep.items.into_iter().filter(|i| keys.contains(&i.key)).collect();
    let mut stopped = 0;
    let mut pids: Vec<Pid> = vec![];
    for item in &wanted {
        if let Some(id) = &item.container_id {
            let ok = std::process::Command::new("docker")
                .args(["stop", id])
                .output()
                .map(|o| o.status.success())
                .unwrap_or(false);
            if ok {
                stopped += 1;
            }
        } else if let Some(pid) = item.pid {
            pids.push(Pid::from_u32(pid));
        }
    }
    if pids.is_empty() {
        return Ok(stopped);
    }
    tokio::task::spawn_blocking(move || kill_tree(&pids, std::time::Duration::from_millis(1500)))
        .await
        .map(|n| stopped + n)
        .map_err(|e| e.to_string())
}

/// SIGTERMs each root and all its descendants, waits `grace`, then SIGKILLs
/// whatever is left. Processes are matched on (pid, start time) so a recycled
/// pid is never hit. Returns how many roots are gone afterwards.
pub fn kill_tree(roots: &[Pid], grace: std::time::Duration) -> usize {
    let Ok(mut sys) = system().lock() else { return 0 };
    sys.refresh_processes(ProcessesToUpdate::All, true);
    let mut targets: Vec<(Pid, u64)> = vec![];
    for root in roots {
        let Some(p) = sys.process(*root) else { continue };
        targets.push((*root, p.start_time()));
        let mut stack = vec![*root];
        while let Some(cur) = stack.pop() {
            for (pid, p) in sys.processes() {
                if p.parent() == Some(cur) && !targets.iter().any(|(t, _)| t == pid) {
                    targets.push((*pid, p.start_time()));
                    stack.push(*pid);
                }
            }
        }
    }
    // Children first, so parents don't respawn them.
    for (pid, _) in targets.iter().rev() {
        if let Some(p) = sys.process(*pid) {
            if p.kill_with(Signal::Term).is_none() {
                p.kill();
            }
        }
    }
    let alive = |sys: &System, pid: Pid, start: u64| {
        sys.process(pid).is_some_and(|p| p.start_time() == start && !matches!(p.status(), sysinfo::ProcessStatus::Zombie | sysinfo::ProcessStatus::Dead))
    };
    let deadline = std::time::Instant::now() + grace;
    let pids: Vec<Pid> = targets.iter().map(|(p, _)| *p).collect();
    while std::time::Instant::now() < deadline {
        std::thread::sleep(std::time::Duration::from_millis(100));
        sys.refresh_processes(ProcessesToUpdate::Some(&pids), true);
        if !targets.iter().any(|(p, s)| alive(&sys, *p, *s)) {
            break;
        }
    }
    for (pid, start) in &targets {
        if alive(&sys, *pid, *start) {
            if let Some(p) = sys.process(*pid) {
                p.kill();
            }
        }
    }
    std::thread::sleep(std::time::Duration::from_millis(100));
    sys.refresh_processes(ProcessesToUpdate::Some(&pids), true);
    roots
        .iter()
        .filter(|r| targets.iter().find(|(p, _)| p == *r).is_some_and(|(p, s)| !alive(&sys, *p, *s)))
        .count()
}
