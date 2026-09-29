import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { openFeedback } from "@/lib/diagnostics";
import { reportError, scrub } from "@/lib/telemetry";

interface Props {
    /** Where this boundary sits, for the report ("app", "tab:sessions"). */
    where: string;
    /** Fills the window instead of the content area. */
    fullScreen?: boolean;
    children: ReactNode;
}

/** Keeps one broken screen from taking the whole app down. */
export class ErrorBoundary extends Component<Props, { error: Error | null }> {
    state = { error: null as Error | null };

    static getDerivedStateFromError(error: Error) {
        return { error };
    }

    componentDidCatch(error: Error, info: ErrorInfo) {
        reportError(error, `${this.props.where}${info.componentStack ? ` ${info.componentStack.split("\n").find(l => l.trim())?.trim() ?? ""}` : ""}`);
    }

    render() {
        const { error } = this.state;
        if (!error) return this.props.children;
        return (
            <div role="alert" className={`flex items-center justify-center p-8 ${this.props.fullScreen ? "min-h-screen bg-zinc-950" : "h-full min-h-[320px]"}`}>
                <div className="max-w-md text-center space-y-4">
                    <div className="mx-auto h-11 w-11 rounded-full bg-amber-500/10 flex items-center justify-center">
                        <AlertTriangle className="h-5 w-5 text-amber-400" />
                    </div>
                    <div className="space-y-1.5">
                        <p className="text-sm font-semibold text-white">This screen ran into a problem</p>
                        <p className="text-xs text-zinc-500 break-words">{scrub(error.message)}</p>
                    </div>
                    <div className="flex items-center justify-center gap-2">
                        <Button size="sm" variant="secondary" onClick={() => this.setState({ error: null })}><RotateCcw /> Try again</Button>
                        {this.props.fullScreen && <Button size="sm" variant="ghost" onClick={() => location.reload()}>Reload</Button>}
                        <Button size="sm" variant="ghost" onClick={() => openFeedback({ kind: "bug", message: `The ${this.props.where.replace(/^tab:/, "")} screen showed an error: ${scrub(error.message)}` })}>
                            Report it
                        </Button>
                    </div>
                </div>
            </div>
        );
    }
}
