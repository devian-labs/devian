import { Terminal, Loader2 } from "lucide-react";
import { ProjectRunbook as RunbookType } from "../types";

interface ProjectRunbookProps {
    runbook: RunbookType;
    saving: boolean;
    onChange: (runbook: RunbookType) => void;
    onSave: (runbook: RunbookType) => void;
}

export function ProjectRunbook({ runbook, saving, onChange, onSave }: ProjectRunbookProps) {
    const save = () => onSave(runbook);

    return (
        <div className="bg-zinc-900 border border-white/5 rounded-xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
                <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                    <Terminal className="h-4 w-4 text-primary" />
                    How to Run
                </h3>
                {saving ? (
                    <span className="text-xs text-zinc-600 flex items-center gap-1">
                        <Loader2 className="h-3 w-3 animate-spin" /> Saving...
                    </span>
                ) : (
                    <span className="text-xs text-zinc-700">Saved to .devian/config.json</span>
                )}
            </div>

            <div className="p-4">
                <textarea
                    value={runbook.howToRun}
                    onChange={e => onChange({ ...runbook, howToRun: e.target.value })}
                    onBlur={save}
                    placeholder={"pnpm install\npnpm dev"}
                    rows={4}
                    className="w-full bg-black/20 border border-white/5 rounded-lg px-3 py-2.5 text-sm text-zinc-200 placeholder:text-zinc-700 resize-none focus:outline-hidden focus:border-white/10 font-mono leading-relaxed"
                />
                <p className="text-xs text-zinc-600 mt-2">One command per line.</p>
            </div>
        </div>
    );
}
