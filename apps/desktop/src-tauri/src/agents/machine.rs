//! Live hardware readings (CPU, memory, temperature, disk, battery) and how
//! much of the machine the agents themselves are using right now.

use serde::Serialize;
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use sysinfo::{Components, CpuRefreshKind, Disks, MemoryRefreshKind, ProcessRefreshKind, ProcessesToUpdate, RefreshKind, System, UpdateKind};

#[derive(Serialize, Clone)]
pub struct Sensor {
    pub label: String,
    pub celsius: f32,
}

#[derive(Serialize, Clone)]
pub struct Battery {
    pub percent: u8,
    pub charging: bool,
    /// e.g. "2:07 remaining", when the OS reports one.
    pub time_left: Option<String>,
}

#[derive(Serialize, Clone)]
pub struct AgentLoad {
    pub agent: String,
    pub cpu_percent: f32,
    pub memory_bytes: u64,
}

#[derive(Serialize, Clone)]
pub struct MachineStats {
    pub cpu_percent: f32,
    pub cpu_cores: usize,
    pub cpu_brand: String,
    pub load_avg: [f64; 3],
    pub memory_total: u64,
    pub memory_used: u64,
    pub swap_total: u64,
    pub swap_used: u64,
    pub disk_total: u64,
    pub disk_available: u64,
    /// Hottest CPU/SoC sensor, when the platform exposes one.
    pub cpu_temp: Option<f32>,
    pub sensors: Vec<Sensor>,
    pub battery: Option<Battery>,
    pub uptime_secs: u64,
    /// CPU is a share of the whole machine (0–100), like `cpu_percent`.
    pub agents: Vec<AgentLoad>,
}

struct State {
    sys: System,
    components: Components,
    disks: Disks,
}

fn state() -> &'static Mutex<State> {
    static S: OnceLock<Mutex<State>> = OnceLock::new();
    S.get_or_init(|| {
        let mut sys = System::new_with_specifics(RefreshKind::nothing().with_cpu(CpuRefreshKind::everything()).with_memory(MemoryRefreshKind::everything()));
        // CPU usage is a delta between two samples; take the first one now.
        sys.refresh_processes_specifics(ProcessesToUpdate::All, true, ProcessRefreshKind::nothing().with_cpu().with_memory());
        std::thread::sleep(sysinfo::MINIMUM_CPU_UPDATE_INTERVAL);
        Mutex::new(State { sys, components: Components::new_with_refreshed_list(), disks: Disks::new_with_refreshed_list() })
    })
}

fn is_cpu_sensor(label: &str) -> bool {
    let l = label.to_lowercase();
    ["cpu", "soc", "core", "package", "tdie", "tctl", "pmu tdie", "pacc", "eacc"].iter().any(|k| l.contains(k))
}

fn battery() -> Option<Battery> {
    #[cfg(target_os = "macos")]
    {
        // " -InternalBattery-0 (id=…)	27%; charging; 2:07 remaining present: true"
        let out = std::process::Command::new("pmset").args(["-g", "batt"]).output().ok()?;
        let text = String::from_utf8_lossy(&out.stdout);
        let line = text.lines().find(|l| l.contains('%'))?;
        let after_tab = line.split('\t').nth(1).unwrap_or(line);
        let mut parts = after_tab.split(';').map(str::trim);
        let percent = parts.next()?.trim_end_matches('%').parse().ok()?;
        let state = parts.next().unwrap_or("");
        let rest = parts.next().unwrap_or("");
        let time_left = rest
            .split_whitespace()
            .next()
            .filter(|t| t.contains(':') && *t != "0:00")
            .map(|t| format!("{t} {}", if state == "charging" { "to full" } else { "left" }));
        Some(Battery { percent, charging: state == "charging" || state == "charged" || state == "finishing charge", time_left })
    }
    #[cfg(target_os = "linux")]
    {
        let dir = std::fs::read_dir("/sys/class/power_supply").ok()?.flatten().map(|e| e.path()).find(|p| {
            std::fs::read_to_string(p.join("type")).is_ok_and(|t| t.trim() == "Battery")
        })?;
        let percent = std::fs::read_to_string(dir.join("capacity")).ok()?.trim().parse().ok()?;
        let status = std::fs::read_to_string(dir.join("status")).unwrap_or_default();
        Some(Battery { percent, charging: matches!(status.trim(), "Charging" | "Full"), time_left: None })
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    {
        None
    }
}

pub fn stats() -> MachineStats {
    let Ok(mut st) = state().lock() else {
        return MachineStats {
            cpu_percent: 0.0, cpu_cores: 0, cpu_brand: String::new(), load_avg: [0.0; 3], memory_total: 0, memory_used: 0,
            swap_total: 0, swap_used: 0, disk_total: 0, disk_available: 0, cpu_temp: None, sensors: vec![], battery: None, uptime_secs: 0, agents: vec![],
        };
    };
    let State { sys, components, disks } = &mut *st;
    sys.refresh_cpu_usage();
    sys.refresh_memory();
    sys.refresh_processes_specifics(
        ProcessesToUpdate::All,
        true,
        ProcessRefreshKind::nothing().with_cpu().with_memory().with_exe(UpdateKind::OnlyIfNotSet).with_cmd(UpdateKind::OnlyIfNotSet),
    );
    components.refresh(true);
    disks.refresh(true);

    // Agent processes and everything they spawned, attributed to the agent.
    let cores = sys.cpus().len().max(1);
    let procs = sys.processes();
    let mut owner: HashMap<sysinfo::Pid, &'static str> = HashMap::new();
    for (pid, p) in procs {
        let cmd = p.cmd().iter().map(|s| s.to_string_lossy()).collect::<Vec<_>>().join(" ");
        let exe = p.exe().map(|e| e.to_string_lossy().into_owned()).unwrap_or_default();
        if let Some(a) = super::runtime::classify(&p.name().to_string_lossy(), &exe, &cmd) {
            owner.insert(*pid, a);
        }
    }
    let mut loads: HashMap<&'static str, (f32, u64)> = HashMap::new();
    for (pid, p) in procs {
        // Walk up to the nearest agent ancestor (bounded, in case of cycles).
        let mut cur = Some(*pid);
        let mut agent = None;
        for _ in 0..32 {
            let Some(c) = cur else { break };
            if let Some(a) = owner.get(&c) {
                agent = Some(*a);
                break;
            }
            cur = procs.get(&c).and_then(|x| x.parent());
        }
        if let Some(a) = agent {
            let e = loads.entry(a).or_insert((0.0, 0));
            e.0 += p.cpu_usage() / cores as f32;
            e.1 += p.memory();
        }
    }
    let mut agents: Vec<AgentLoad> = loads
        .into_iter()
        .map(|(agent, (cpu, mem))| AgentLoad { agent: agent.into(), cpu_percent: cpu, memory_bytes: mem })
        .collect();
    agents.sort_by(|a, b| b.memory_bytes.cmp(&a.memory_bytes));

    let sensors: Vec<Sensor> = components
        .iter()
        .filter_map(|c| c.temperature().filter(|t| t.is_finite() && *t > 0.0 && *t < 150.0).map(|t| Sensor { label: c.label().to_string(), celsius: t }))
        .collect();
    let cpu_temp = sensors
        .iter()
        .filter(|s| is_cpu_sensor(&s.label))
        .map(|s| s.celsius)
        .fold(None, |m: Option<f32>, t| Some(m.map_or(t, |m| m.max(t))));

    // The disk holding the home folder (the system volume on macOS).
    let home = super::home();
    let disk = disks
        .iter()
        .filter(|d| home.starts_with(d.mount_point()))
        .max_by_key(|d| d.mount_point().as_os_str().len());
    let load = System::load_average();

    MachineStats {
        cpu_percent: sys.global_cpu_usage(),
        cpu_cores: cores,
        cpu_brand: sys.cpus().first().map(|c| c.brand().trim().to_string()).unwrap_or_default(),
        load_avg: [load.one, load.five, load.fifteen],
        memory_total: sys.total_memory(),
        memory_used: sys.used_memory(),
        swap_total: sys.total_swap(),
        swap_used: sys.used_swap(),
        disk_total: disk.map(|d| d.total_space()).unwrap_or(0),
        disk_available: disk.map(|d| d.available_space()).unwrap_or(0),
        cpu_temp,
        sensors,
        battery: battery(),
        uptime_secs: System::uptime(),
        agents,
    }
}
