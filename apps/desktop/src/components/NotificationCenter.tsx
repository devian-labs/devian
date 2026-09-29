import { useEffect, useRef } from "react";
import { X, ArrowRight, AlertTriangle, Server, Sparkles, Info } from "lucide-react";
import { TabId } from "@/components/Sidebar";

export interface AppNotification {
    id: string;
    type: "service_down" | "vulnerability" | "cleanup_ready" | "info";
    title: string;
    message: string;
    timestamp: number;
    read: boolean;
    action?: { label: string; tab: TabId };
}

interface NotificationCenterProps {
    notifications: AppNotification[];
    open: boolean;
    onOpen: () => void;
    onClose: () => void;
    onDismiss: (id: string) => void;
    onClearAll: () => void;
    onNavigate: (tab: TabId) => void;
}

function typeIcon(type: AppNotification["type"]) {
    switch (type) {
        case "service_down": return <Server className="h-4 w-4 text-red-400 shrink-0" />;
        case "vulnerability": return <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0" />;
        case "cleanup_ready": return <Sparkles className="h-4 w-4 text-primary shrink-0" />;
        default: return <Info className="h-4 w-4 text-zinc-500 shrink-0" />;
    }
}

function relativeTime(ts: number) {
    const s = Math.floor((Date.now() - ts) / 1000);
    if (s < 60) return "just now";
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    return `${Math.floor(s / 86400)}d ago`;
}

export function NotificationCenter({
    notifications, open, onClose, onDismiss, onClearAll, onNavigate,
}: NotificationCenterProps) {
    const panelRef = useRef<HTMLDivElement>(null);

    // Close on outside click
    useEffect(() => {
        if (!open) return;
        const handler = (e: MouseEvent) => {
            if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
                onClose();
            }
        };
        // Slight delay so the opening click doesn't immediately close it
        const timer = setTimeout(() => document.addEventListener("mousedown", handler), 50);
        return () => { clearTimeout(timer); document.removeEventListener("mousedown", handler); };
    }, [open, onClose]);

    if (!open) return null;

    return (
        // Fixed overlay — rendered at Dashboard root level, no stacking context issues
        <div
            ref={panelRef}
            className="fixed bottom-16 left-[240px] w-80 bg-zinc-900 border border-white/10 rounded-xl shadow-2xl z-500 overflow-hidden animate-in fade-in slide-in-from-bottom-2 duration-150"
        >
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
                <span className="text-sm font-semibold text-white">Notifications</span>
                <div className="flex items-center gap-2">
                    {notifications.length > 0 && (
                        <button onClick={onClearAll} className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors">
                            Clear all
                        </button>
                    )}
                    <button onClick={onClose} className="text-zinc-600 hover:text-zinc-400 transition-colors">
                        <X className="h-3.5 w-3.5" />
                    </button>
                </div>
            </div>

            <div className="max-h-72 overflow-y-auto">
                {notifications.length === 0 ? (
                    <div className="px-4 py-8 text-center text-sm text-zinc-600">
                        No notifications
                    </div>
                ) : (
                    notifications.map(n => (
                        <div key={n.id} className={`flex items-start gap-3 px-4 py-3 border-b border-white/4 last:border-0 ${!n.read ? "bg-white/2" : ""}`}>
                            <div className="mt-0.5">{typeIcon(n.type)}</div>
                            <div className="flex-1 min-w-0">
                                <div className="flex items-start justify-between gap-2">
                                    <span className="text-sm font-medium text-white leading-snug">{n.title}</span>
                                    <span className="text-[10px] text-zinc-600 shrink-0 mt-0.5">{relativeTime(n.timestamp)}</span>
                                </div>
                                <p className="text-xs text-zinc-500 mt-0.5 leading-relaxed">{n.message}</p>
                                {n.action && (
                                    <button
                                        onClick={() => { onNavigate(n.action!.tab); onClose(); }}
                                        className="mt-1.5 flex items-center gap-1 text-xs text-primary hover:text-primary/80 transition-colors"
                                    >
                                        {n.action.label}
                                        <ArrowRight className="h-3 w-3" />
                                    </button>
                                )}
                            </div>
                            <button onClick={() => onDismiss(n.id)} className="text-zinc-700 hover:text-zinc-400 transition-colors shrink-0 mt-0.5">
                                <X className="h-3.5 w-3.5" />
                            </button>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
}
