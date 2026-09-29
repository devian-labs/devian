import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Bug, Check, ChevronRight, ExternalLink, Lightbulb, Loader2, MessageSquare, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { collectDiagnostics, githubIssueUrl, type CrashReport, type FeedbackRequest } from "@/lib/diagnostics";
import { sendFeedback, telemetryConfigured, track, type FeedbackKind } from "@/lib/telemetry";

const KINDS: { id: FeedbackKind; label: string; icon: typeof Bug; placeholder: string }[] = [
    { id: "bug", label: "Something's wrong", icon: Bug, placeholder: "What happened, and what did you expect? Which agent was involved?" },
    { id: "idea", label: "Idea", icon: Lightbulb, placeholder: "What would make Devian more useful to you?" },
    { id: "other", label: "Other", icon: MessageSquare, placeholder: "Anything on your mind." },
];

/** Mounted once at the app root; opened with openFeedback(). */
export function FeedbackHost() {
    const [open, setOpen] = useState(false);
    const [kind, setKind] = useState<FeedbackKind>("bug");
    const [message, setMessage] = useState("");
    const [email, setEmail] = useState("");
    const [attach, setAttach] = useState(true);
    const [crash, setCrash] = useState<CrashReport | null>(null);
    const [diagnostics, setDiagnostics] = useState<unknown>(null);
    const [showDiag, setShowDiag] = useState(false);
    const [state, setState] = useState<"idle" | "sending" | "sent" | "failed">("idle");

    useEffect(() => {
        const onOpen = (e: Event) => {
            const req = (e as CustomEvent<FeedbackRequest>).detail ?? {};
            setKind(req.kind ?? "bug");
            setMessage(req.message ?? "");
            setCrash(req.crash ?? null);
            setAttach(true);
            setShowDiag(false);
            setState("idle");
            setOpen(true);
            track("feedback_opened", { kind: req.kind ?? "bug", crash: !!req.crash });
        };
        window.addEventListener("devian-feedback", onOpen);
        return () => window.removeEventListener("devian-feedback", onOpen);
    }, []);

    useEffect(() => {
        if (open) collectDiagnostics(crash).then(setDiagnostics);
    }, [open, crash]);

    const current = KINDS.find(k => k.id === kind)!;
    const canSend = message.trim().length > 0 || !!crash;

    const send = async () => {
        setState("sending");
        try {
            await sendFeedback({ kind, message: message.trim(), email: email.trim() || undefined, diagnostics: attach ? diagnostics : undefined });
            setState("sent");
        } catch {
            setState("failed");
        }
    };

    const github = async () => {
        const url = await githubIssueUrl(kind, message.trim(), attach ? crash : null);
        openUrl(url).catch(() => { /* no browser */ });
        setOpen(false);
    };

    return (
        <Dialog.Root open={open} onOpenChange={setOpen}>
            <Dialog.Portal>
                <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=open]:fade-in-0" />
                <Dialog.Content className="fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 w-[min(560px,92vw)] max-h-[88vh] overflow-y-auto rounded-2xl border border-white/10 bg-zinc-950 shadow-2xl outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-[0.98]">
                    <div className="flex items-center gap-2 px-5 h-14 border-b border-white/[0.06]">
                        <Dialog.Title className="text-sm font-semibold text-white flex-1">{crash ? "Report a problem" : "Send feedback"}</Dialog.Title>
                        <Dialog.Close className="p-1.5 rounded-md text-zinc-500 hover:text-white hover:bg-white/10" aria-label="Close"><X className="h-4 w-4" /></Dialog.Close>
                    </div>

                    {state === "sent" ? (
                        <div className="px-5 py-10 text-center space-y-3">
                            <div className="mx-auto h-10 w-10 rounded-full bg-emerald-500/15 flex items-center justify-center"><Check className="h-5 w-5 text-emerald-400" /></div>
                            <p className="text-sm font-medium text-white">Thanks, we got it.</p>
                            <Dialog.Description className="text-xs text-zinc-500">
                                {email ? "We'll reply by email if we have questions." : "Every message is read. Add an email next time if you'd like a reply."}
                            </Dialog.Description>
                            <Button size="sm" variant="secondary" onClick={() => setOpen(false)}>Done</Button>
                        </div>
                    ) : (
                        <div className="px-5 py-4 space-y-4">
                            <Dialog.Description className="sr-only">Tell the Devian team about a problem or an idea.</Dialog.Description>
                            {crash && (
                                <p className="text-xs text-amber-300/90 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
                                    Devian hit an internal error on {new Date(crash.at).toLocaleString()}. The error report is attached below; add what you were doing if you remember.
                                </p>
                            )}
                            <div role="radiogroup" aria-label="Type of feedback" className="grid grid-cols-3 gap-2">
                                {KINDS.map(k => (
                                    <button
                                        key={k.id}
                                        role="radio"
                                        aria-checked={kind === k.id}
                                        onClick={() => setKind(k.id)}
                                        className={`flex items-center justify-center gap-1.5 h-9 rounded-lg border text-xs font-medium transition-colors ${kind === k.id ? "border-primary/50 bg-primary/10 text-white" : "border-white/10 text-zinc-400 hover:text-white hover:bg-white/[0.04]"}`}
                                    >
                                        <k.icon className="h-3.5 w-3.5" /> {k.label}
                                    </button>
                                ))}
                            </div>

                            <textarea
                                autoFocus
                                value={message}
                                onChange={e => setMessage(e.target.value)}
                                placeholder={current.placeholder}
                                aria-label="Your message"
                                rows={5}
                                className="w-full rounded-lg bg-white/[0.03] border border-white/10 px-3 py-2 text-sm text-white placeholder:text-zinc-500 outline-none focus:border-white/25 resize-y"
                            />

                            {telemetryConfigured && (
                                <input
                                    type="email"
                                    value={email}
                                    onChange={e => setEmail(e.target.value)}
                                    placeholder="Email, if you'd like a reply (optional)"
                                    aria-label="Email (optional)"
                                    className="w-full h-9 rounded-lg bg-white/[0.03] border border-white/10 px-3 text-sm text-white placeholder:text-zinc-500 outline-none focus:border-white/25"
                                />
                            )}

                            <div className="rounded-lg border border-white/[0.06]">
                                <div className="flex items-center gap-2 px-3 py-2">
                                    <input id="fb-attach" type="checkbox" checked={attach} onChange={e => setAttach(e.target.checked)} className="accent-[var(--color-primary)]" />
                                    <label htmlFor="fb-attach" className="text-xs text-zinc-300 flex-1">Include app version, OS and recent errors</label>
                                    <button onClick={() => setShowDiag(v => !v)} className="text-[11px] text-zinc-500 hover:text-white inline-flex items-center gap-0.5" aria-expanded={showDiag}>
                                        See what's included <ChevronRight className={`h-3 w-3 transition-transform ${showDiag ? "rotate-90" : ""}`} />
                                    </button>
                                </div>
                                {showDiag && (
                                    <pre className="max-h-48 overflow-auto border-t border-white/[0.06] px-3 py-2 text-[11px] leading-relaxed text-zinc-400 whitespace-pre-wrap break-all">
                                        {JSON.stringify(diagnostics, null, 2)}
                                    </pre>
                                )}
                            </div>
                            <p className="text-[11px] text-zinc-600 leading-relaxed">
                                Never included: your code, prompts, agent history, memory or file contents. Your home folder is replaced with ~.
                            </p>

                            {state === "failed" && (
                                <p className="text-xs text-amber-300">Couldn't send it. Check your connection, or open it on GitHub instead.</p>
                            )}

                            <div className="flex items-center justify-end gap-2 pt-1">
                                {telemetryConfigured ? (
                                    <>
                                        <Button size="sm" variant="ghost" onClick={github} disabled={!canSend}><ExternalLink /> Open on GitHub</Button>
                                        <Button size="sm" onClick={send} disabled={!canSend || state === "sending"}>
                                            {state === "sending" && <Loader2 className="animate-spin" />} Send
                                        </Button>
                                    </>
                                ) : (
                                    <Button size="sm" onClick={github} disabled={!canSend}><ExternalLink /> Continue on GitHub</Button>
                                )}
                            </div>
                        </div>
                    )}
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}
