import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useToast } from "@/hooks/use-toast";
import { AppNotification, NotificationCenter } from "@/components/NotificationCenter";

import { Sidebar, TabId, NAV_ORDER } from "@/components/Sidebar";
import { ProjectsTab } from "./tabs/ProjectsTab";
import { SettingsModal, initialTab } from "./tabs/SettingsTab";
import { OverviewTab } from "./tabs/agents/OverviewTab";
import { SessionsTab } from "./tabs/agents/SessionsTab";
import { RuntimeTab } from "./tabs/agents/RuntimeTab";
import { MemoryTab } from "./tabs/agents/MemoryTab";
import { UsageTab } from "./tabs/agents/UsageTab";
import { CleanupScreen } from "./tabs/agents/AgentCleanupTab";
import { CommandPalette } from "@/components/CommandPalette";
import { MachineBar } from "@/components/MachineBar";
import { AgentInfo, AgentSession, ClaudeInstance, ProviderLimits, RuntimeReport, agentMeta } from "@/lib/agents";
import { InstancesProvider, isHiddenInstance } from "@/lib/instances";
import { LimitsBar } from "@/components/LimitsBar";
import { PREF, readPref, usePref, writePref } from "@/lib/prefs";
import { REFRESH_MS, RefreshRate, SETTING } from "@/lib/settings";
import { track } from "@/lib/telemetry";
import { ErrorBoundary } from "@/components/ErrorBoundary";

export type DockerContainer = {
    ID: string;
    Names: string;
    Status: string;
    Ports: string;
    State: string;
    Size: string;
    Image: string;
    Command: string;
    ComposeProject: string;
    ComposeService: string;
    ComposeWorkingDir: string;
    ComposeConfigFiles: string;
    PortMappings: string[];
    ProjectPath: string;
    ProjectName: string;
};
export type SystemProcess = { pid: string; cpu: string; mem: string; rss: string; state: string; time: string; user: string; name: string };
export type ActivePort = { name: string; pid: string; user: string; port: string; full_address: string };
export type DepFolder = { name: string; relative_path: string; size_bytes: number };
export type LocalProject = {
    name: string; path: string; stack: string[]; status: string;
    dependency_folders: DepFolder[]; total_dep_size_bytes: number;
    project_size_bytes: number; last_commit: string; last_commit_timestamp: number;
};

export default function Dashboard() {
    const [activeTab, setActiveTabState] = useState<TabId>(() =>
        initialTab(readPref<string>(PREF.activeTab, "overview"), t => (NAV_ORDER as string[]).includes(t)) as TabId
    );
    const [refresh] = usePref<RefreshRate>(SETTING.refresh, "balanced");
    const rates = REFRESH_MS[refresh] ?? REFRESH_MS.balanced;
    // Settings is a modal over the current page, not a page of its own.
    const [settingsOpen, setSettingsOpen] = useState(false);
    const setActiveTab = useCallback((tab: TabId) => {
        if (tab === "settings") {
            setSettingsOpen(true);
            return;
        }
        setSettingsOpen(false);
        setActiveTabState(tab);
        writePref(PREF.activeTab, tab);
        const visited = readPref<string[]>(PREF.visited, []);
        if (!visited.includes(tab)) writePref(PREF.visited, [...visited, tab]);
    }, []);
    const { toast } = useToast();

    useEffect(() => {
        track('tab_viewed', { tab: activeTab });
    }, [activeTab]);

    const [dockerContainers, setDockerContainers] = useState<DockerContainer[]>([]);
    const [systemProcesses, setSystemProcesses] = useState<SystemProcess[]>([]);
    const [activePorts, setActivePorts] = useState<ActivePort[]>([]);
    const [showPalette, setShowPalette] = useState(false);
    const [paletteAction, setPaletteAction] = useState<{ path: string; openEnv: boolean } | null>(null);

    // Agent state
    const [agents, setAgents] = useState<AgentInfo[]>([]);
    const [sessions, setSessions] = useState<AgentSession[]>([]);
    // Claude Code config folders, and which ones the user excluded.
    const [instances, setInstances] = useState<ClaudeInstance[]>([]);
    const [hiddenInstances] = usePref<string[]>(PREF.hiddenInstances, []);
    const visibleSessions = useMemo(
        () => sessions.filter(s => !(s.agent === "claude" && isHiddenInstance(hiddenInstances, s.instance))),
        [sessions, hiddenInstances],
    );
    // Plan limits, only for accounts the user turned on.
    const [limitsEnabled] = usePref<string[]>(PREF.limitsEnabled, []);
    const [limits, setLimits] = useState<ProviderLimits[] | null>(null);
    const loadLimits = useCallback((force = false) => {
        return invoke<ProviderLimits[]>("agents_limits", { enabled: readPref<string[]>(PREF.limitsEnabled, []), force })
            .then(setLimits)
            .catch(e => console.error("Failed to load limits:", e));
    }, []);
    useEffect(() => {
        invoke<ClaudeInstance[]>("agents_claude_instances").then(setInstances).catch(() => setInstances([]));
    }, []);
    useEffect(() => {
        loadLimits();
        const id = setInterval(() => loadLimits(), 5 * 60 * 1000);
        return () => clearInterval(id);
    }, [loadLimits, limitsEnabled]);
    const [sessionsLoading, setSessionsLoading] = useState(true);
    const [runtime, setRuntime] = useState<RuntimeReport | null>(null);
    const [sessionFocus, setSessionFocus] = useState<string | null>(null);
    const [sessionPreset, setSessionPreset] = useState<"flagged" | null>(null);
    const runtimeInflight = useRef(false);
    const seenLeftovers = useRef<Set<string> | null>(null);

    // Notifications
    const [notifications, setNotifications] = useState<AppNotification[]>([]);
    const [notifOpen, setNotifOpen] = useState(false);
    const prevContainersRef = useRef<DockerContainer[]>([]);
    const notifIdxRef = useRef(0);
    // Cooldown: track last notification timestamp per container ID (2-minute dedup)
    const notifCooldownRef = useRef<Map<string, number>>(new Map());
    const NOTIF_COOLDOWN_MS = 2 * 60 * 1000;

    // Heuristic: skip ephemeral containers (long hex IDs in name = CI runners, k8s pods, etc.)
    const isEphemeralContainer = (name: string) => /[0-9a-f]{12,}/i.test(name);

    const addNotification = useCallback((n: Omit<AppNotification, "id" | "timestamp" | "read">) => {
        setNotifications(prev => {
            const id = `notif-${++notifIdxRef.current}`;
            return [{ ...n, id, timestamp: Date.now(), read: false }, ...prev].slice(0, 20);
        });
        // OS notification (best-effort)
        invoke("show_notification", { title: n.title, body: n.message }).catch(() => {});
    }, []);

    const [userTerminal, setUserTerminal] = useState("Native Terminal");
    const [userEditor, setUserEditor] = useState("VS Code");

    useEffect(() => {
        async function fetchData() {
            try {
                const [docker, processes, ports] = await Promise.all([
                    invoke<DockerContainer[]>("fetch_docker_containers").catch(() => []),
                    invoke<SystemProcess[]>("fetch_system_processes").catch(() => []),
                    invoke<ActivePort[]>("fetch_active_ports").catch(() => []),
                ]);
                // Detect service state changes (running → stopped)
                // Guards: skip first poll, skip ephemeral containers, enforce per-container cooldown
                if (prevContainersRef.current.length > 0) {
                    const now = Date.now();
                    for (const prev of prevContainersRef.current) {
                        if (prev.State !== "running") continue;
                        const curr = docker.find(c => c.ID === prev.ID);
                        if (!curr || curr.State === "running") continue;

                        const rawName = prev.ComposeService || prev.Names?.replace(/^\//, "") || prev.ID.slice(0, 8);
                        // Skip ephemeral runner/pod containers with long hex IDs
                        if (isEphemeralContainer(rawName)) continue;
                        // Skip if notified recently for this container
                        const lastNotified = notifCooldownRef.current.get(prev.ID) ?? 0;
                        if (now - lastNotified < NOTIF_COOLDOWN_MS) continue;

                        notifCooldownRef.current.set(prev.ID, now);
                        addNotification({
                            type: "service_down",
                            title: "Service stopped",
                            message: `${rawName} stopped unexpectedly.`,
                            action: { label: "View runtime", tab: "runtime" },
                        });
                    }
                }
                prevContainersRef.current = docker;

                setDockerContainers(docker);
                setSystemProcesses(processes);
                setActivePorts(ports);
            } catch (error) {
                console.error("Failed to fetch system data:", error);
            }
        }

        fetchData();
        const interval = setInterval(fetchData, rates.services);
        return () => clearInterval(interval);
    }, [rates.services]);

    // Cmd+K global search
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "k") {
                e.preventDefault();
                setShowPalette(prev => !prev);
            }
            if (e.key === "Escape") setShowPalette(false);
            // ⌘1…⌘7 jump between sections, ⌘, opens settings.
            if ((e.metaKey || e.ctrlKey) && /^[1-9]$/.test(e.key)) {
                const tab = NAV_ORDER[Number(e.key) - 1];
                if (tab) { e.preventDefault(); setActiveTab(tab); }
            }
            if ((e.metaKey || e.ctrlKey) && e.key === ",") {
                e.preventDefault();
                setActiveTab("settings");
            }
        };
        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    }, [setActiveTab]);

    useEffect(() => {
        async function loadSettings() {
            try {
                const settings = await invoke<{ terminal: string; editor: string }>("get_user_settings");
                if (settings.terminal) setUserTerminal(settings.terminal);
                if (settings.editor) setUserEditor(settings.editor);
            } catch (e) {
                console.error("Failed to load settings:", e);
            }
        }
        loadSettings();
    }, []);

    // Risky-action counts per session, to notify when new ones appear.
    const seenRisky = useRef<Map<string, number> | null>(null);
    const loadSessions = useCallback(() => {
        invoke<AgentSession[]>("agents_list_sessions")
            .then(list => {
                setSessions(list);
                const counts = new Map(list.filter(s => s.risky_count > 0).map(s => [`${s.agent}:${s.id}`, s.risky_count] as const));
                if (seenRisky.current && readPref<boolean>(SETTING.notifyRisky, true)) {
                    for (const s of list) {
                        const before = seenRisky.current.get(`${s.agent}:${s.id}`) ?? 0;
                        if (s.risky_count > before) {
                            const n = s.risky_count - before;
                            addNotification({
                                type: "vulnerability",
                                title: `${agentMeta(s.agent).label} did ${n} risky thing${n === 1 ? "" : "s"}`,
                                message: `"${s.title}"`,
                                action: { label: "Review", tab: "sessions" },
                            });
                        }
                    }
                }
                seenRisky.current = counts;
            })
            .catch(e => console.error("Failed to read agent sessions:", e))
            .finally(() => setSessionsLoading(false));
    }, [addNotification]);

    const loadRuntime = useCallback(() => {
        if (runtimeInflight.current) return;
        runtimeInflight.current = true;
        invoke<RuntimeReport>("agents_runtime")
            .then(rep => {
                setRuntime(rep);
                // Notify once per newly left-behind item; the first scan just seeds the set.
                const left = rep.items.filter(i => i.leftover);
                if (seenLeftovers.current && readPref<boolean>(PREF.notifyLeftovers, true)) {
                    const fresh = left.filter(i => !seenLeftovers.current!.has(i.key));
                    const byAgent = new Map<string, typeof fresh>();
                    for (const i of fresh) byAgent.set(i.agent, [...(byAgent.get(i.agent) ?? []), i]);
                    for (const [agent, items] of byAgent) {
                        addNotification({
                            type: "service_down",
                            title: `${agentMeta(agent).label} left ${items.length} thing${items.length === 1 ? "" : "s"} running`,
                            message: items.slice(0, 3).map(i => `${i.name}${i.ports.length ? ` :${i.ports[0]}` : ""}`).join(", "),
                            action: { label: "Review", tab: "runtime" },
                        });
                    }
                }
                seenLeftovers.current = new Set(left.map(i => i.key));
            })
            .catch(e => console.error("Failed to scan agent runtime:", e))
            .finally(() => { runtimeInflight.current = false; });
    }, [addNotification]);

    useEffect(() => {
        invoke<AgentInfo[]>("agents_detect").then(setAgents).catch(() => setAgents([]));
        loadSessions();
        loadRuntime();
        const s = setInterval(loadSessions, rates.sessions);
        const r = setInterval(loadRuntime, rates.runtime);
        return () => { clearInterval(s); clearInterval(r); };
    }, [loadSessions, loadRuntime, rates.sessions, rates.runtime]);

    const openSession = useCallback((s: Pick<AgentSession, "agent" | "id">) => {
        setSessionFocus(`${s.agent}:${s.id}`);
        setActiveTab("sessions");
    }, [setActiveTab]);

    const openFlagged = useCallback(() => {
        setSessionPreset("flagged");
        setActiveTab("sessions");
    }, [setActiveTab]);

    const handleKillProcess = async (pid: string, name: string) => {
        try {
            await invoke("kill_process", { pid });
            track('process_killed', { success: true });
            toast({ title: "Process Stopped", description: `Terminated ${name} (PID ${pid})` });
            const ports = await invoke<ActivePort[]>("fetch_active_ports").catch(() => []);
            setActivePorts(ports);
        } catch (error) {
            track('process_killed', { success: false });
            toast({ variant: "destructive", title: "Failed to Stop", description: String(error) });
        }
    };

    const renderActiveTab = () => {
        switch (activeTab) {
            case "overview":
                return (
                    <OverviewTab
                        sessions={visibleSessions}
                        sessionsLoading={sessionsLoading}
                        runtime={runtime}
                        agents={agents}
                        setActiveTab={setActiveTab}
                        openSession={openSession}
                        openFlagged={openFlagged}
                        onRuntimeChanged={loadRuntime}
                    />
                );
            case "sessions":
                return (
                    <SessionsTab
                        sessions={visibleSessions}
                        loading={sessionsLoading}
                        focus={sessionFocus}
                        onFocusConsumed={() => setSessionFocus(null)}
                        preset={sessionPreset}
                        onPresetConsumed={() => setSessionPreset(null)}
                        editor={userEditor}
                    />
                );
            case "runtime":
                return (
                    <RuntimeTab
                        runtime={runtime}
                        onRefresh={loadRuntime}
                        containers={dockerContainers}
                        ports={activePorts}
                        processes={systemProcesses}
                        onKillProcess={handleKillProcess}
                        openSessionById={(agent, id) => openSession({ agent: agent as AgentSession["agent"], id })}
                    />
                );
            case "memory":
                return <MemoryTab editor={userEditor} />;
            case "usage":
                return <UsageTab sessions={visibleSessions} loading={sessionsLoading} limits={limits} onRefreshLimits={() => loadLimits(true)} openSettings={() => { writePref("devian_settings_section", "accounts"); setActiveTab("settings"); }} />;
            case "cleanup":
                return <CleanupScreen runtime={runtime} />;
            case "projects":
                return (
                    <ProjectsTab
                        terminal={userTerminal}
                        editor={userEditor}
                        paletteAction={paletteAction}
                        onPaletteActionConsumed={() => setPaletteAction(null)}
                    />
                );
            default:
                return null;
        }
    };

    const notifUnreadCount = notifications.filter(n => !n.read).length;

    return (
        <InstancesProvider instances={instances} hidden={hiddenInstances}>
        <div className="flex h-screen bg-background overflow-hidden text-foreground">
            <SettingsModal
                open={settingsOpen}
                onOpenChange={setSettingsOpen}
                terminal={userTerminal}
                editor={userEditor}
                setActiveTab={setActiveTab}
                onSettingsChange={(t, e) => {
                    setUserTerminal(t);
                    setUserEditor(e);
                }}
            />
            <Sidebar
                activeTab={settingsOpen ? "settings" : activeTab}
                setActiveTab={setActiveTab}
                onBellClick={() => {
                    setNotifOpen(prev => !prev);
                    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
                }}
                notifUnreadCount={notifUnreadCount}
                badges={{ runtime: runtime?.leftover_count ?? 0 }}
                onSearchClick={() => setShowPalette(true)}
            />
            <main className="flex-1 flex flex-col overflow-hidden relative">
                <MachineBar
                    runtime={runtime}
                    onOpenRuntime={() => setActiveTab("runtime")}
                    onAlert={(title, message) => addNotification({ type: "info", title, message })}
                    limitsSlot={
                        <LimitsBar
                            limits={limits}
                            sessions={visibleSessions}
                            onRefresh={() => loadLimits(true)}
                            onOpenUsage={() => setActiveTab("usage")}
                            onSetup={() => { writePref("devian_settings_section", "accounts"); setActiveTab("settings"); }}
                        />
                    }
                />
                <div className="w-full bg-background relative z-10 flex-1 flex flex-col overflow-hidden">
                    <ErrorBoundary key={activeTab} where={`tab:${activeTab}`}>
                        {renderActiveTab()}
                    </ErrorBoundary>
                </div>
            </main>
            {/* Notification panel — rendered at root level to avoid stacking context issues */}
            {notifOpen && (
                <NotificationCenter
                    notifications={notifications}
                    open={notifOpen}
                    onOpen={() => {}}
                    onClose={() => setNotifOpen(false)}
                    onDismiss={(id) => setNotifications(prev => prev.filter(n => n.id !== id))}
                    onClearAll={() => setNotifications([])}
                    onNavigate={(tab) => { setActiveTab(tab); setNotifOpen(false); }}
                />
            )}
            {showPalette && (
                <CommandPalette
                    containers={dockerContainers}
                    ports={activePorts}
                    sessions={visibleSessions}
                    onNavigate={(tab, payload) => {
                        if (payload?.sessionKey) setSessionFocus(payload.sessionKey);
                        if (payload?.projectPath) {
                            setPaletteAction({ path: payload.projectPath, openEnv: !!payload.openEnv });
                        }
                        setActiveTab(tab);
                        setShowPalette(false);
                    }}
                    onClose={() => setShowPalette(false)}
                />
            )}
        </div>
        </InstancesProvider>
    );
}
