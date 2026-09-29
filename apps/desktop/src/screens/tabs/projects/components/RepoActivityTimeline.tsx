import { Activity, Loader2, TrendingUp } from "lucide-react";
import { CommitTimelinePoint } from "../types";

interface RepoActivityTimelineProps {
    timeline: CommitTimelinePoint[];
    loading: boolean;
}

function monthLabel(month: string) {
    const [year, monthNum] = month.split("-");
    const date = new Date(Number(year), Number(monthNum) - 1, 1);
    return date.toLocaleString("en-US", { month: "short" });
}

function formatPoint(x: number, y: number) {
    return `${x.toFixed(1)},${y.toFixed(1)}`;
}

export function RepoActivityTimeline({ timeline, loading }: RepoActivityTimelineProps) {
    const totalCommits = timeline.reduce((sum, point) => sum + point.count, 0);
    const recentCommits = timeline.slice(-3).reduce((sum, point) => sum + point.count, 0);
    const maxCount = timeline.length > 0 ? Math.max(...timeline.map((point) => point.count), 1) : 1;
    const hottestMonth = timeline.length > 0 ? [...timeline].sort((a, b) => b.count - a.count)[0] : null;
    const hasSpike = timeline.some((point) => point.count >= Math.max(6, maxCount * 0.8));
    const statusLabel = recentCommits === 0
        ? "Dead repo"
        : recentCommits >= 12
            ? "Active repo"
            : hasSpike
                ? "Spike development"
                : "Steady activity";
    const chartWidth = 720;
    const chartHeight = 220;
    const paddingX = 18;
    const paddingTop = 18;
    const paddingBottom = 34;
    const usableWidth = chartWidth - paddingX * 2;
    const usableHeight = chartHeight - paddingTop - paddingBottom;
    const stepX = timeline.length > 1 ? usableWidth / (timeline.length - 1) : usableWidth;
    const points = timeline.map((point, index) => {
        const x = paddingX + stepX * index;
        const ratio = point.count / maxCount;
        const y = paddingTop + usableHeight - ratio * usableHeight;
        return { ...point, x, y };
    });
    const linePath = points.map((point, index) => `${index === 0 ? "M" : "L"} ${formatPoint(point.x, point.y)}`).join(" ");
    const areaPath = points.length > 0
        ? `${linePath} L ${formatPoint(points[points.length - 1].x, chartHeight - paddingBottom)} L ${formatPoint(points[0].x, chartHeight - paddingBottom)} Z`
        : "";
    const yGuides = [0, 0.25, 0.5, 0.75, 1].map((ratio) => ({
        y: paddingTop + usableHeight - ratio * usableHeight,
        label: Math.round(maxCount * ratio),
    }));

    return (
        <div className="space-y-3">
            <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                    <Activity className="h-4 w-4 text-primary" /> Repo Activity Timeline
                </h3>
                {!loading && timeline.length > 0 && (
                    <div className="text-[11px] text-muted-foreground flex items-center gap-1.5">
                        <TrendingUp className="h-3 w-3" />
                        {statusLabel}
                    </div>
                )}
            </div>

            {loading ? (
                <div className="flex items-center gap-2 text-muted-foreground py-6 justify-center">
                    <Loader2 className="h-4 w-4 animate-spin" /> <span className="text-sm">Loading activity...</span>
                </div>
            ) : timeline.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">No commit activity found.</p>
            ) : (
                <div className="bg-surface-a10 border border-white/5 rounded-lg overflow-hidden shadow-xs">
                    <div className="flex items-center justify-between p-4 py-3 border-b border-white/5 bg-white/2">
                        <div className="text-xs text-cyan-200/70">Commit Velocity</div>
                        <div className="text-[11px] text-muted-foreground">
                            Peak <span className="text-white ml-1">{maxCount}</span>
                        </div>
                    </div>
                    <div className="p-4">
                    <div className="rounded-xl border border-white/5 bg-black/20 p-4">
                        <div className="flex items-start justify-between gap-3 mb-4">
                            <div>
                                <p className="text-sm text-white mt-1">
                                    Hottest month: <span className="text-cyan-300">{hottestMonth ? monthLabel(hottestMonth.month) : "—"}</span> with {hottestMonth?.count ?? 0} commits
                                </p>
                            </div>
                            <div className="text-right text-[11px] text-muted-foreground">
                                {statusLabel}
                            </div>
                        </div>

                        <div className="relative">
                            <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} className="w-full h-auto overflow-visible">
                                {yGuides.map((guide, index) => (
                                    <g key={index}>
                                        <line
                                            x1={paddingX}
                                            y1={guide.y}
                                            x2={chartWidth - paddingX}
                                            y2={guide.y}
                                            stroke="rgba(255,255,255,0.08)"
                                            strokeDasharray={index === 0 ? "0" : "4 6"}
                                        />
                                        <text
                                            x={4}
                                            y={guide.y + 4}
                                            fill="rgba(255,255,255,0.45)"
                                            fontSize="10"
                                        >
                                            {guide.label}
                                        </text>
                                    </g>
                                ))}

                                <path d={areaPath} fill="rgba(56,189,248,0.16)" />
                                <path
                                    d={linePath}
                                    fill="none"
                                    stroke="rgba(103,232,249,0.95)"
                                    strokeWidth="3"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                />

                                {points.map((point, index) => (
                                    <g key={point.month}>
                                        <circle
                                            cx={point.x}
                                            cy={point.y}
                                            r={index === points.length - 1 ? 5 : 4}
                                            fill="rgba(10,10,14,0.95)"
                                            stroke={index === points.length - 1 ? "rgba(52,211,153,0.95)" : "rgba(103,232,249,0.95)"}
                                            strokeWidth="2"
                                        />
                                        <text
                                            x={point.x}
                                            y={chartHeight - 10}
                                            textAnchor="middle"
                                            fill="rgba(255,255,255,0.55)"
                                            fontSize="10"
                                        >
                                            {monthLabel(point.month)}
                                        </text>
                                    </g>
                                ))}
                            </svg>
                        </div>
                    </div>

                    <div className="flex items-center justify-between mt-4 text-xs text-muted-foreground">
                        <span>{totalCommits} commits over the last {timeline.length} months</span>
                        <span>{recentCommits} commits in the last 3 months</span>
                    </div>
                    </div>
                </div>
            )}
        </div>
    );
}
