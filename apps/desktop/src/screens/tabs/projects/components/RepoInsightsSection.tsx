import { BarChart3, Flame, GitCompareArrows, Loader2, RefreshCw, Scale } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RepoInsightFile, RepoInsights } from "../types";
import { formatBytes } from "../utils";

interface RepoInsightsSectionProps {
    insights: RepoInsights | null;
    loading: boolean;
    error: string;
    onAnalyze: () => void;
}

function InsightsList({
    icon: Icon,
    title,
    emptyLabel,
    files,
    metricLabel,
    metricValue,
}: {
    icon: typeof Scale;
    title: string;
    emptyLabel: string;
    files: RepoInsightFile[];
    metricLabel: string;
    metricValue: (file: RepoInsightFile) => string;
}) {
    return (
        <div className="bg-black/20 border border-white/5 rounded-lg p-4">
            <div className="flex items-center gap-2 mb-3">
                <Icon className="h-4 w-4 text-primary" />
                <h4 className="text-sm font-semibold text-white">{title}</h4>
            </div>
            {files.length === 0 ? (
                <p className="text-sm text-muted-foreground">{emptyLabel}</p>
            ) : (
                <div className="space-y-2">
                    {files.map((file) => (
                        <div key={`${title}-${file.path}`} className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                                <p className="text-sm text-white truncate">{file.path}</p>
                                <p className="text-[11px] text-muted-foreground">
                                    {file.line_count.toLocaleString()} lines
                                    {file.size_bytes > 0 ? ` • ${formatBytes(file.size_bytes)}` : ""}
                                </p>
                            </div>
                            <div className="shrink-0 text-right">
                                <p className="text-sm font-medium text-primary">{metricValue(file)}</p>
                                <p className="text-[11px] text-muted-foreground">{metricLabel}</p>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

export function RepoInsightsSection({
    insights,
    loading,
    error,
    onAnalyze,
}: RepoInsightsSectionProps) {
    return (
        <div className="space-y-3">
            <div className="bg-surface-a10 border border-white/5 rounded-lg p-4 shadow-xs">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="space-y-1">
                        <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                            <BarChart3 className="h-4 w-4 text-primary" />
                            Repository Insights
                        </h3>
                        <p className="text-xs text-muted-foreground">
                            Analyze code volume, large files, churn, and change hotspots for this repo.
                        </p>
                    </div>
                    <Button
                        variant="outline"
                        size="sm"
                        className="border-white/10 text-white hover:bg-white/10 self-start sm:self-auto"
                        onClick={onAnalyze}
                        disabled={loading}
                    >
                        {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
                        {insights ? "Analyze Again" : "Analyze"}
                    </Button>
                </div>

                {error && (
                    <div className="mt-3 rounded-md border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-200">
                        {error}
                    </div>
                )}

                {!insights && !loading && !error && (
                    <div className="mt-3 rounded-md border border-dashed border-white/10 bg-black/10 px-4 py-6 text-sm text-muted-foreground text-center">
                        Run analysis to surface codebase hotspots and Git churn.
                    </div>
                )}

                {loading && !insights && (
                    <div className="mt-3 flex items-center justify-center gap-2 rounded-md border border-white/5 bg-black/10 px-4 py-6 text-sm text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Crunching repository stats...
                    </div>
                )}
            </div>

            {insights && (
                <>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <div className="bg-surface-a10 border border-white/5 rounded-lg px-4 py-3">
                            <p className="text-xs text-muted-foreground">Lines of Code</p>
                            <p className="text-xl font-bold text-white mt-1">{insights.total_lines_of_code.toLocaleString()}</p>
                        </div>
                        <div className="bg-surface-a10 border border-white/5 rounded-lg px-4 py-3">
                            <p className="text-xs text-muted-foreground">Largest File</p>
                            <p className="text-sm font-medium text-white mt-1 truncate">
                                {insights.largest_files[0]?.path ?? "—"}
                            </p>
                        </div>
                        <div className="bg-surface-a10 border border-white/5 rounded-lg px-4 py-3">
                            <p className="text-xs text-muted-foreground">Top Hotspot</p>
                            <p className="text-sm font-medium text-white mt-1 truncate">
                                {insights.hotspots[0]?.path ?? "—"}
                            </p>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 xl:grid-cols-3 gap-3">
                        <InsightsList
                            icon={Scale}
                            title="Largest Files"
                            emptyLabel="No tracked files were included in the size scan."
                            files={insights.largest_files}
                            metricLabel="size"
                            metricValue={(file) => formatBytes(file.size_bytes)}
                        />
                        <InsightsList
                            icon={GitCompareArrows}
                            title="Top Changed Files"
                            emptyLabel="No file history was found in Git."
                            files={insights.most_modified_files}
                            metricLabel="commits"
                            metricValue={(file) => file.change_count.toLocaleString()}
                        />
                        <InsightsList
                            icon={Flame}
                            title="Hotspots"
                            emptyLabel="Not enough code and history overlap to rank hotspots."
                            files={insights.hotspots}
                            metricLabel="hotspot"
                            metricValue={(file) => file.hotspot_score.toFixed(1)}
                        />
                    </div>
                </>
            )}
        </div>
    );
}
