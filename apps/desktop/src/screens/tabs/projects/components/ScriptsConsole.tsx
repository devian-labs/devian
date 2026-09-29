import { PlayCircle, Square, ExternalLink, Terminal } from "lucide-react";
import { LocalProject, RunningScript } from "../types";
import { openUrl } from "@tauri-apps/plugin-opener";
import { isLikelyStartScript, sortProjectScripts } from "../utils";

interface ScriptsConsoleProps {
    project: LocalProject;
    runningScripts: Map<string, RunningScript>;
    scriptConsole: Map<string, string[]>;
    activeConsoleKey: string | null;
    onSetActiveConsole: (key: string) => void;
    onRunScript: (path: string, script: string) => void;
}

export function ScriptsConsole({
    project,
    runningScripts,
    scriptConsole,
    activeConsoleKey,
    // Kept for API compatibility, but functionally unlocked
    onSetActiveConsole,
    onRunScript,
    
}: ScriptsConsoleProps) {
    if (!project.scripts || project.scripts.length === 0) {
        return (
            <div className="bg-surface-a10 border border-white/5 rounded-lg p-4 flex flex-col items-center justify-center gap-2 shadow-xs h-full text-center">
                <Terminal className="h-8 w-8 text-muted-foreground/30 mb-2" />
                <p className="text-sm font-semibold text-white">No Scripts Found</p>
                <p className="text-xs text-muted-foreground max-w-[200px]">Add scripts to package.json to run them from Devian.</p>
            </div>
        );
    }

    const sortedScripts = sortProjectScripts(project.scripts);

    return (
        <div className="bg-surface-a10 border border-white/5 rounded-lg p-4 flex flex-col gap-3 shadow-xs h-full max-h-88">
            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 border-b border-white/5 pb-3">
                <h3 className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5 shrink-0 mt-1">
                    <Terminal className="h-3.5 w-3.5 text-emerald-400" />
                    Scripts & Console
                </h3>
                <div className="flex flex-wrap items-center justify-end gap-1.5 flex-1">
                    {sortedScripts.map((script, i) => {
                        const key = `${project.path}::${script}`;
                        const running = runningScripts.get(key);
                        const isActive = activeConsoleKey === key;
                        const shouldShowPort = running && running.port;
                        const roundedClass = shouldShowPort ? "rounded-l" : "rounded";
                        const borderRightClass = shouldShowPort ? "border-r-0" : "";
                        const likelyStart = isLikelyStartScript(script);

                        return (
                            <div key={i} className="flex items-center gap-0.5">
                                <button
                                    onClick={() => {
                                        onSetActiveConsole(key);
                                        if (!running) onRunScript(project.path, script);
                                    }}
                                    className={`text-[10px] px-2 py-1 ${roundedClass} border ${borderRightClass} transition-colors flex items-center gap-1 
                                    ${running ? "bg-emerald-500/15 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/25" :
                                        isActive ? "bg-primary/20 border-primary/30 text-primary" : "bg-white/5 border-white/10 text-white hover:bg-white/10"
                                        }`}
                                    title={`View console or run: npm run ${script}`}
                                >
                                    {running && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />}
                                    {!running && <PlayCircle className="h-2.5 w-2.5" />}
                                    {script}
                                    {likelyStart && (
                                        <span className="ml-1 rounded bg-emerald-500/15 px-1 py-0.5 text-[9px] font-semibold text-emerald-300 border border-emerald-500/20">
                                            Start
                                        </span>
                                    )}
                                </button>

                                {/* Stop button (distinct) */}
                                {running && !shouldShowPort && (
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            onRunScript(project.path, script);
                                        }}
                                        className="text-[10px] px-2 py-1 rounded-r bg-red-500/15 border border-l-0 border-red-500/30 text-red-400 hover:bg-red-500/25 transition-colors"
                                        title={`Click to stop (PID ${running.pid})`}
                                    >
                                        <Square className="h-2.5 w-2.5" />
                                    </button>
                                )}

                                {/* Port button - ONLY render if active port exists */}
                                {shouldShowPort && (
                                    <div className="flex items-center h-full">
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                onRunScript(project.path, script);
                                            }}
                                            className="h-full text-[10px] px-1.5 py-1 bg-red-500/15 border-y border-red-500/30 text-red-400 hover:bg-red-500/25 transition-colors"
                                            title={`Click to stop (PID ${running.pid})`}
                                        >
                                            <Square className="h-2.5 w-2.5" />
                                        </button>
                                        <button
                                            onClick={() => openUrl(`http://localhost:${running.port}`)}
                                            className={`h-full text-[10px] px-1.5 py-1 rounded-r border border-l-0 transition-colors flex items-center gap-1 border-emerald-500/30 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20`}
                                            title={`Open localhost:${running.port}`}
                                        >
                                            <ExternalLink className="h-2.5 w-2.5" />
                                            {`Port`}
                                        </button>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Active Console output area */}
            {activeConsoleKey ? (
                <div className="bg-black/40 border border-white/5 rounded flex-1 overflow-y-auto p-3 font-mono text-[11px] text-muted-foreground leading-relaxed flex flex-col gap-1 w-full min-h-[140px]">
                    {scriptConsole.get(activeConsoleKey)?.map((line, i) => (
                        <div key={i} className="whitespace-pre-wrap break-all">{line}</div>
                    ))}
                    {(!scriptConsole.get(activeConsoleKey) || scriptConsole.get(activeConsoleKey)!.length === 0) && (
                        <div className="italic text-muted-foreground/50">Ready. Click a script to run.</div>
                    )}
                </div>
            ) : (
                <div className="bg-black/40 border border-white/5 rounded flex-1 min-h-[140px] flex items-center justify-center p-3 font-mono text-[11px] text-muted-foreground/50 w-full italic">
                    Select a script to view console output
                </div>
            )}
        </div>
    );
}
