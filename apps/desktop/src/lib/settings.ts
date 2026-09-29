// App-wide preferences that change how Devian looks and behaves, and the
// code that applies them. Stored with the other prefs in localStorage.

import { getCurrentWebview } from "@tauri-apps/api/webview";
import { readPref } from "@/lib/prefs";

export const SETTING = {
    timeFormat: "devian_time_format",
    refresh: "devian_refresh_rate",
    autoUpdate: "devian_auto_update",
    textSize: "devian_text_size",
    reduceMotion: "devian_reduce_motion",
    highContrast: "devian_high_contrast",
    focusRings: "devian_focus_rings",
    notifyRisky: "devian_notify_risky",
    notifyHardware: "devian_notify_hardware",
} as const;

export type TimeFormat = "system" | "12" | "24";
export type RefreshRate = "fast" | "balanced" | "saver";
export type TextSize = "small" | "default" | "large" | "larger";
export type MotionPref = "system" | "reduce" | "full";

export const TEXT_ZOOM: Record<TextSize, number> = { small: 0.9, default: 1, large: 1.12, larger: 1.25 };

/** Polling intervals (ms) for each refresh rate. */
export const REFRESH_MS: Record<RefreshRate, { runtime: number; machine: number; services: number; sessions: number }> = {
    fast: { runtime: 4000, machine: 2000, services: 3000, sessions: 30000 },
    balanced: { runtime: 8000, machine: 4000, services: 5000, sessions: 60000 },
    saver: { runtime: 30000, machine: 15000, services: 20000, sessions: 180000 },
};

export const refreshMs = () => REFRESH_MS[readPref<RefreshRate>(SETTING.refresh, "balanced")] ?? REFRESH_MS.balanced;

// ── Appearance & accessibility ──────────────────────────────────────────────

const systemReducedMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** Applies appearance prefs to the document. Safe to call repeatedly. */
export function applyAppearance() {
    const root = document.documentElement;
    const motion = readPref<MotionPref>(SETTING.reduceMotion, "system");
    root.classList.toggle("reduce-motion", motion === "reduce" || (motion === "system" && systemReducedMotion()));
    root.classList.toggle("high-contrast", readPref<boolean>(SETTING.highContrast, false));
    root.classList.toggle("focus-rings", readPref<boolean>(SETTING.focusRings, false));

    // Webview zoom scales everything (including px-sized text) and keeps
    // full-height layouts correct; CSS zoom is the fallback outside Tauri.
    const zoom = TEXT_ZOOM[readPref<TextSize>(SETTING.textSize, "default")] ?? 1;
    getCurrentWebview()
        .setZoom(zoom)
        .then(() => { root.style.removeProperty("zoom"); })
        .catch(() => { root.style.setProperty("zoom", String(zoom)); });
}

/** Keeps appearance in sync with pref changes and the OS motion setting. */
export function watchAppearance() {
    applyAppearance();
    const onPref = (e: Event) => {
        const key = (e as CustomEvent).detail as string;
        if ([SETTING.reduceMotion, SETTING.highContrast, SETTING.focusRings, SETTING.textSize].includes(key as never)) applyAppearance();
    };
    window.addEventListener("devian-pref", onPref);
    window.matchMedia?.("(prefers-reduced-motion: reduce)").addEventListener?.("change", applyAppearance);
}

// ── Time formatting ─────────────────────────────────────────────────────────

function hour12(): boolean | undefined {
    const f = readPref<TimeFormat>(SETTING.timeFormat, "system");
    return f === "system" ? undefined : f === "12";
}

/** "1:23 PM" or "13:23", following the time-format setting. */
export function fmtTime(ms: number): string {
    return new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", hour12: hour12() });
}

/** "Sep 29, 1:23 PM" style, following the time-format setting. */
export function fmtDateTime(ms: number, opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }): string {
    return new Date(ms).toLocaleString([], { ...opts, hour12: hour12() });
}
