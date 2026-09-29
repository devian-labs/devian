import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import {
    AlertCircle, CheckCircle2, Download,
    Loader2, Power, PowerOff, Sparkles, Trash2, Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";

interface AIControlsPanelProps {
    setActiveTab?: (tab: string) => void;
}

interface ModelStatus { exists: boolean; size_bytes: number; path: string; }
interface DownloadProgress { downloaded: number; total: number; percent: number; }
interface ServerStatus { running: boolean; model_loaded: boolean; binary_exists: boolean; }
type DownloadState = "idle" | "downloading" | "completed" | "error";

let moduleDownloading = false;
let moduleProgress: DownloadProgress = { downloaded: 0, total: 0, percent: 0 };
let moduleDownloadPromise: Promise<void> | null = null;
let moduleUnlisten: UnlistenFn | null = null;

function formatBytes(bytes: number): string {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

export function AIControlsPanel({ }: AIControlsPanelProps) {
    const mountedRef = useRef(true);

    const [modelStatus, setModelStatus] = useState<ModelStatus | null>(null);
    const [downloadState, setDownloadState] = useState<DownloadState>(moduleDownloading ? "downloading" : "idle");
    const [progress, setProgress] = useState<DownloadProgress>(moduleProgress);
    const [error, setError] = useState("");
    // Start as false if a download is already in progress (skip the model check on remount)
    const [checking, setChecking] = useState(!moduleDownloading);
    const [serverStatus, setServerStatus] = useState<ServerStatus>({ running: false, model_loaded: false, binary_exists: false });
    const [serverStarting, setServerStarting] = useState(false);
    const [serverStopping, setServerStopping] = useState(false);
    const [serverBinaryDownloading, setServerBinaryDownloading] = useState(false);
    const [serverMessage, setServerMessage] = useState("");

    useEffect(() => {
        mountedRef.current = true;
        if (moduleDownloading) {
            setDownloadState("downloading");
            setProgress(moduleProgress);
            const interval = setInterval(() => {
                if (mountedRef.current) setProgress({ ...moduleProgress });
            }, 250);
            if (moduleDownloadPromise) {
                moduleDownloadPromise
                    .then(() => { if (!mountedRef.current) return; clearInterval(interval); setDownloadState("completed"); checkModelStatus(); })
                    .catch((e: unknown) => { if (!mountedRef.current) return; clearInterval(interval); setDownloadState("error"); setError(typeof e === "string" ? e : "Download failed"); });
            }
            return () => { mountedRef.current = false; clearInterval(interval); };
        }
        checkModelStatus();
        return () => { mountedRef.current = false; };
    }, []);

    useEffect(() => {
        if (downloadState !== "completed") return;
        checkServerStatus();
        const interval = setInterval(() => { if (mountedRef.current) checkServerStatus(); }, 5000);
        return () => clearInterval(interval);
    }, [downloadState]);

    async function checkModelStatus() {
        setChecking(true);
        try {
            const status = await invoke<ModelStatus>("check_model_status");
            if (!mountedRef.current) return;
            setModelStatus(status);
            if (status.exists) setDownloadState("completed");
        } catch {}
        finally { if (mountedRef.current) setChecking(false); }
    }

    async function checkServerStatus() {
        try {
            const status = await invoke<ServerStatus>("check_llama_server_status");
            if (mountedRef.current) setServerStatus(status);
        } catch {}
    }

    async function handleDownload() {
        setDownloadState("downloading"); setError("");
        setProgress({ downloaded: 0, total: 0, percent: 0 });
        moduleDownloading = true;
        moduleProgress = { downloaded: 0, total: 0, percent: 0 };
        try {
            if (moduleUnlisten) moduleUnlisten();
            moduleUnlisten = await listen<DownloadProgress>("model-download-progress", (event) => {
                if (event.payload.downloaded >= moduleProgress.downloaded) {
                    moduleProgress = event.payload;
                    if (mountedRef.current) setProgress(event.payload);
                }
            });
            moduleDownloadPromise = invoke("download_model");
            await moduleDownloadPromise;
            moduleDownloading = false; moduleDownloadPromise = null;
            if (moduleUnlisten) { moduleUnlisten(); moduleUnlisten = null; }
            invoke("show_notification", { title: "Model Downloaded", body: "The AI model is ready. Start the server to begin chatting." }).catch(() => {});
            if (mountedRef.current) { setDownloadState("completed"); await checkModelStatus(); }
        } catch (e: any) {
            moduleDownloading = false; moduleDownloadPromise = null;
            if (moduleUnlisten) { moduleUnlisten(); moduleUnlisten = null; }
            const errMsg = typeof e === "string" ? e : e?.message || "Download failed";
            invoke("show_notification", { title: "Download Failed", body: errMsg }).catch(() => {});
            if (mountedRef.current) { setDownloadState("error"); setError(errMsg); }
        }
    }

    async function handleDelete() {
        try {
            if (serverStatus.running) await invoke("stop_llama_server").catch(() => {});
            await invoke("delete_model");
            setModelStatus(null); setDownloadState("idle");
            setProgress({ downloaded: 0, total: 0, percent: 0 });
            setServerStatus(c => ({ ...c, running: false, model_loaded: false }));
        } catch {}
    }

    async function handleStartServer() {
        setServerStarting(true); setServerMessage("");
        try {
            if (!serverStatus.binary_exists) {
                setServerBinaryDownloading(true);
                setServerMessage("Downloading AI engine...");
                const u = await listen<string>("llama-server-download", (e) => { if (mountedRef.current) setServerMessage(e.payload); });
                await invoke("download_llama_server");
                u();
                setServerBinaryDownloading(false);
            }
            setServerMessage("Loading model into memory…");
            await invoke("start_llama_server");
            invoke("show_notification", { title: "Local model started", body: "The local model is ready for project summaries." }).catch(() => {});
            if (mountedRef.current) { setServerMessage(""); await checkServerStatus(); }
        } catch (e: any) {
            const msg = typeof e === "string" ? e : (e as any)?.message || "Unable to start";
            // Server may still be loading — keep polling for another 60 s before giving up
            if (mountedRef.current) setServerMessage("Still loading, please wait…");
            let started = false;
            for (let i = 0; i < 12 && mountedRef.current; i++) {
                await new Promise(r => setTimeout(r, 5000));
                try {
                    const status = await invoke<ServerStatus>("check_llama_server_status");
                    if (status.running) {
                        if (mountedRef.current) { setServerStatus(status); setServerMessage(""); started = true; }
                        invoke("show_notification", { title: "Local model started", body: "The local AI runtime is ready." }).catch(() => {});
                        break;
                    }
                } catch {}
            }
            if (!started && mountedRef.current) {
                setServerMessage(`Could not confirm server started. ${msg.includes("90 seconds") ? "Try again — loading large models can take time." : msg}`);
            }
        } finally {
            if (mountedRef.current) { setServerStarting(false); setServerBinaryDownloading(false); }
        }
    }

    async function handleStopServer() {
        setServerStopping(true);
        try {
            await invoke("stop_llama_server");
            if (mountedRef.current) setServerStatus(c => ({ ...c, running: false, model_loaded: false }));
        } catch {}
        finally { if (mountedRef.current) setServerStopping(false); }
    }

    const modelReady = downloadState === "completed" && !!modelStatus?.exists;

    return (
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl overflow-hidden divide-y divide-zinc-800">

            {/* Step 1: Model */}
            <div className="p-5 space-y-4">
                <div className="flex items-start justify-between gap-3">
                    <div>
                        <div className="flex items-center gap-2 mb-0.5">
                            <span className={`h-5 w-5 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 ${modelReady ? "bg-emerald-500/20 text-emerald-400" : "bg-zinc-800 text-zinc-400"}`}>
                                {modelReady ? "✓" : "1"}
                            </span>
                            <span className="text-sm font-semibold text-white">Download Model</span>
                        </div>
                        <p className="text-xs text-zinc-500 ml-7">
                            Qwen3 4B Instruct · Q4_K_M · ~2.6 GB · runs fully on-device
                        </p>
                    </div>
                    {modelReady && (
                        <button onClick={handleDelete} className="text-zinc-600 hover:text-red-400 transition-colors shrink-0" title="Remove model">
                            <Trash2 className="h-4 w-4" />
                        </button>
                    )}
                </div>

                {checking ? (
                    <div className="flex items-center gap-2 text-xs text-zinc-600 ml-7">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking...
                    </div>
                ) : modelReady ? (
                    <div className="ml-7 flex items-center gap-2 text-xs text-emerald-400">
                        <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                        Model ready · {formatBytes(modelStatus!.size_bytes)}
                    </div>
                ) : downloadState === "downloading" ? (
                    <div className="ml-7 space-y-2">
                        <div className="flex items-center justify-between text-xs">
                            <span className="text-zinc-400 flex items-center gap-1.5">
                                <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                                {progress.percent >= 99.5 ? "Finalizing..." : "Downloading..."}
                            </span>
                            <span className="text-zinc-600">{formatBytes(progress.downloaded)} / {formatBytes(progress.total)}</span>
                        </div>
                        <Progress value={Math.min(progress.percent, 100)} className="h-1.5 bg-white/5" />
                    </div>
                ) : downloadState === "error" ? (
                    <div className="ml-7 space-y-2">
                        <p className="text-xs text-red-400 flex items-center gap-1.5">
                            <AlertCircle className="h-3.5 w-3.5 shrink-0" /> {error}
                        </p>
                        <Button size="sm" variant="outline" onClick={handleDownload} className="border-white/10 text-white hover:bg-white/5 h-7 text-xs">
                            <Download className="h-3.5 w-3.5 mr-1" /> Retry
                        </Button>
                    </div>
                ) : (
                    <div className="ml-7">
                        <Button size="sm" onClick={handleDownload} className="h-8 text-xs gap-2">
                            <Download className="h-3.5 w-3.5" /> Download Model
                        </Button>
                    </div>
                )}
            </div>

            {/* Step 2: Server */}
            <div className={`p-5 space-y-4 ${!modelReady ? "opacity-40 pointer-events-none" : ""}`}>
                <div>
                    <div className="flex items-center gap-2 mb-0.5">
                        <span className={`h-5 w-5 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 ${serverStatus.running ? "bg-emerald-500/20 text-emerald-400" : "bg-zinc-800 text-zinc-400"}`}>
                            {serverStatus.running ? "✓" : "2"}
                        </span>
                        <span className="text-sm font-semibold text-white">Start local model</span>
                    </div>
                    <p className="text-xs text-zinc-500 ml-7">
                        Local inference server on port 8413 · {serverStatus.binary_exists ? "engine ready" : "engine downloads on first start"}
                    </p>
                </div>

                <div className="ml-7">
                    {serverStatus.running ? (
                        <div className="flex items-center justify-between gap-3 bg-emerald-500/5 border border-emerald-500/20 rounded-lg px-4 py-3">
                            <div className="flex items-center gap-2">
                                <Zap className="h-4 w-4 text-emerald-400 shrink-0" />
                                <div>
                                    <p className="text-sm font-medium text-white">AI ready</p>
                                    <p className="text-xs text-zinc-500">Port 8413 · all AI features active</p>
                                </div>
                            </div>
                            <Button
                                size="sm" variant="outline"
                                onClick={handleStopServer} disabled={serverStopping}
                                className="border-white/10 text-zinc-400 hover:text-white hover:bg-white/5 h-7 text-xs"
                            >
                                {serverStopping ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <PowerOff className="h-3.5 w-3.5 mr-1" />}
                                Stop
                            </Button>
                        </div>
                    ) : (
                        <div className="space-y-2">
                            <Button size="sm" onClick={handleStartServer} disabled={serverStarting} className="h-8 text-xs gap-2">
                                {serverStarting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Power className="h-3.5 w-3.5" />}
                                {serverStarting
                                    ? (serverBinaryDownloading ? "Downloading engine..." : "Starting...")
                                    : "Start local model"}
                            </Button>
                            {serverMessage && (
                                <p className={`text-xs ${serverMessage.startsWith("Failed") ? "text-red-400" : "text-zinc-500"}`}>
                                    {serverMessage}
                                </p>
                            )}
                        </div>
                    )}
                </div>
            </div>

            {/* Footer */}
            <div className="px-5 py-3 flex items-start gap-2">
                <Sparkles className="h-3.5 w-3.5 text-zinc-600 shrink-0 mt-0.5" />
                <p className="text-xs text-zinc-600">
                    Summaries run entirely on this machine. Nothing is sent anywhere.
                </p>
            </div>
        </div>
    );
}
