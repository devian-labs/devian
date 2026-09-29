import { FolderGit2, Server, Sparkles, Settings, ExternalLink, Bell, MessageSquarePlus, LayoutDashboard, History, Brain, BarChart3, Search, ChevronLeft, ChevronRight } from "lucide-react";
import devianLogo from "../../src-tauri/icons/32x32.png";
import { openUrl } from "@tauri-apps/plugin-opener";
import { getVersion } from "@tauri-apps/api/app";
import { useEffect, useState, type ReactNode } from "react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { usePref } from "@/lib/prefs";
import { openFeedback } from "@/lib/diagnostics";

export type TabId = "overview" | "sessions" | "runtime" | "memory" | "usage" | "cleanup" | "projects" | "settings";

/** Sidebar order; also drives ⌘1…⌘7. */
export const NAV_ORDER: Exclude<TabId, "settings">[] = ["overview", "sessions", "runtime", "memory", "usage", "cleanup", "projects"];

const NAV: Record<Exclude<TabId, "settings">, { label: string; icon: typeof Server }> = {
    overview: { label: "Overview", icon: LayoutDashboard },
    sessions: { label: "Sessions", icon: History },
    runtime: { label: "Runtime", icon: Server },
    memory: { label: "Memory", icon: Brain },
    usage: { label: "Usage", icon: BarChart3 },
    cleanup: { label: "Cleanup", icon: Sparkles },
    projects: { label: "Projects", icon: FolderGit2 },
};

// Visual grouping only: what agents did, what they keep, your workspace.
const GROUPS: { label?: string; items: Exclude<TabId, "settings">[] }[] = [
    { items: ["overview"] },
    { label: "Activity", items: ["sessions", "runtime"] },
    { label: "Agents keep", items: ["memory", "usage", "cleanup"] },
    { label: "Workspace", items: ["projects"] },
];

const isMac = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform);
const MOD = isMac ? "⌘" : "Ctrl+";

interface SidebarProps {
    activeTab: TabId;
    setActiveTab: (tab: TabId) => void;
    onBellClick: () => void;
    notifUnreadCount: number;
    /** Attention counts shown next to a tab (e.g. leftovers on Runtime). */
    badges?: Partial<Record<TabId, number>>;
    onSearchClick?: () => void;
}

export function Sidebar({ activeTab, setActiveTab, onBellClick, notifUnreadCount, badges = {}, onSearchClick }: SidebarProps) {
    const [appVersion, setAppVersion] = useState<string>("...");
    const [collapsed, setCollapsed] = usePref<boolean>("devian_sidebar_collapsed", false);

    useEffect(() => {
        getVersion().then(setAppVersion).catch(console.error);
    }, []);

    // ⌘B / Ctrl+B toggles the sidebar, as in most editors.
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "b") {
                e.preventDefault();
                setCollapsed(c => !c);
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [setCollapsed]);

    /** Collapsed items get an instant tooltip with the label and shortcut. */
    const withTip = (key: string, label: string, shortcut: string | undefined, node: ReactNode) =>
        collapsed ? (
            <Tooltip key={key}>
                <TooltipTrigger asChild>{node}</TooltipTrigger>
                <TooltipContent side="right" sideOffset={8} className="flex items-center gap-2">
                    {label}
                    {shortcut && <span className="text-[10px] opacity-60">{shortcut}</span>}
                </TooltipContent>
            </Tooltip>
        ) : (
            <div key={key}>{node}</div>
        );

    const item = (id: TabId, label: string, Icon: typeof Server, shortcut: string) => {
        const isActive = activeTab === id;
        const badge = badges[id];
        return withTip(
            id,
            badge ? `${label} · ${badge}` : label,
            shortcut,
            <button
                onClick={() => setActiveTab(id)}
                title={collapsed ? undefined : `${label} (${shortcut})`}
                aria-label={label}
                aria-current={isActive ? "page" : undefined}
                className={`group relative w-full flex items-center rounded-lg text-sm font-medium transition-colors ${collapsed ? "justify-center h-9" : "gap-3 px-3 py-2"} ${isActive
                    ? "bg-primary/15 text-primary"
                    : "text-zinc-400 hover:bg-white/5 hover:text-white"
                }`}
            >
                <Icon className="w-4 h-4 shrink-0" />
                {collapsed ? (
                    badge ? <span className="absolute top-1.5 right-2 h-2 w-2 rounded-full bg-amber-400 ring-2 ring-surface-a0" /> : null
                ) : (
                    <>
                        <span className="truncate">{label}</span>
                        {badge ? (
                            <span className="ml-auto min-w-5 h-5 px-1.5 rounded-full bg-amber-500/15 text-amber-300 text-[11px] font-semibold flex items-center justify-center">
                                {badge}
                            </span>
                        ) : (
                            <span className="ml-auto text-[10px] text-zinc-700 opacity-0 group-hover:opacity-100 transition-opacity">{shortcut}</span>
                        )}
                    </>
                )}
            </button>,
        );
    };

    // Handle on the sidebar's right border: half over the sidebar, half over the page.
    const edgeToggle = (
        <button
            onClick={() => setCollapsed(c => !c)}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-expanded={!collapsed}
            className="absolute top-8 -right-3 z-20 flex h-6 w-6 items-center justify-center rounded-full border border-white/10 bg-surface-a0 text-zinc-500 shadow-md transition-colors hover:border-white/25 hover:bg-zinc-800 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
            {collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronLeft className="h-3.5 w-3.5" />}
        </button>
    );

    const bell = (
        <button
            onClick={onBellClick}
            className="relative flex items-center justify-center h-9 w-9 shrink-0 rounded-lg text-zinc-500 hover:bg-white/5 hover:text-white transition-colors"
            title={collapsed ? undefined : "Notifications"}
            aria-label={`Notifications${notifUnreadCount ? `, ${notifUnreadCount} unread` : ""}`}
        >
            <Bell className="h-4 w-4" />
            {notifUnreadCount > 0 && (
                <span className="absolute top-0.5 right-0.5 h-4 min-w-4 px-1 rounded-full bg-amber-500 text-[10px] font-bold text-black flex items-center justify-center leading-none">
                    {notifUnreadCount > 9 ? "9+" : notifUnreadCount}
                </span>
            )}
        </button>
    );

    const feedback = (
        <button
            onClick={() => openFeedback()}
            className="flex items-center justify-center h-9 w-9 shrink-0 rounded-lg text-zinc-500 hover:bg-white/5 hover:text-white transition-colors"
            title={collapsed ? undefined : "Send feedback"}
            aria-label="Send feedback"
        >
            <MessageSquarePlus className="h-4 w-4" />
        </button>
    );

    return (
        <TooltipProvider delayDuration={0} skipDelayDuration={0}>
          {/* z-30: the handle overhangs the page, which sits at z-10. */}
          <div className="relative shrink-0 z-30 h-screen">
            <Tooltip>
                <TooltipTrigger asChild>{edgeToggle}</TooltipTrigger>
                <TooltipContent side="right" sideOffset={6} className="flex items-center gap-2">
                    {collapsed ? "Expand sidebar" : "Collapse sidebar"}
                    <span className="text-[10px] opacity-60">{MOD}B</span>
                </TooltipContent>
            </Tooltip>
            <aside
                className={`${collapsed ? "w-[60px]" : "w-56"} shrink-0 bg-surface-a0 border-r border-white/5 h-screen flex flex-col pt-6 pb-5 z-10 transition-[width] duration-200 ease-out overflow-hidden`}
            >
                {collapsed ? (
                    <div className="flex justify-center mb-5">
                        <img src={devianLogo} alt="Devian" className="h-7 w-7 mt-0.5 object-contain" />
                    </div>
                ) : (
                    <div className="px-5 mb-5 flex items-center gap-3">
                        <img src={devianLogo} alt="" className="h-8 w-8 object-contain shrink-0" />
                        <h2 className="min-w-0 flex-1 text-lg font-bold tracking-tight text-white leading-none">Devian</h2>
                    </div>
                )}

                {onSearchClick && (
                    <div className={`${collapsed ? "px-2.5" : "px-3"} mb-4`}>
                        {withTip(
                            "search",
                            "Search",
                            `${MOD}K`,
                            <button
                                onClick={onSearchClick}
                                aria-label="Search"
                                className={`w-full flex items-center h-8 rounded-lg border border-white/5 bg-white/[0.02] text-xs text-zinc-500 hover:text-zinc-300 hover:border-white/10 transition-colors ${collapsed ? "justify-center" : "gap-2 px-2.5"}`}
                            >
                                <Search className="h-3.5 w-3.5 shrink-0" />
                                {!collapsed && (
                                    <>
                                        Search
                                        <kbd className="ml-auto text-[10px] font-sans text-zinc-600">{MOD}K</kbd>
                                    </>
                                )}
                            </button>,
                        )}
                    </div>
                )}

                <nav className={`flex-1 ${collapsed ? "px-2.5 space-y-2" : "px-3 space-y-4"} overflow-y-auto overflow-x-hidden`}>
                    {GROUPS.map((g, gi) => (
                        <div key={gi} className="space-y-0.5">
                            {g.label && (collapsed
                                ? <div className="mx-2 mb-2 h-px bg-white/5" aria-hidden />
                                : <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-600 whitespace-nowrap">{g.label}</p>)}
                            {g.items.map(id => item(id, NAV[id].label, NAV[id].icon, `${MOD}${NAV_ORDER.indexOf(id) + 1}`))}
                        </div>
                    ))}
                </nav>

                <div className={`${collapsed ? "px-2.5" : "px-3"} mt-auto space-y-0.5`}>
                    {collapsed ? (
                        <div className="flex flex-col items-center gap-1">
                            <div className="w-full">{item("settings", "Settings", Settings, `${MOD},`)}</div>
                            {withTip("bell", notifUnreadCount ? `Notifications · ${notifUnreadCount}` : "Notifications", undefined, bell)}
                            {withTip("feedback", "Send feedback", undefined, feedback)}
                        </div>
                    ) : (
                        <>
                            <div className="flex items-center gap-1">
                                <div className="flex-1">{item("settings", "Settings", Settings, `${MOD},`)}</div>
                                {feedback}
                                {bell}
                            </div>
                            <div className="flex items-center justify-between px-3 pt-2">
                                <button
                                    onClick={async () => { try { await openUrl("https://devian.app"); } catch { /* no browser */ } }}
                                    className="flex items-center gap-1.5 text-[11px] font-medium text-zinc-600 hover:text-zinc-400 transition-colors whitespace-nowrap"
                                >
                                    <ExternalLink className="w-3 h-3" /> devian.app
                                </button>
                                <span className="text-[11px] text-zinc-700 font-medium">v{appVersion}</span>
                            </div>
                        </>
                    )}
                </div>
            </aside>
          </div>
        </TooltipProvider>
    );
}
