// Small per-machine preferences kept in localStorage. Every access is guarded:
// storage can be unavailable, and the app must behave the same without it.

import { useCallback, useEffect, useState } from "react";

export function readPref<T>(key: string, fallback: T): T {
    try {
        const raw = localStorage.getItem(key);
        return raw === null ? fallback : (JSON.parse(raw) as T);
    } catch {
        return fallback;
    }
}

export function writePref<T>(key: string, value: T) {
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch { /* storage unavailable */ }
    window.dispatchEvent(new CustomEvent("devian-pref", { detail: key }));
}

/** A preference that stays in sync across components. */
export function usePref<T>(key: string, fallback: T): [T, (v: T | ((prev: T) => T)) => void] {
    const [value, setValue] = useState<T>(() => readPref(key, fallback));
    useEffect(() => {
        const onChange = (e: Event) => {
            if ((e as CustomEvent).detail === key) setValue(readPref(key, fallback));
        };
        window.addEventListener("devian-pref", onChange);
        return () => window.removeEventListener("devian-pref", onChange);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [key]);
    const set = useCallback((v: T | ((prev: T) => T)) => {
        const next = typeof v === "function" ? (v as (p: T) => T)(readPref(key, fallback)) : v;
        writePref(key, next);
        setValue(next);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [key]);
    return [value, set];
}

export const PREF = {
    onboarded: "devian_onboarding_v2_done",
    activeTab: "devian_active_tab",
    /** sessionKey → updated_at when it was reviewed; new activity re-opens it. */
    reviewed: "devian_reviewed_sessions",
    notifyLeftovers: "devian_notify_leftovers",
    checklistDismissed: "devian_checklist_dismissed",
    visited: "devian_visited_tabs",
    /** Claude instance ids (folder names) excluded from Devian. */
    hiddenInstances: "devian_hidden_instances",
    /** Limit account ids ("claude:<instance>", "codex") the user turned on. */
    limitsEnabled: "devian_limits_enabled",
    /** Show plan limits in the macOS menu bar. */
    menuBarLimits: "devian_menubar_limits",
    /** Local day keys the app was opened on (last 30). */
    activeDays: "devian_active_days",
    /** The one-time "how's it going" card was shown. */
    feedbackNudged: "devian_feedback_nudged",
} as const;

export type ReviewedMap = Record<string, number>;

export function isReviewed(map: ReviewedMap, key: string, updatedAt: number) {
    const at = map[key];
    return at !== undefined && at >= updatedAt;
}
