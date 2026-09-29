// Types and helpers for the agent views. Mirrors src-tauri/src/agents.

export type AgentId = "claude" | "codex" | "opencode" | "cursor" | "antigravity";

export const AGENT_IDS: AgentId[] = ["claude", "codex", "opencode", "cursor", "antigravity"];

// Fixed categorical order, validated for the dark surface (CVD + contrast).
// Color follows the agent everywhere; never re-assign by rank.
export const AGENTS: Record<AgentId, { label: string; color: string; short: string }> = {
    claude: { label: "Claude Code", color: "#d95926", short: "CC" },
    codex: { label: "Codex", color: "#3987e5", short: "CX" },
    opencode: { label: "OpenCode", color: "#199e70", short: "OC" },
    cursor: { label: "Cursor", color: "#c98500", short: "CU" },
    antigravity: { label: "Antigravity", color: "#d55181", short: "AG" },
};

export const agentMeta = (id: string) => AGENTS[id as AgentId] ?? { label: id, color: "#71717a", short: "?" };

export interface TokenUsage {
    input: number;
    output: number;
    cache_read: number;
    cache_write: number;
    reasoning: number;
}

export interface AgentSession {
    agent: AgentId;
    id: string;
    title: string;
    project_path: string | null;
    started_at: number;
    updated_at: number;
    models: string[];
    tokens: TokenUsage;
    total_tokens: number;
    /** Recorded (OpenCode) or API-equivalent estimate (Claude, see cost_estimated). */
    cost_usd: number | null;
    cost_estimated: boolean;
    daily_cost: Record<string, number>;
    /** Claude Code config folder, e.g. ".claude-work". */
    instance: string | null;
    message_count: number;
    command_count: number;
    files_changed: number;
    risky_count: number;
    files_touched: string[];
    daily_tokens: Record<string, number>;
    source_path: string;
    size_bytes: number;
    partial: boolean;
}

export interface SessionEvent {
    ts: number;
    kind: "prompt" | "command" | "edit" | "write" | "tool" | "reply";
    text: string;
    detail: string | null;
    risk: string | null;
    notice: string | null;
    /** The fragment of `text` that triggered the flag. */
    matched: string | null;
}

/** Why each flag matters, shown next to it in the timeline. */
export const RISK_HELP: Record<string, string> = {
    "Recursive delete outside the project": "rm -rf aimed at an absolute path, your home folder or a wildcard.",
    "Recursive delete in a parent folder": "rm -rf on a path above the working folder. Usually fine in a monorepo; check it's the folder you expect.",
    "Force push": "Rewrites the remote branch. Commits others pushed can be lost.",
    "Hard reset": "Throws away uncommitted changes and moves the branch.",
    "git clean": "Permanently deletes untracked files.",
    "Discarded working changes": "Reverted uncommitted edits in the working tree.",
    "Piped download into shell": "Ran a script straight from the internet without saving or reviewing it.",
    "Ran with sudo": "Ran with administrator rights, outside the agent's normal sandbox.",
    "Global package install": "Installed a package for every project on this machine, not just this one.",
    "System-wide install": "Installed software for the whole machine.",
    "System Python install": "Changed the system Python, which other tools depend on.",
    "chmod 777": "Made files readable, writable and executable by everyone.",
    "Destructive SQL": "Dropped or truncated database tables.",
    "Destructive Docker command": "Removed containers, volumes or their data.",
    "Disk-level command": "Wrote directly to a disk or partition.",
    "Modified shell profile": "Changed what runs in every new terminal.",
    "Skipped git hooks": "Committed without running the project's pre-commit checks.",
    "Killed processes": "Stopped processes, possibly ones it didn't start.",
    "Started a background process": "Keeps running after the command returns: the usual source of leftovers.",
    "Edited an env file": "Env files usually hold secrets and local configuration.",
    "Touched credentials directory": "Read or changed files where SSH, cloud or GPG keys live.",
    "Modified shell or git config": "Changed global settings that affect every project.",
    "Edited outside the project": "Changed a file outside the folder the session was working in.",
};

export interface SessionDetail {
    session: AgentSession;
    events: SessionEvent[];
}

export interface AgentInfo {
    id: AgentId;
    name: string;
    installed: boolean;
    data_dir: string;
    support: "full" | "partial";
    note: string | null;
    /** History exists but couldn't be read (likely a format change). */
    warning: string | null;
}

export interface RunningAgent {
    agent: AgentId;
    pid: number;
    name: string;
    cwd: string | null;
    started_at: number;
    memory_bytes: number;
    child_count: number;
}

export interface AttributedItem {
    key: string;
    kind: "process" | "container";
    pid: number | null;
    container_id: string | null;
    name: string;
    command: string;
    cwd: string | null;
    ports: number[];
    memory_bytes: number;
    process_count: number;
    started_at: number;
    agent: AgentId;
    confidence: "direct" | "tracked" | "likely" | "ide";
    leftover: boolean;
    session_id: string | null;
    session_title: string | null;
    project_path: string | null;
}

export interface RuntimeReport {
    agents: RunningAgent[];
    items: AttributedItem[];
    leftover_count: number;
    leftover_memory_bytes: number;
    generated_at: number;
}

export interface MemoryItem {
    id: string;
    agents: AgentId[];
    scope: "global" | "project";
    kind: "memory" | "index" | "instructions" | "rules" | "knowledge";
    title: string;
    description: string | null;
    path: string | null;
    project_path: string | null;
    preview: string;
    size_bytes: number;
    modified_at: number;
    deletable: boolean;
    instance: string | null;
}

export interface DirtItem {
    id: string;
    agent: AgentId;
    label: string;
    description: string;
    size_bytes: number;
    file_count: number;
    caution: boolean;
    requires_closed: string | null;
    paths_preview: string[];
    path_count: number;
    instance: string | null;
}

/** One Claude Code config folder (CLAUDE_CONFIG_DIR). */
export interface ClaudeInstance {
    id: string;
    path: string;
    label: string;
    provider: "anthropic" | "bedrock" | "vertex" | "custom";
    plan: string | null;
    account_name: string | null;
    organization: string | null;
    is_default: boolean;
}

export interface LimitWindow {
    key: string;
    label: string;
    used_percent: number;
    resets_at: number | null;
}

export interface ProviderLimits {
    /** "claude:<instance>" or "codex" */
    id: string;
    agent: AgentId;
    label: string;
    plan: string | null;
    status: "ok" | "off" | "no_login" | "expired" | "unsupported" | "error";
    message: string | null;
    windows: LimitWindow[];
    extra: { enabled: boolean; used: number | null; limit: number | null; used_percent: number | null } | null;
    fetched_at: number;
}

export function fmtUsd(v: number): string {
    if (!v) return "$0";
    if (v < 0.01) return "<$0.01";
    if (v < 100) return `$${v.toFixed(2)}`;
    return `$${Math.round(v).toLocaleString()}`;
}

/** "2h 13m", "3d 4h" until a reset time. */
export function fmtUntil(ms: number | null): string {
    if (!ms) return "";
    const s = Math.max(0, (ms - Date.now()) / 1000);
    if (s < 60) return "now";
    const m = Math.floor(s / 60), h = Math.floor(m / 60), d = Math.floor(h / 24);
    if (d > 0) return `${d}d ${h % 24}h`;
    if (h > 0) return `${h}h ${m % 60}m`;
    return `${m}m`;
}

/** Spend since a local day (inclusive), from per-day cost. */
export function costSince(sessions: AgentSession[], sinceDayKey: string, untilDayKey?: string): number {
    let c = 0;
    for (const s of sessions) {
        for (const [day, v] of Object.entries(s.daily_cost || {})) {
            if (day >= sinceDayKey && (!untilDayKey || day <= untilDayKey)) c += v;
        }
    }
    return c;
}

export interface CleanResult {
    freed_bytes: number;
    deleted_paths: number;
    skipped: string[];
}

export interface MachineStats {
    cpu_percent: number;
    cpu_cores: number;
    cpu_brand: string;
    load_avg: [number, number, number];
    memory_total: number;
    memory_used: number;
    swap_total: number;
    swap_used: number;
    disk_total: number;
    disk_available: number;
    cpu_temp: number | null;
    sensors: { label: string; celsius: number }[];
    battery: { percent: number; charging: boolean; time_left: string | null } | null;
    uptime_secs: number;
    /** CPU is a share of the whole machine (0–100). */
    agents: { agent: AgentId; cpu_percent: number; memory_bytes: number }[];
}

export const CONFIDENCE_LABEL: Record<AttributedItem["confidence"], string> = {
    direct: "Running under the agent",
    tracked: "Seen under the agent",
    likely: "Started during a session here",
    ide: "Started from the editor",
};

// ── Formatting ────────────────────────────────────────────────────────────────

export function fmtTokens(n: number): string {
    if (!n) return "0";
    if (n >= 1e9) return `${(n / 1e9).toFixed(n >= 1e10 ? 0 : 1)}B`;
    if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M`;
    if (n >= 1e3) return `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)}K`;
    return String(n);
}

export function fmtBytes(bytes: number): string {
    if (!bytes || bytes <= 0) return "0 B";
    const units = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
    return `${parseFloat((bytes / 1024 ** i).toFixed(i >= 3 ? 1 : 0))} ${units[i]}`;
}

export function timeAgo(ms: number): string {
    if (!ms) return "—";
    const s = Math.max(0, (Date.now() - ms) / 1000);
    if (s < 60) return "just now";
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`;
    return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function fmtDuration(ms: number): string {
    const m = Math.round(ms / 60000);
    if (m < 1) return "<1m";
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60);
    return h < 24 ? `${h}h ${m % 60}m` : `${Math.floor(h / 24)}d ${h % 24}h`;
}

export function projectName(path: string | null | undefined): string {
    if (!path) return "No project";
    const parts = path.split(/[\\/]/).filter(Boolean);
    return parts[parts.length - 1] || path;
}

export function shortPath(path: string | null | undefined): string {
    if (!path) return "";
    return path.replace(/^\/Users\/[^/]+/, "~").replace(/^\/home\/[^/]+/, "~");
}

export function localDayKey(d: Date): string {
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Tokens per agent for the last `days` days, keyed by YYYY-MM-DD. */
export function dailyByAgent(sessions: AgentSession[], days: number) {
    const keys: string[] = [];
    const today = new Date();
    for (let i = days - 1; i >= 0; i--) {
        const d = new Date(today);
        d.setDate(today.getDate() - i);
        keys.push(localDayKey(d));
    }
    const rows = keys.map(day => ({ day, total: 0, by: {} as Partial<Record<AgentId, number>> }));
    const index = new Map(keys.map((k, i) => [k, i]));
    for (const s of sessions) {
        for (const [day, n] of Object.entries(s.daily_tokens || {})) {
            const i = index.get(day);
            if (i === undefined) continue;
            rows[i].by[s.agent] = (rows[i].by[s.agent] || 0) + n;
            rows[i].total += n;
        }
    }
    return rows;
}

export function tokensSince(sessions: AgentSession[], sinceDayKey: string): number {
    let t = 0;
    for (const s of sessions) {
        for (const [day, n] of Object.entries(s.daily_tokens || {})) {
            if (day >= sinceDayKey) t += n;
        }
    }
    return t;
}
