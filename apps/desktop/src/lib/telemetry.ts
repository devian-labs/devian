import posthog, { type CaptureResult, type PostHogConfig } from "posthog-js";

// Anonymous usage analytics and error reports are strictly opt-in. Nothing is
// sent unless the build was configured with a PostHog key AND the user has
// turned it on. Feedback is the exception: it's sent only when the user
// presses Send, and the dialog shows exactly what goes with it.
const CONSENT_KEY = "usage_consent";
const KEY = import.meta.env.VITE_PUBLIC_POSTHOG_KEY as string | undefined;
const HOST = (import.meta.env.VITE_PUBLIC_POSTHOG_HOST as string | undefined) || "https://us.i.posthog.com";

export const telemetryConfigured = Boolean(KEY);

export function hasTelemetryConsent(): boolean {
    try {
        return localStorage.getItem(CONSENT_KEY) === "true";
    } catch {
        return false;
    }
}

export function setTelemetryConsent(enabled: boolean): void {
    try {
        localStorage.setItem(CONSENT_KEY, String(enabled));
    } catch {
        // Storage unavailable: fall through and still apply the in-memory choice.
    }
    if (!telemetryConfigured) return;
    if (enabled) posthog.opt_in_capturing();
    else posthog.opt_out_capturing();
}

// ---------------------------------------------------------------- scrubbing

/** Properties that could identify a person or project; never sent. */
const DENY = new Set(["name", "path", "project", "project_path", "folder_name", "script", "query", "title", "email", "cwd", "file"]);

/** Removes home folders, emails and anything that looks like a secret. */
export function scrub(text: string): string {
    return text
        .replace(/\/Users\/[^/\s"'`]+/g, "~")
        .replace(/\/home\/[^/\s"'`]+/g, "~")
        .replace(/[A-Za-z]:\\Users\\[^\\\s"'`]+/g, "~")
        .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "<email>")
        .replace(/\b(sk|pk|ghp|gho|github_pat|xox[abp])[-_][A-Za-z0-9_-]{8,}/g, "<secret>")
        .replace(/\b[A-Za-z0-9+/_-]{40,}={0,2}/g, "<redacted>");
}

function scrubValue(v: unknown, depth = 0): unknown {
    if (typeof v === "string") return scrub(v).slice(0, 2000);
    if (depth > 6 || v === null || typeof v !== "object") return v;
    if (Array.isArray(v)) return v.map(x => scrubValue(x, depth + 1));
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) {
        if (depth === 0 && DENY.has(k)) continue;
        // PostHog's own fields (project token, ids, library info) pass
        // through untouched, except exception details, which carry messages.
        const internal = depth === 0 && (k === "token" || k === "distinct_id" || (k.startsWith("$") && !k.startsWith("$exception")));
        out[k] = internal ? x : scrubValue(x, depth + 1);
    }
    return out;
}

// ------------------------------------------------------------------- client

export const posthogOptions = {
    api_host: HOST,
    defaults: "2026-01-30",
    // Opt-in only: nothing is captured until the user enables usage data.
    opt_out_capturing_by_default: true,
    // Only the events Devian sends on purpose. The UI shows agent prompts,
    // file paths and memory, so nothing is captured from the page itself.
    autocapture: false,
    capture_pageview: false,
    capture_pageleave: false,
    capture_dead_clicks: false,
    capture_heatmaps: false,
    capture_performance: false,
    disable_session_recording: true,
    disable_surveys: true,
    mask_all_text: true,
    mask_all_element_attributes: true,
    person_profiles: "never",
    // Exceptions are captured by reportError below, after scrubbing.
    capture_exceptions: false,
    persistence: "localStorage",
    // No remote code or config: Devian uses no feature flags, and a script
    // fetched at runtime would bypass what's reviewed in this repo.
    disable_external_dependency_loading: true,
    advanced_disable_flags: true,
    before_send: (event: CaptureResult | null) => {
        if (event?.properties) event.properties = scrubValue(event.properties) as CaptureResult["properties"];
        return event;
    },
    loaded: (ph) => {
        if (hasTelemetryConsent() && !ph.has_opted_in_capturing()) ph.opt_in_capturing();
    },
} satisfies Partial<PostHogConfig>;

const active = () => telemetryConfigured && hasTelemetryConsent();

/** Records a usage event. Properties must be counts, flags or short enums. */
export function track(event: string, props?: Record<string, string | number | boolean | null | undefined | string[]>) {
    if (!active()) return;
    try { posthog.capture(event, props); } catch { /* never let analytics break the app */ }
}

// ------------------------------------------------------------------- errors

export interface RecordedError {
    at: number;
    message: string;
    where: string;
}

const recent: RecordedError[] = [];

/** The last few errors, already scrubbed, for bug reports. */
export const recentErrors = () => [...recent];

/** Remembers an error for bug reports and, with consent, reports it. */
export function reportError(error: unknown, where: string) {
    const err = error instanceof Error ? error : new Error(typeof error === "string" ? error : JSON.stringify(error));
    const message = scrub(err.message || String(err)).slice(0, 500);
    // Identical errors in a burst (a failing poll) are recorded once.
    if (recent.some(r => r.message === message && Date.now() - r.at < 60_000)) return;
    recent.push({ at: Date.now(), message, where });
    if (recent.length > 10) recent.shift();
    if (!active()) return;
    try {
        const safe = new Error(message);
        safe.name = err.name;
        safe.stack = err.stack ? scrub(err.stack) : undefined;
        posthog.captureException(safe, { where });
    } catch { /* ignore */ }
}

/** Catches errors nothing else handled. */
export function installErrorHandlers() {
    window.addEventListener("error", e => reportError(e.error ?? e.message, "window"));
    window.addEventListener("unhandledrejection", e => reportError(e.reason, "promise"));
}

// ----------------------------------------------------------------- feedback

export type FeedbackKind = "bug" | "idea" | "other";

/**
 * Sends feedback straight to PostHog's capture API. It doesn't go through the
 * analytics client, so it works when usage data is off; it's anonymous unless
 * the user typed an email. Throws when the build has no analytics key.
 */
export async function sendFeedback(payload: { kind: FeedbackKind; message: string; email?: string; diagnostics?: unknown }) {
    if (!KEY) throw new Error("Feedback isn't set up in this build");
    const distinct_id = active() ? posthog.get_distinct_id() : `feedback-${crypto.randomUUID()}`;
    const res = await fetch(`${HOST.replace(/\/$/, "")}/i/v0/e/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            api_key: KEY,
            event: "feedback_submitted",
            distinct_id,
            properties: {
                kind: payload.kind,
                message: payload.message.slice(0, 5000),
                email: payload.email || undefined,
                diagnostics: payload.diagnostics ? scrubValue(payload.diagnostics) : undefined,
                $process_person_profile: false,
            },
        }),
    });
    if (!res.ok) throw new Error(`Feedback wasn't accepted (${res.status})`);
}
