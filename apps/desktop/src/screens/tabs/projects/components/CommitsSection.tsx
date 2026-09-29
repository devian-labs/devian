import { GitCommitHorizontal, Loader2, User, Hash } from "lucide-react";
import { Commit } from "../types";

interface CommitsSectionProps {
    commits: Commit[];
    loading: boolean;
}

export function CommitsSection({ commits, loading }: CommitsSectionProps) {
    return (
        <div className="bg-surface-a10 border border-white/5 rounded-lg overflow-hidden shadow-xs">
            <div className="flex items-center justify-between p-4 py-3 border-b border-white/5 bg-white/2">
                <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                    <GitCommitHorizontal className="h-4 w-4 text-primary" /> Recent Commits
                </h3>
            </div>
            <div className="p-4">
                {loading ? (
                    <div className="flex items-center gap-2 text-muted-foreground py-6 justify-center">
                        <Loader2 className="h-4 w-4 animate-spin" /> <span className="text-sm">Loading...</span>
                    </div>
                ) : commits.length === 0 ? (
                    <p className="text-sm text-muted-foreground py-4 text-center">No commits found.</p>
                ) : (
                    <div className="space-y-2">
                        {commits.map((c, i) => (
                            <div key={i} className="bg-black/20 border border-white/5 rounded-lg px-4 py-2.5 hover:bg-white/3 transition-colors">
                                <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0 flex-1">
                                        <p className="text-sm text-white truncate">{c.message}</p>
                                        <div className="flex items-center gap-3 mt-0.5 text-[11px] text-muted-foreground">
                                            <span className="flex items-center gap-1"><User className="h-3 w-3" />{c.author}</span>
                                            <span className="flex items-center gap-1"><Hash className="h-3 w-3" />{c.hash.substring(0, 7)}</span>
                                        </div>
                                    </div>
                                    <span className="text-[11px] text-muted-foreground shrink-0 mt-0.5">{c.relative_time}</span>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
