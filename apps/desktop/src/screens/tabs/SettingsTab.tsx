import { useEffect, useMemo, useState, type ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { homeDir } from "@tauri-apps/api/path";
import { openUrl } from "@tauri-apps/plugin-opener";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { disable as disableAutostart, enable as enableAutostart, isEnabled as autostartEnabled } from "@tauri-apps/plugin-autostart";
import {
    Accessibility, AppWindow, Bell, BellRing, Bot, Cable, CheckCircle2, Download, ExternalLink, FolderOpen, Info, Keyboard, Loader2, RefreshCw, RotateCcw,
    Gauge, Search, Settings2, ShieldCheck, SlidersHorizontal, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Segmented } from "@/components/agents/AgentBits";
import { hasTelemetryConsent, setTelemetryConsent, telemetryConfigured, track } from "@/lib/telemetry";
import { openFeedback } from "@/lib/diagnostics";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { TabId } from "@/components/Sidebar";
import { AIControlsPanel } from "./components/AIControlsPanel";
import { McpSetup, useMcpStatus } from "./agents/McpSetup";
import { PREF, readPref, usePref, writePref } from "@/lib/prefs";
import { MotionPref, RefreshRate, SETTING, TextSize, TimeFormat, fmtTime } from "@/lib/settings";
import { AgentDot } from "@/components/agents/AgentBits";
import { useInstances } from "@/lib/instances";
import type { ProviderLimits } from "@/lib/agents";

const REPO = "https://github.com/devian-labs/devian";
export const SETTINGS_SECTION_PREF = "devian_settings_section";
/** "overview" or "last": which page Devian opens on. */
export const OPEN_ON_PREF = "devian_open_on";

const TERMINAL_OPTIONS = [
    { value: "Native Terminal", label: "Native Terminal" },
    { value: "iTerm", label: "iTerm2" },
    { value: "Warp", label: "Warp" },
];

const EDITOR_OPTIONS = [
    { value: "VS Code", label: "VS Code" },
    { value: "Cursor", label: "Cursor" },
    { value: "Antigravity", label: "Antigravity" },
    { value: "IntelliJ", label: "IntelliJ IDEA" },
    { value: "Sublime Text", label: "Sublime Text" },
];

export type SettingsSection = "general" | "appearance" | "accounts" | "agents" | "notifications" | "apps" | "privacy" | "model" | "keyboard" | "about";

const isMac = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform);
const MOD = isMac ? "⌘" : "Ctrl+";

const SECTIONS: { id: SettingsSection; label: string; icon: typeof Bot; description: string; keywords: string }[] = [
    { id: "general", label: "General", icon: SlidersHorizontal, description: "Updates, startup, time format and how often Devian refreshes.", keywords: "version update start launch login autostart setup checklist welcome time clock 12 24 hour refresh polling battery performance" },
    { id: "appearance", label: "Appearance & accessibility", icon: Accessibility, description: "Text size, motion, contrast and keyboard focus.", keywords: "accessibility text size zoom font scale motion animation reduce contrast focus outline keyboard sidebar collapse" },
    { id: "accounts", label: "Accounts & limits", icon: Gauge, description: "Which Claude Code setups Devian includes, and live plan limits for each account.", keywords: "account instance claude config folder work bedrock team pro limits usage quota reset spend codex menu bar include exclude" },
    { id: "agents", label: "Connect agents", icon: Cable, description: "Let agents ask Devian what's running before they start servers or pick ports.", keywords: "mcp connect claude codex cursor opencode antigravity server tools" },
    { id: "notifications", label: "Notifications", icon: Bell, description: "System notifications for things that need you.", keywords: "alert leftover notify risky temperature hot disk full test" },
    { id: "apps", label: "Default apps", icon: AppWindow, description: "Where whole projects open. Memory files are edited inside Devian.", keywords: "editor terminal vscode cursor iterm warp" },
    { id: "privacy", label: "Privacy & data", icon: ShieldCheck, description: "What Devian can read, what it shares, and where it keeps its own data.", keywords: "full disk access permission telemetry usage analytics data folder" },
    { id: "model", label: "Local model", icon: Bot, description: "Optional. A small on-device model for offline project summaries.", keywords: "ai llm model qwen summary offline" },
    { id: "keyboard", label: "Keyboard", icon: Keyboard, description: "Shortcuts that work everywhere in Devian.", keywords: "shortcut hotkey keys" },
    { id: "about", label: "About", icon: Info, description: "Version, source code and where to get help.", keywords: "github license changelog issue help" },
];

// ── Layout pieces (flat rows under small uppercase group labels) ────────────

function Group({ label, children }: { label?: string; children: ReactNode }) {
    return (
        <section className="mb-7 last:mb-0">
            {label && <div className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500 pb-2 border-b border-white/[0.06]">{label}</div>}
            <div className="divide-y divide-white/[0.06]">{children}</div>
        </section>
    );
}

function Row({ label, hint, children }: { label: ReactNode; hint?: ReactNode; children?: ReactNode }) {
    return (
        <div className="flex items-center gap-6 py-3.5 min-h-[60px]">
            <div className="flex-1 min-w-0">
                <div className="text-sm text-white">{label}</div>
                {hint && <div className="text-xs text-zinc-500 mt-0.5 leading-relaxed max-w-md">{hint}</div>}
            </div>
            {children && <div className="shrink-0 flex items-center gap-2">{children}</div>}
        </div>
    );
}

function SelectControl({ value, options, onChange }: { value: string; options: { value: string; label: string }[]; onChange: (v: string) => void }) {
    return (
        <Select value={value} onValueChange={onChange}>
            <SelectTrigger className="w-44 h-9 bg-white/5 border-white/10 text-white hover:bg-white/10 transition-colors"><SelectValue /></SelectTrigger>
            <SelectContent className="bg-[#1a1a1e] border-white/10 text-white shadow-2xl z-[60]">
                {options.map(o => (
                    <SelectItem key={o.value} value={o.value} className="text-white hover:bg-white/10 focus:bg-white/10 focus:text-white cursor-pointer">{o.label}</SelectItem>
                ))}
            </SelectContent>
        </Select>
    );
}

// ── Modal ───────────────────────────────────────────────────────────────────

interface SettingsModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    terminal: string;
    editor: string;
    onSettingsChange: (terminal: string, editor: string) => void;
    setActiveTab: (tab: TabId) => void;
}

export function SettingsModal({ open, onOpenChange, terminal, editor, onSettingsChange, setActiveTab }: SettingsModalProps) {
    const [section, setSection] = usePref<SettingsSection>(SETTINGS_SECTION_PREF, "general");
    const [query, setQuery] = useState("");
    const [version, setVersion] = useState("");
    const { status: mcp } = useMcpStatus();
    const connected = mcp?.filter(s => s.connected).length ?? 0;

    useEffect(() => { getVersion().then(setVersion).catch(() => {}); }, []);
    useEffect(() => { if (!open) setQuery(""); }, [open]);

    const visible = useMemo(() => {
        const q = query.trim().toLowerCase();
        return q ? SECTIONS.filter(s => `${s.label} ${s.keywords}`.toLowerCase().includes(q)) : SECTIONS;
    }, [query]);
    const current = SECTIONS.find(s => s.id === section) ?? SECTIONS[0];

    const goTo = (tab: TabId) => { onOpenChange(false); setActiveTab(tab); };

    return (
        <Dialog.Root open={open} onOpenChange={onOpenChange}>
            <Dialog.Portal>
                <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=open]:fade-in-0" />
                <Dialog.Content
                    aria-describedby={undefined}
                    className="fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 w-[min(1080px,92vw)] h-[min(740px,86vh)] flex overflow-hidden rounded-2xl border border-white/10 bg-zinc-950 shadow-2xl outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-[0.98]"
                >
                    <aside className="w-64 shrink-0 flex flex-col border-r border-white/[0.06] bg-white/[0.015]">
                        <div className="flex items-center gap-2 px-4 h-14">
                            <Settings2 className="h-4 w-4 text-zinc-400" />
                            <Dialog.Title className="text-sm font-semibold text-white">Settings</Dialog.Title>
                        </div>
                        <div className="px-3 pb-3">
                            <div className="relative">
                                <Search className="h-3.5 w-3.5 text-zinc-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
                                <input
                                    value={query}
                                    onChange={e => {
                                        setQuery(e.target.value);
                                        const q = e.target.value.trim().toLowerCase();
                                        const first = SECTIONS.find(s => `${s.label} ${s.keywords}`.toLowerCase().includes(q));
                                        if (q && first) setSection(first.id);
                                    }}
                                    placeholder="Search settings"
                                    aria-label="Search settings"
                                    className="w-full h-9 rounded-lg bg-white/[0.04] border border-white/10 pl-8 pr-3 text-sm text-white placeholder:text-zinc-500 outline-none focus:border-white/25"
                                />
                            </div>
                        </div>
                        <nav className="flex-1 overflow-y-auto px-3 space-y-0.5" aria-label="Settings sections">
                            {visible.map(s => {
                                const active = s.id === current.id;
                                const badge = s.id === "agents" && mcp ? `${connected}/5` : s.id === "model" ? "Optional" : undefined;
                                return (
                                    <button
                                        key={s.id}
                                        onClick={() => setSection(s.id)}
                                        aria-current={active ? "page" : undefined}
                                        className={`w-full flex items-center gap-2.5 px-3 h-9 rounded-lg text-sm transition-colors ${active ? "bg-primary/15 text-primary" : "text-zinc-300 hover:bg-white/[0.05] hover:text-white"}`}
                                    >
                                        <s.icon className="h-4 w-4 shrink-0" />
                                        <span className="flex-1 text-left">{s.label}</span>
                                        {badge && <span className={`text-[10px] ${active ? "text-primary/70" : "text-zinc-600"}`}>{badge}</span>}
                                    </button>
                                );
                            })}
                            {visible.length === 0 && <p className="px-3 py-2 text-xs text-zinc-500">No settings match "{query}".</p>}
                        </nav>
                        <div className="px-4 h-11 flex items-center border-t border-white/[0.06] text-[11px] tracking-wider text-zinc-600 uppercase">
                            Devian{version ? ` · ${version}` : ""}
                        </div>
                    </aside>

                    <div className="flex-1 min-w-0 flex flex-col">
                        <header className="flex items-start gap-4 px-7 pt-5 pb-4 border-b border-white/[0.06]">
                            <div className="flex-1 min-w-0">
                                <h2 className="text-xl font-semibold text-white">{current.label}</h2>
                                <p className="text-sm text-zinc-500 mt-0.5">{current.description}</p>
                            </div>
                            <Dialog.Close className="p-1.5 -mr-1.5 rounded-md text-zinc-500 hover:text-white hover:bg-white/10 transition-colors" aria-label="Close settings">
                                <X className="h-4 w-4" />
                            </Dialog.Close>
                        </header>
                        <div className="flex-1 overflow-y-auto px-7 py-6">
                            <div key={current.id} className="animate-in fade-in duration-150">
                                {current.id === "general" && <GeneralSection version={version} goTo={goTo} />}
                                {current.id === "appearance" && <AppearanceSection />}
                                {current.id === "accounts" && <AccountsSection />}
                                {current.id === "agents" && <McpSetup />}
                                {current.id === "notifications" && <NotificationsSection />}
                                {current.id === "apps" && <AppsSection terminal={terminal} editor={editor} onSettingsChange={onSettingsChange} />}
                                {current.id === "privacy" && <PrivacySection />}
                                {current.id === "model" && <AIControlsPanel setActiveTab={setActiveTab as (tab: string) => void} />}
                                {current.id === "keyboard" && <KeyboardSection />}
                                {current.id === "about" && <AboutSection />}
                            </div>
                        </div>
                    </div>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}

// ── Sections ────────────────────────────────────────────────────────────────

type UpdateState = { kind: "idle" } | { kind: "checking" } | { kind: "current" } | { kind: "available"; update: Update } | { kind: "installing"; pct: number } | { kind: "error"; message: string };

function GeneralSection({ version, goTo }: { version: string; goTo: (t: TabId) => void }) {
    const [upd, setUpd] = useState<UpdateState>({ kind: "idle" });
    const [openOn, setOpenOn] = usePref<"overview" | "last">(OPEN_ON_PREF, "last");
    const [checklistHidden, setChecklistHidden] = usePref<boolean>(PREF.checklistDismissed, false);
    const [autoUpdate, setAutoUpdate] = usePref<boolean>(SETTING.autoUpdate, true);
    const [timeFormat, setTimeFormat] = usePref<TimeFormat>(SETTING.timeFormat, "system");
    const [refresh, setRefresh] = usePref<RefreshRate>(SETTING.refresh, "balanced");

    const checkUpdates = async () => {
        setUpd({ kind: "checking" });
        try {
            const u = await check();
            setUpd(u ? { kind: "available", update: u } : { kind: "current" });
        } catch (e) {
            setUpd({ kind: "error", message: String(e) });
        }
    };
    const install = async (u: Update) => {
        let total = 0, done = 0;
        setUpd({ kind: "installing", pct: 0 });
        try {
            await u.downloadAndInstall(ev => {
                if (ev.event === "Started") total = ev.data.contentLength ?? 0;
                if (ev.event === "Progress") { done += ev.data.chunkLength; setUpd({ kind: "installing", pct: total ? Math.round((done / total) * 100) : 0 }); }
            });
            await relaunch();
        } catch (e) {
            setUpd({ kind: "error", message: String(e) });
        }
    };

    return (
        <>
            <Group label="Application">
                <Row
                    label="Version"
                    hint={
                        upd.kind === "current" ? "You're on the latest version."
                            : upd.kind === "available" ? `Version ${upd.update.version} is ready to install.`
                            : upd.kind === "installing" ? `Downloading… ${upd.pct}%`
                            : upd.kind === "error" ? `Couldn't check: ${upd.message}`
                            : <span className="font-mono text-primary">{version || "…"}</span>
                    }
                >
                    {upd.kind === "available" ? (
                        <Button size="sm" onClick={() => install(upd.update)}><Download /> Install and restart</Button>
                    ) : upd.kind === "installing" || upd.kind === "checking" ? (
                        <Loader2 className="h-4 w-4 animate-spin text-zinc-500" />
                    ) : (
                        <Button size="sm" variant="secondary" onClick={checkUpdates}><RefreshCw /> Check for updates</Button>
                    )}
                </Row>
                <Row label="Check for updates automatically" hint="Looks for a new version each time Devian starts and offers to install it.">
                    <Switch label="Check for updates automatically" checked={autoUpdate} onCheckedChange={setAutoUpdate} />
                </Row>
            </Group>
            <Group label="Startup">
                <LaunchAtLoginRow />
                <Row label="Start on" hint="The page Devian shows when it opens.">
                    <Segmented<"overview" | "last">
                        value={openOn}
                        onChange={setOpenOn}
                        options={[{ value: "overview", label: "Overview" }, { value: "last", label: "Last page" }]}
                    />
                </Row>
            </Group>
            <Group label="Date & time">
                <Row label="Time format" hint={`Times across Devian, e.g. ${fmtTime(Date.now())}.`}>
                    <Segmented<TimeFormat>
                        value={timeFormat}
                        onChange={setTimeFormat}
                        options={[{ value: "system", label: "System" }, { value: "12", label: "12-hour" }, { value: "24", label: "24-hour" }]}
                    />
                </Row>
            </Group>
            <Group label="Performance">
                <Row
                    label="Live refresh"
                    hint={{
                        fast: "Processes every 4s, hardware every 2s. Most responsive, uses a little more energy.",
                        balanced: "Processes every 8s, hardware every 4s. The default.",
                        saver: "Processes every 30s, hardware every 15s. Easiest on the battery.",
                    }[refresh]}
                >
                    <Segmented<RefreshRate>
                        value={refresh}
                        onChange={setRefresh}
                        options={[{ value: "fast", label: "Fast" }, { value: "balanced", label: "Balanced" }, { value: "saver", label: "Battery saver" }]}
                    />
                </Row>
            </Group>
            <Group label="Setup">
                <Row label="Show setup checklist" hint="The Finish setting up strip on Overview, until every step is done.">
                    <Switch label="Show setup checklist" checked={!checklistHidden} onCheckedChange={v => { setChecklistHidden(!v); if (v) goTo("overview"); }} />
                </Row>
                <Row label="Welcome setup" hint="Re-scan your agents and revisit connections and preferences.">
                    <Button size="sm" variant="secondary" onClick={() => { writePref(PREF.onboarded, false); window.location.reload(); }}>
                        <RotateCcw /> Run again
                    </Button>
                </Row>
            </Group>
        </>
    );
}

function NotificationsSection() {
    const { toast } = useToast();
    const [leftovers, setLeftovers] = usePref<boolean>(PREF.notifyLeftovers, true);
    const [risky, setRisky] = usePref<boolean>(SETTING.notifyRisky, true);
    const [hardware, setHardware] = usePref<boolean>(SETTING.notifyHardware, true);
    const test = () =>
        invoke("show_notification", { title: "Devian notifications work", body: "This is how alerts about your agents will look." })
            .then(() => toast({ title: "Test notification sent", description: "Didn't see it? Allow notifications for Devian in System Settings." }))
            .catch(e => toast({ variant: "destructive", title: "Couldn't send", description: String(e) }));
    return (
        <>
            <Group label="Agents">
                <Row label="Something was left running" hint="A session ended but its dev server, test runner or container keeps going.">
                    <Switch label="Notify when an agent leaves something running" checked={leftovers} onCheckedChange={setLeftovers} />
                </Row>
                <Row label="Risky actions" hint="An agent force-pushed, used sudo, edited a .env file or similar.">
                    <Switch label="Notify about risky actions" checked={risky} onCheckedChange={setRisky} />
                </Row>
            </Group>
            <Group label="Machine">
                <Row label="Running hot or disk nearly full" hint="CPU at 90°C or more, or under 5% disk space left. At most once an hour each.">
                    <Switch label="Notify about temperature and disk space" checked={hardware} onCheckedChange={setHardware} />
                </Row>
            </Group>
            <Group label="Delivery">
                <Row label="Test notification" hint="Notifications appear in the bell in Devian's sidebar and as system notifications.">
                    <Button size="sm" variant="secondary" onClick={test}><BellRing /> Send test</Button>
                </Row>
            </Group>
        </>
    );
}

function AppearanceSection() {
    const [textSize, setTextSize] = usePref<TextSize>(SETTING.textSize, "default");
    const [motion, setMotion] = usePref<MotionPref>(SETTING.reduceMotion, "system");
    const [contrast, setContrast] = usePref<boolean>(SETTING.highContrast, false);
    const [focus, setFocus] = usePref<boolean>(SETTING.focusRings, false);
    const [collapsed, setCollapsed] = usePref<boolean>("devian_sidebar_collapsed", false);
    const systemReduces = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    return (
        <>
            <Group label="Text">
                <Row label="Text size" hint="Scales the whole interface, including charts and code.">
                    <Segmented<TextSize>
                        value={textSize}
                        onChange={setTextSize}
                        options={[{ value: "small", label: "Small" }, { value: "default", label: "Default" }, { value: "large", label: "Large" }, { value: "larger", label: "Larger" }]}
                    />
                </Row>
            </Group>
            <Group label="Motion">
                <Row label="Reduce motion" hint={`Turns off animations, pulsing indicators and transitions.${motion === "system" ? ` Your system setting is ${systemReduces ? "on" : "off"}.` : ""}`}>
                    <Segmented<MotionPref>
                        value={motion}
                        onChange={setMotion}
                        options={[{ value: "system", label: "System" }, { value: "reduce", label: "On" }, { value: "full", label: "Off" }]}
                    />
                </Row>
            </Group>
            <Group label="Visibility">
                <Row label="Increase contrast" hint="Brighter secondary text and borders.">
                    <Switch label="Increase contrast" checked={contrast} onCheckedChange={setContrast} />
                </Row>
                <Row label="Always show focus outlines" hint="Outline whatever has focus, whether you got there by keyboard or mouse.">
                    <Switch label="Always show focus outlines" checked={focus} onCheckedChange={setFocus} />
                </Row>
            </Group>
            <Group label="Layout">
                <Row label="Collapse sidebar" hint={`Icons only. Toggle anytime with ${MOD}B.`}>
                    <Switch label="Collapse sidebar" checked={collapsed} onCheckedChange={setCollapsed} />
                </Row>
            </Group>
        </>
    );
}

function AccountsSection() {
    const { instances } = useInstances();
    const [hidden, setHidden] = usePref<string[]>(PREF.hiddenInstances, []);
    const [enabled, setEnabled] = usePref<string[]>(PREF.limitsEnabled, []);
    const [menuBar, setMenuBar] = usePref<boolean>(PREF.menuBarLimits, true);
    const [accounts, setAccounts] = useState<ProviderLimits[] | null>(null);

    // Listing accounts never touches credentials: nothing is enabled in this call.
    useEffect(() => {
        invoke<ProviderLimits[]>("agents_limits", { enabled: [], force: false }).then(setAccounts).catch(() => setAccounts([]));
    }, []);

    const toggle = (list: string[], id: string, on: boolean) => (on ? [...new Set([...list, id])] : list.filter(x => x !== id));
    const codex = accounts?.find(a => a.id === "codex");

    return (
        <>
            <Group label="Claude Code setups">
                {instances.length === 0 && <Row label="No Claude Code folders found" hint="Devian looks for ~/.claude and any ~/.claude-* folder (CLAUDE_CONFIG_DIR)." />}
                {instances.map(inst => {
                    const acct = accounts?.find(a => a.id === `claude:${inst.id}`);
                    const limitsOk = acct && acct.status !== "unsupported";
                    const included = !hidden.includes(inst.id);
                    return (
                        <Row
                            key={inst.id}
                            label={<span className="inline-flex items-center gap-2"><AgentDot agent="claude" />{inst.label}{inst.is_default && <span className="text-[10px] uppercase tracking-wide text-zinc-600">Default</span>}</span>}
                            hint={
                                <span className="space-y-0.5 block">
                                    <span className="block font-mono">{inst.path.replace(/^\/Users\/[^/]+/, "~")}</span>
                                    <span className="block">{[inst.plan, inst.provider === "bedrock" ? "AWS Bedrock" : inst.provider === "vertex" ? "Google Vertex" : inst.provider === "custom" ? "API key or custom endpoint" : null].filter(Boolean).join(" · ") || "Claude plan"}</span>
                                    {!limitsOk && acct?.message && <span className="block text-zinc-600">{acct.message}</span>}
                                </span>
                            }
                        >
                            <label className="flex items-center gap-2 text-xs text-zinc-400">
                                Include
                                <Switch label={`Include ${inst.label}`} checked={included} onCheckedChange={v => setHidden(toggle(hidden, inst.id, !v))} />
                            </label>
                            <label className={`flex items-center gap-2 text-xs ${limitsOk && included ? "text-zinc-400" : "text-zinc-700"}`}>
                                Limits
                                <Switch
                                    label={`Live limits for ${inst.label}`}
                                    checked={!!limitsOk && included && enabled.includes(`claude:${inst.id}`)}
                                    disabled={!limitsOk || !included}
                                    onCheckedChange={v => { track("limits_toggled", { provider: "claude", on: v }); setEnabled(toggle(enabled, `claude:${inst.id}`, v)); }}
                                />
                            </label>
                        </Row>
                    );
                })}
            </Group>
            {codex && (
                <Group label="Codex">
                    <Row label={<span className="inline-flex items-center gap-2"><AgentDot agent="codex" />Codex</span>} hint="5-hour and weekly limits for your ChatGPT plan.">
                        <label className="flex items-center gap-2 text-xs text-zinc-400">
                            Limits
                            <Switch label="Live limits for Codex" checked={enabled.includes("codex")} onCheckedChange={v => { track("limits_toggled", { provider: "codex", on: v }); setEnabled(toggle(enabled, "codex", v)); }} />
                        </label>
                    </Row>
                </Group>
            )}
            <Group label="Where limits show">
                <Row label="Menu bar" hint="The tightest limit next to the clock, with every account one click away. Works while Devian's window is closed.">
                    <Switch label="Show limits in the menu bar" checked={menuBar} onCheckedChange={setMenuBar} />
                </Row>
            </Group>
            <Group label="How limits are read">
                <Row
                    label="Straight from Anthropic and OpenAI"
                    hint="Devian uses the login Claude Code and Codex already saved and sends it only to that provider's own usage endpoint. It's never stored, shown or refreshed by Devian. The first time, macOS asks whether Devian can read Claude Code's saved login: choose Always Allow."
                />
            </Group>
        </>
    );
}

function LaunchAtLoginRow() {
    const { toast } = useToast();
    const [on, setOn] = useState<boolean | null>(null);
    useEffect(() => { autostartEnabled().then(setOn).catch(() => setOn(null)); }, []);
    const set = async (v: boolean) => {
        try {
            await (v ? enableAutostart() : disableAutostart());
            setOn(await autostartEnabled());
        } catch (e) {
            toast({ variant: "destructive", title: "Couldn't change launch at login", description: String(e) });
        }
    };
    return (
        <Row label="Launch at login" hint="Start Devian when you log in, so leftover alerts work from the first session of the day.">
            {on === null ? <span className="text-xs text-zinc-600">Unavailable</span> : <Switch label="Launch at login" checked={on} onCheckedChange={set} />}
        </Row>
    );
}

function AppsSection({ terminal, editor, onSettingsChange }: { terminal: string; editor: string; onSettingsChange: (t: string, e: string) => void }) {
    const { toast } = useToast();
    const save = async (t: string, e: string) => {
        try {
            await invoke("save_user_settings", { terminal: t, editor: e });
            onSettingsChange(t, e);
            track("settings_saved", { terminal: t, editor: e });
        } catch (err) {
            toast({ variant: "destructive", title: "Couldn't save", description: String(err) });
        }
    };
    return (
        <Group label="Open with">
            <Row label="Code editor" hint="Open project, and the external-editor button in Memory.">
                <SelectControl value={editor} options={EDITOR_OPTIONS} onChange={v => save(terminal, v)} />
            </Row>
            <Row label="Terminal" hint="Open in terminal, from Projects.">
                <SelectControl value={terminal} options={TERMINAL_OPTIONS} onChange={v => save(v, editor)} />
            </Row>
        </Group>
    );
}

function PrivacySection() {
    const [fda, setFda] = useState<"unknown" | "granted" | "missing">("unknown");
    const [usageConsent, setUsageConsent] = useState(hasTelemetryConsent);
    const [dataDir, setDataDir] = useState<string | null>(null);
    const checkFda = () => invoke("check_full_disk_access").then(() => setFda("granted")).catch(() => setFda("missing"));
    useEffect(() => {
        checkFda();
        homeDir().then(h => setDataDir(`${h.replace(/\/$/, "")}/.devian`)).catch(() => {});
    }, []);
    return (
        <>
            <Group label="Access">
                <Row label="Full Disk Access" hint="Optional. Only helps Projects find repositories in protected folders like Documents. Agent history, memory and runtime work without it.">
                    {fda === "granted" ? (
                        <span className="inline-flex items-center gap-1.5 text-xs text-emerald-300"><CheckCircle2 className="h-4 w-4" /> Granted</span>
                    ) : fda === "unknown" ? (
                        <Loader2 className="h-4 w-4 animate-spin text-zinc-500" />
                    ) : (
                        <>
                            <Button size="sm" variant="ghost" className="text-zinc-400" onClick={checkFda}>Check again</Button>
                            <Button size="sm" variant="secondary" onClick={() => invoke("request_disk_access").catch(() => {})}>Open System Settings</Button>
                        </>
                    )}
                </Row>
            </Group>
            <Group label="Data">
                {telemetryConfigured && (
                    <Row label="Send anonymous usage data and error reports" hint="Which screens and features get used, and errors with your home folder removed. Never code, prompts, file contents, project names or agent history.">
                        <Switch label="Send anonymous usage data and error reports" checked={usageConsent} onCheckedChange={v => { setTelemetryConsent(v); setUsageConsent(v); }} />
                    </Row>
                )}
                <Row label="Devian's own data" hint={dataDir ? <span className="font-mono">{dataDir.replace(/^\/Users\/[^/]+/, "~")}</span> : "Settings, tracker state and memory edit history."}>
                    {dataDir && (
                        <Button size="sm" variant="secondary" onClick={() => invoke("open_in_finder", { path: dataDir }).catch(() => {})}>
                            <FolderOpen /> Reveal
                        </Button>
                    )}
                </Row>
                <Row label="Agent history" hint="Read in place from each agent's own folder. Devian never uploads or modifies it." />
                <Row label="Exactly what's sent" hint="Every event and field Devian can send, and every network request it makes.">
                    <Button size="sm" variant="secondary" onClick={() => openUrl(`${REPO}/blob/main/PRIVACY.md`).catch(() => {})}><ExternalLink /> Privacy details</Button>
                </Row>
            </Group>
        </>
    );
}

function KeyboardSection() {
    const groups: [string, [string, string][]][] = [
        ["Everywhere", [
            [`${MOD}K`, "Search sessions, projects and services"],
            [`${MOD}1 – ${MOD}7`, "Jump to a section"],
            [`${MOD}B`, "Collapse or expand the sidebar"],
            [`${MOD},`, "Open Settings"],
        ]],
        ["Sessions", [
            ["↑ ↓", "Move through sessions"],
            ["R", "Mark a session reviewed"],
        ]],
        ["Memory", [
            [`${MOD}E`, "Switch between preview and editing"],
            [`${MOD}S`, "Save"],
            [`${MOD}F`, "Find in file"],
        ]],
    ];
    return (
        <>
            {groups.map(([label, rows]) => (
                <Group key={label} label={label}>
                    {rows.map(([keys, what]) => (
                        <div key={keys} className="flex items-center justify-between py-2.5 text-sm">
                            <span className="text-zinc-300">{what}</span>
                            <kbd className="font-sans text-xs text-zinc-300 bg-white/[0.06] border border-white/10 rounded px-1.5 py-0.5">{keys}</kbd>
                        </div>
                    ))}
                </Group>
            ))}
        </>
    );
}

function AboutSection() {
    const { toast } = useToast();
    const link = (url: string) => openUrl(url).catch(() => toast({ variant: "destructive", title: "Couldn't open the link" }));
    return (
        <Group label="Devian">
            <Row label="Free and open source" hint="MIT licensed. Built with Tauri, Rust and React.">
                <Button size="sm" variant="secondary" onClick={() => link(REPO)}><ExternalLink /> GitHub</Button>
            </Row>
            <Row label="What's new">
                <Button size="sm" variant="secondary" onClick={() => link(`${REPO}/blob/main/CHANGELOG.md`)}>Changelog</Button>
            </Row>
            <Row label="Found a bug or have an idea?" hint="Tell us in the app, or open an issue on GitHub. Include your agent and its version if something isn't being read correctly.">
                <div className="flex gap-2">
                    <Button size="sm" variant="secondary" onClick={() => openFeedback()}>Send feedback</Button>
                    <Button size="sm" variant="ghost" onClick={() => link(`${REPO}/issues/new/choose`)}>GitHub issues</Button>
                </div>
            </Row>
        </Group>
    );
}

/** Which page to show on launch, honouring the "Start on" setting. */
export function initialTab(saved: string, valid: (t: string) => boolean): string {
    return readPref<string>(OPEN_ON_PREF, "last") === "overview" || !valid(saved) ? "overview" : saved;
}
