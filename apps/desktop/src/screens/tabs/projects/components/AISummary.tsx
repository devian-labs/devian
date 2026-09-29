import { BrainCircuit, Sparkles, Copy, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AppMarkdown } from "@/components/markdown/AppMarkdown";
import { LocalProject } from "../types";

interface AISummaryProps {
    project: LocalProject;
    aiSummary: string;
    aiLoading: boolean;
    onGenerateSummary: (project: LocalProject) => void;
    onCopyToClipboard: () => void;
    onShowToast: (title: string, description: string) => void;
}

export function AISummary({
    project,
    aiSummary,
    aiLoading,
    onGenerateSummary,
    onCopyToClipboard,
    onShowToast,
}: AISummaryProps) {
    return (
        <div className="bg-surface-a10 border border-white/5 rounded-lg overflow-hidden flex flex-col shadow-xs">
            <div className="flex items-center justify-between p-4 py-3 border-b border-white/5 bg-white/2">
                <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                    <BrainCircuit className="h-4 w-4 text-violet-400" /> AI Project Analysis
                </h3>
                <div className="flex items-center gap-2">
                    {aiSummary && (
                        <Button
                            variant="ghost" size="sm"
                            className="h-7 w-7 p-0 text-muted-foreground hover:text-white"
                            onClick={() => {
                                onCopyToClipboard();
                                onShowToast("Copied!", "AI Summary copied to clipboard.");
                            }}
                            title="Copy Summary"
                        >
                            <Copy className="h-3.5 w-3.5" />
                        </Button>
                    )}
                    <Button
                        variant="outline" size="sm"
                        className="h-7 text-xs border-violet-500/20 text-violet-300 hover:bg-violet-500/10"
                        onClick={() => onGenerateSummary(project)}
                        disabled={aiLoading}
                    >
                        {aiLoading ? (
                            <><Loader2 className="h-3 w-3 mr-1 animate-spin" /> Analyzing...</>
                        ) : (
                            <><Sparkles className="h-3 w-3 mr-1" /> {aiSummary ? "Refine Summary" : "Generate Summary"}</>
                        )}
                    </Button>
                </div>
            </div>
            <div className="p-5 bg-black/10">
                {aiSummary ? (
                    <div className="text-sm leading-relaxed prose prose-invert prose-sm max-w-none 
                        prose-headings:font-bold 
                        prose-p:text-zinc-400 prose-p:my-3
                        prose-strong:text-zinc-100 prose-strong:font-semibold
                        prose-ul:my-3 prose-li:my-1.5 prose-li:text-zinc-400
                        prose-pre:bg-black/40 prose-pre:border prose-pre:border-white/5
                        pb-2">
                        <AppMarkdown
                            content={aiSummary}
                            components={{
                                h2: ({ node, ...props }) => <h2 className="text-violet-400 text-base border-b border-violet-500/20 pb-1.5 mt-6 mb-4 flex items-center gap-2" {...props} />,
                                h3: ({ node, ...props }) => <h3 className="text-emerald-400 text-sm mt-5 mb-2" {...props} />,
                                strong: ({ node, ...props }) => {
                                    const content = String(props.children);
                                    const isLabel = content.includes(':');
                                    return <strong className={isLabel ? "text-emerald-500/90 font-bold" : "text-white font-semibold"} {...props} />;
                                },
                                ul: ({ node, ...props }) => <ul className="space-y-1 my-3 list-none pl-0" {...props} />,
                                li: ({ node, ...props }) => (
                                    <li className="flex items-start gap-2 before:content-['•'] before:text-violet-500/50 before:font-bold" {...props} />
                                ),
                            }}
                        />
                    </div>
                ) : (
                    <div className="flex flex-col items-center justify-center py-6 text-center">
                        <Sparkles className="h-8 w-8 text-violet-500/20 mb-3" />
                        <p className="text-xs text-muted-foreground max-w-[200px]">Get an AI-powered architectural overview and tech stack analysis of this project.</p>
                    </div>
                )}
            </div>
        </div>
    );
}
