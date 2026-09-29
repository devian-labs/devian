import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { AlertTriangle, Heart, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { openFeedback, REPO_URL, type CrashReport } from "@/lib/diagnostics";
import { localDayKey } from "@/lib/agents";
import { PREF, readPref, writePref } from "@/lib/prefs";
import { track } from "@/lib/telemetry";

/** Days of use before asking, once, how Devian is going. */
const NUDGE_AFTER_DAYS = 5;

type Notice = { kind: "crash"; crash: CrashReport } | { kind: "nudge" };

/** One quiet card in the corner: a crash to report, or a one-time feedback ask. */
export function AppNotices() {
    const [notice, setNotice] = useState<Notice | null>(null);

    useEffect(() => {
        const today = localDayKey(new Date());
        const days = readPref<string[]>(PREF.activeDays, []);
        if (!days.includes(today)) writePref(PREF.activeDays, [...days, today].slice(-30));

        invoke<CrashReport | null>("diagnostics_pending_crash")
            .then(crash => {
                if (crash) return setNotice({ kind: "crash", crash });
                const used = new Set([...days, today]).size;
                if (used >= NUDGE_AFTER_DAYS && !readPref(PREF.feedbackNudged, false)) setNotice({ kind: "nudge" });
            })
            .catch(() => { /* older backend */ });
    }, []);

    if (!notice) return null;

    const close = () => {
        if (notice.kind === "crash") invoke("diagnostics_dismiss_crash", { id: notice.crash.id }).catch(() => {});
        else writePref(PREF.feedbackNudged, true);
        setNotice(null);
    };

    return (
        <div role="status" className="fixed bottom-4 right-4 z-40 w-[340px] rounded-xl border border-white/10 bg-zinc-900/95 backdrop-blur shadow-2xl p-4 animate-in fade-in-0 slide-in-from-bottom-2">
            <button onClick={close} className="absolute top-2.5 right-2.5 p-1 rounded-md text-zinc-500 hover:text-white hover:bg-white/10" aria-label="Dismiss"><X className="h-3.5 w-3.5" /></button>
            {notice.kind === "crash" ? (
                <div className="space-y-3 pr-5">
                    <div className="flex items-start gap-2.5">
                        <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
                        <div>
                            <p className="text-sm font-medium text-white">Devian hit an internal error last time</p>
                            <p className="text-xs text-zinc-400 mt-1">The report stays on this computer unless you send it. You can see exactly what's in it first.</p>
                        </div>
                    </div>
                    <div className="flex gap-2 pl-6">
                        <Button size="sm" onClick={() => { track("crash_report_opened"); openFeedback({ kind: "bug", crash: notice.crash }); close(); }}>Review and send</Button>
                        <Button size="sm" variant="ghost" onClick={close}>Not now</Button>
                    </div>
                </div>
            ) : (
                <div className="space-y-3 pr-5">
                    <div className="flex items-start gap-2.5">
                        <Heart className="h-4 w-4 text-rose-400 shrink-0 mt-0.5" />
                        <div>
                            <p className="text-sm font-medium text-white">How's Devian working for you?</p>
                            <p className="text-xs text-zinc-400 mt-1">One line about what's missing or annoying helps more than you'd think.</p>
                        </div>
                    </div>
                    <div className="flex gap-2 pl-6">
                        <Button size="sm" onClick={() => { track("feedback_nudge", { action: "feedback" }); openFeedback({ kind: "idea" }); close(); }}>Give feedback</Button>
                        <Button size="sm" variant="ghost" onClick={() => { track("feedback_nudge", { action: "star" }); openUrl(REPO_URL).catch(() => {}); close(); }}>Star on GitHub</Button>
                    </div>
                </div>
            )}
        </div>
    );
}
