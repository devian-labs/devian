import { useState } from "react";
import { BrainCircuit, Sparkles, ChevronDown, ChevronRight, Loader2, Copy, BarChart3, Scale, GitCompareArrows, Flame, RefreshCw, Layers } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AppMarkdown } from "@/components/markdown/AppMarkdown";
import { LocalProject, RepoInsights, RepoInsightFile } from "../types";
import { formatBytes } from "../utils";

function InsightsList({
    icon: Icon, title, emptyLabel, files, metricLabel, metricValue,
}: {
    icon: typeof Scale;
    title: string;
    emptyLabel: string;
    files: RepoInsightFile[];
    metricLabel: string;
    metricValue: (f: RepoInsightFile) => string;
}) {
    return (
        <div className="bg-black/20 border border-white/5 rounded-lg p-3">
            <div className="flex items-center gap-2 mb-2.5">
                <Icon className="h-3.5 w-3.5 text-primary" />
                <h4 className="text-xs font-semibold text-white">{title}</h4>
            </div>
            {files.length === 0 ? (
                <p className="text-xs text-zinc-600">{emptyLabel}</p>
            ) : (
                <div className="space-y-2">
                    {files.map((file, i) => (
                        <div key={i} className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                                <p className="text-xs text-white truncate">{file.path}</p>
                                <p className="text-[10px] text-zinc-500">
                                    {file.line_count.toLocaleString()} lines{file.size_bytes > 0 ? ` · ${formatBytes(file.size_bytes)}` : ""}
                                </p>
                            </div>
                            <div className="shrink-0 text-right">
                                <p className="text-xs font-semibold text-primary">{metricValue(file)}</p>
                                <p className="text-[10px] text-zinc-600">{metricLabel}</p>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

interface ProjectIntelligenceProps {
    project: LocalProject;
    aiSummary: string;
    aiLoading: boolean;
    onGenerateSummary: (project: LocalProject) => void;
    repoInsights: RepoInsights | null;
    repoInsightsLoading: boolean;
    repoInsightsError: string;
    onAnalyzeRepo: () => void;
}

export function ProjectIntelligence({
    project,
    aiSummary,
    aiLoading,
    onGenerateSummary,
    repoInsights,
    repoInsightsLoading,
    repoInsightsError,
    onAnalyzeRepo,
}: ProjectIntelligenceProps) {
    const [codeAnalysisOpen, setCodeAnalysisOpen] = useState(false);

    const handleGenerate = () => {
        onGenerateSummary(project);
    };

    return (
        <div className="bg-zinc-900 border border-white/5 rounded-xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
                <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                    <BrainCircuit className="h-4 w-4 text-violet-400" />
                    Project Intelligence
                </h3>
                <div className="flex items-center gap-2">
                    {aiSummary && (
                        <Button
                            variant="ghost" size="sm"
                            className="h-7 w-7 p-0 text-zinc-500 hover:text-white"
                            onClick={() => navigator.clipboard.writeText(aiSummary)}
                            title="Copy"
                        >
                            <Copy className="h-3.5 w-3.5" />
                        </Button>
                    )}
                    <Button
                        variant="outline" size="sm"
                        className="h-7 text-xs border-violet-500/20 text-violet-300 hover:bg-violet-500/10"
                        onClick={handleGenerate}
                        disabled={aiLoading}
                    >
                        {aiLoading ? (
                            <><Loader2 className="h-3 w-3 mr-1 animate-spin" /> Analyzing...</>
                        ) : (
                            <><Sparkles className="h-3 w-3 mr-1" />{aiSummary ? "Refresh" : "Generate"}</>
                        )}
                    </Button>
                </div>
            </div>

            <div className="p-4">
                {aiLoading ? (
                    <div className="space-y-3 animate-pulse">
                        <div className="h-3 bg-white/5 rounded w-1/3" />
                        <div className="h-3 bg-white/5 rounded w-full" />
                        <div className="h-3 bg-white/5 rounded w-4/5" />
                        <div className="h-3 bg-white/5 rounded w-2/3 mt-4" />
                        <div className="h-3 bg-white/5 rounded w-full" />
                    </div>
                ) : aiSummary ? (
                    <div className="text-sm leading-relaxed prose prose-invert prose-sm max-w-none
                        prose-p:text-zinc-400 prose-p:my-2
                        prose-strong:text-zinc-100 prose-strong:font-semibold
                        prose-ul:my-2 prose-li:my-1 prose-li:text-zinc-400
                        prose-headings:text-violet-400 prose-headings:font-semibold prose-headings:text-sm prose-headings:mt-4 prose-headings:mb-2">
                        <AppMarkdown
                            content={aiSummary}
                            components={{
                                h2: ({ node, ...props }) => <h2 className="text-violet-400 text-sm font-semibold mt-4 mb-1 flex items-center gap-2" {...props} />,
                                h3: ({ node, ...props }) => <h3 className="text-emerald-400 text-xs font-semibold mt-3 mb-1 uppercase tracking-wide" {...props} />,
                                strong: ({ node, ...props }) => {
                                    const content = String(props.children);
                                    return <strong className={content.includes(':') ? "text-zinc-300 font-semibold" : "text-white font-semibold"} {...props} />;
                                },
                                ul: ({ node, ...props }) => <ul className="space-y-1 my-2 list-none pl-0" {...props} />,
                                li: ({ node, ...props }) => <li className="flex items-start gap-2 text-zinc-400 before:content-['·'] before:text-violet-500/50 before:font-bold before:shrink-0" {...props} />,
                            }}
                        />
                    </div>
                ) : (
                    <div className="flex flex-col items-center justify-center py-8 text-center">
                        <BrainCircuit className="h-10 w-10 text-violet-500/20 mb-3" />
                        <p className="text-sm text-white font-medium">No intelligence generated yet.</p>
                        <p className="text-xs text-zinc-500 mt-1 max-w-xs">
                            Generate a purpose summary, stack analysis, maintenance status, and archive recommendation.
                        </p>
                        <Button
                            variant="outline" size="sm"
                            className="mt-4 border-violet-500/20 text-violet-300 hover:bg-violet-500/10"
                            onClick={handleGenerate}
                        >
                            <Sparkles className="h-3.5 w-3.5 mr-1.5" />
                            Generate Project Intelligence
                        </Button>
                    </div>
                )}

                {/* Detected frameworks + gems */}
                {(project.frameworks?.length > 0 || project.gem_count > 0) && (
                    <div className="mt-4 border-t border-white/5 pt-3">
                        <div className="flex items-center gap-2 mb-2.5">
                            <Layers className="h-3.5 w-3.5 text-zinc-500" />
                            <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">
                                Detected Frameworks & Libraries
                            </span>
                            {project.gem_count > 0 && (
                                <span className="ml-auto text-[10px] text-zinc-600">{project.gem_count} gems total</span>
                            )}
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                            {(project.frameworks || []).map((fw, i) => (
                                <span
                                    key={i}
                                    title={`${fw.name} ${fw.version}`}
                                    className="text-[11px] font-medium px-2 py-0.5 rounded-md border bg-zinc-800 border-zinc-700 text-zinc-300"
                                >
                                    {fw.name}
                                    {fw.version && (
                                        <span className="text-zinc-600 ml-1 font-normal">
                                            {fw.version.replace(/[\^~>=<]/g, "").split(",")[0].trim()}
                                        </span>
                                    )}
                                </span>
                            ))}
                        </div>
                    </div>
                )}

                {/* Code analysis — optional expand */}
                <div className="mt-4 border-t border-white/5 pt-3">
                    <button
                        onClick={() => {
                            if (!codeAnalysisOpen && !repoInsights && !repoInsightsLoading) {
                                onAnalyzeRepo();
                            }
                            setCodeAnalysisOpen(v => !v);
                        }}
                        className="flex items-center gap-2 text-xs text-zinc-500 hover:text-zinc-300 transition-colors w-full"
                    >
                        {codeAnalysisOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                        <BarChart3 className="h-3.5 w-3.5" />
                        Code Analysis
                        {repoInsightsLoading && <Loader2 className="h-3 w-3 animate-spin ml-1" />}
                        {repoInsights && (
                            <>
                                <span className="ml-auto text-zinc-600">
                                    {repoInsights.total_lines_of_code.toLocaleString()} lines
                                </span>
                                <Button
                                    variant="ghost" size="sm"
                                    className="h-5 w-5 p-0 text-zinc-600 hover:text-zinc-400 ml-1"
                                    onClick={e => { e.stopPropagation(); onAnalyzeRepo(); }}
                                    title="Re-analyze"
                                >
                                    <RefreshCw className="h-3 w-3" />
                                </Button>
                            </>
                        )}
                    </button>

                    {codeAnalysisOpen && repoInsightsLoading && (
                        <div className="mt-3 flex items-center gap-2 text-xs text-zinc-500 py-4 justify-center">
                            <Loader2 className="h-4 w-4 animate-spin" /> Crunching repository stats...
                        </div>
                    )}

                    {codeAnalysisOpen && !repoInsights && !repoInsightsLoading && !repoInsightsError && (
                        <div className="mt-3 text-xs text-zinc-600 text-center py-4 border border-dashed border-white/5 rounded-lg">
                            Run analysis to surface codebase hotspots and Git churn.
                        </div>
                    )}

                    {codeAnalysisOpen && !repoInsights && !repoInsightsLoading && repoInsightsError && (
                        <p className="text-xs text-red-400 mt-2">{repoInsightsError}</p>
                    )}

                    {codeAnalysisOpen && repoInsights && (
                        <div className="mt-3 space-y-2">
                            {/* Summary stats */}
                            <div className="grid grid-cols-3 gap-2">
                                <div className="bg-black/20 border border-white/5 rounded-lg px-3 py-2">
                                    <p className="text-[10px] text-zinc-500">Lines of Code</p>
                                    <p className="text-base font-bold text-white mt-0.5">{repoInsights.total_lines_of_code.toLocaleString()}</p>
                                </div>
                                <div className="bg-black/20 border border-white/5 rounded-lg px-3 py-2">
                                    <p className="text-[10px] text-zinc-500">Largest File</p>
                                    <p className="text-xs font-medium text-white mt-0.5 truncate">{repoInsights.largest_files[0]?.path.split("/").pop() ?? "—"}</p>
                                </div>
                                <div className="bg-black/20 border border-white/5 rounded-lg px-3 py-2">
                                    <p className="text-[10px] text-zinc-500">Top Hotspot</p>
                                    <p className="text-xs font-medium text-white mt-0.5 truncate">{repoInsights.hotspots[0]?.path.split("/").pop() ?? "—"}</p>
                                </div>
                            </div>
                            {/* Three detail cards */}
                            <div className="grid grid-cols-1 xl:grid-cols-3 gap-2">
                                <InsightsList
                                    icon={Scale}
                                    title="Largest Files"
                                    emptyLabel="No files found in size scan."
                                    files={repoInsights.largest_files}
                                    metricLabel="size"
                                    metricValue={f => formatBytes(f.size_bytes)}
                                />
                                <InsightsList
                                    icon={GitCompareArrows}
                                    title="Top Changed Files"
                                    emptyLabel="No file history found in Git."
                                    files={repoInsights.most_modified_files}
                                    metricLabel="commits"
                                    metricValue={f => f.change_count.toLocaleString()}
                                />
                                <InsightsList
                                    icon={Flame}
                                    title="Hotspots"
                                    emptyLabel="Not enough history to rank hotspots."
                                    files={repoInsights.hotspots}
                                    metricLabel="hotspot"
                                    metricValue={f => f.hotspot_score.toFixed(1)}
                                />
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
