// What goes into a bug report, and how to open one.

import { invoke } from "@tauri-apps/api/core";
import { recentErrors, scrub, type FeedbackKind } from "@/lib/telemetry";

export const REPO_URL = "https://github.com/devian-labs/devian";

export interface AppInfo {
    version: string;
    os: string;
    os_version: string;
    arch: string;
}

export interface CrashReport {
    id: string;
    at: number;
    text: string;
}

let info: Promise<AppInfo> | null = null;
export const appInfo = () => (info ??= invoke<AppInfo>("diagnostics_info").catch(() => ({ version: "unknown", os: navigator.platform, os_version: "", arch: "" })));

/** Everything a report would include. Shown to the user before sending. */
export async function collectDiagnostics(crash?: CrashReport | null) {
    const i = await appInfo();
    return {
        version: i.version,
        os: i.os_version || i.os,
        arch: i.arch,
        screen: `${window.innerWidth}x${window.innerHeight}`,
        recent_errors: recentErrors().map(e => `${new Date(e.at).toISOString()} [${e.where}] ${e.message}`),
        crash: crash ? scrub(crash.text) : undefined,
    };
}

const OS_OPTION: Record<string, string> = { macos: "macOS (Apple Silicon)", windows: "Windows", linux: "Linux" };

/** A prefilled GitHub issue (fields match .github/ISSUE_TEMPLATE). */
export async function githubIssueUrl(kind: FeedbackKind, message: string, crash?: CrashReport | null) {
    const d = await collectDiagnostics(crash);
    const q = new URLSearchParams();
    if (kind === "bug") {
        const i = await appInfo();
        q.set("template", "bug_report.yml");
        q.set("what", message);
        q.set("version", d.version);
        const os = i.os === "macos" && i.arch !== "aarch64" ? "macOS (Intel)" : OS_OPTION[i.os];
        if (os) q.set("os", os);
        const logs = [...d.recent_errors, d.crash ?? ""].filter(Boolean).join("\n").slice(0, 4000);
        if (logs) q.set("logs", logs);
    } else {
        q.set("template", "feature_request.yml");
        q.set("title", message.split("\n")[0].slice(0, 80));
        q.set("problem", message);
    }
    return `${REPO_URL}/issues/new?${q}`;
}

// The feedback dialog lives at the app root; anything can open it.
export interface FeedbackRequest {
    kind?: FeedbackKind;
    message?: string;
    crash?: CrashReport | null;
}

export function openFeedback(req: FeedbackRequest = {}) {
    window.dispatchEvent(new CustomEvent<FeedbackRequest>("devian-feedback", { detail: req }));
}
