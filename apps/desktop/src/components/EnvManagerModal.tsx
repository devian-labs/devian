import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { X, Save, Plus, Copy, Eye, EyeOff, Trash2, Settings, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";

interface EnvVariable {
    key: string;
    value: string;
}

interface EnvVarRow extends EnvVariable {
    id: string;
    isVisible: boolean;
}

interface EnvManagerModalProps {
    projectPath: string;
    onClose: () => void;
}

export default function EnvManagerModal({ projectPath, onClose }: EnvManagerModalProps) {
    const { toast } = useToast();
    const [vars, setVars] = useState<EnvVarRow[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);

    useEffect(() => {
        loadEnvVars();
    }, [projectPath]);

    const loadEnvVars = async () => {
        setIsLoading(true);
        try {
            const data = await invoke<EnvVariable[]>("read_env_file", { path: projectPath });
            setVars(data.map(v => ({ ...v, id: crypto.randomUUID(), isVisible: false })));
        } catch (error) {
            toast({ variant: "destructive", title: "Failed to load .env", description: String(error) });
        } finally {
            setIsLoading(false);
        }
    };

    const handleSave = async () => {
        setIsSaving(true);
        try {
            const outVars: EnvVariable[] = vars
                .filter(v => v.key.trim() !== "") // remove empty keys
                .map(({ key, value }) => ({ key: key.trim(), value }));
            await invoke("write_env_file", { path: projectPath, envVars: outVars });
            toast({ title: "Environment Variables Saved", description: "Successfully updated .env file." });
            onClose();
        } catch (error) {
            toast({ variant: "destructive", title: "Failed to save .env", description: String(error) });
            setIsSaving(false);
        }
    };

    const handleCopy = (value: string) => {
        navigator.clipboard.writeText(value);
        toast({ title: "Copied!", description: "Value copied to clipboard." });
    };

    const toggleVisibility = (id: string) => {
        setVars(vars.map(v => v.id === id ? { ...v, isVisible: !v.isVisible } : v));
    };

    const addVariable = () => {
        setVars([...vars, { id: crypto.randomUUID(), key: "", value: "", isVisible: true }]);
    };

    const updateVar = (id: string, field: "key" | "value", newValue: string) => {
        setVars(vars.map(v => v.id === id ? { ...v, [field]: newValue } : v));
    };

    const removeVar = (id: string) => {
        setVars(vars.filter(v => v.id !== id));
    };

    return (
        <div className="fixed inset-0 z-100 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-200" onClick={onClose}>
            <div className="bg-[#1a1a1e] border border-white/10 rounded-xl max-w-2xl w-full sm:w-[600px] shadow-2xl flex flex-col max-h-[85vh] animate-in zoom-in-[0.98] duration-150 overflow-hidden" onClick={e => e.stopPropagation()}>
                {/* Header */}
                <div className="p-4 sm:p-5 flex items-center justify-between border-b border-white/5 bg-[#1a1a1e]/80 sticky top-0 z-10">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-emerald-500/10 rounded-lg">
                            <Settings className="h-5 w-5 text-emerald-400" />
                        </div>
                        <div>
                            <h2 className="text-lg font-bold text-white">Environment Variables</h2>
                            <p className="text-xs text-muted-foreground font-mono mt-0.5 truncate max-w-[300px]">{projectPath}/.env</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-white/5 rounded-md text-muted-foreground hover:text-white transition-colors">
                        <X className="h-5 w-5" />
                    </button>
                </div>

                {/* Content */}
                <div className="p-4 sm:p-5 flex-1 overflow-y-auto min-h-[300px]">
                    {isLoading ? (
                        <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-3">
                            <Settings className="h-8 w-8 animate-spin text-emerald-500/50" />
                            <p className="text-sm">Loading .env file...</p>
                        </div>
                    ) : vars.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-full text-center p-6 border border-dashed border-white/10 rounded-lg bg-surface-base">
                            <AlertCircle className="h-8 w-8 text-muted-foreground/50 mb-3" />
                            <p className="text-sm text-white font-medium mb-1">No variables found</p>
                            <p className="text-xs text-muted-foreground mb-4">This project doesn't have any variables in its .env file yet.</p>
                            <Button onClick={addVariable} variant="outline" size="sm" className="bg-emerald-500/10 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/20">
                                <Plus className="h-4 w-4 mr-1.5" /> Add Variable
                            </Button>
                        </div>
                    ) : (
                        <div className="flex flex-col gap-2">
                            {vars.map((v) => (
                                <div key={v.id} className="flex items-center gap-2 group">
                                    <Input
                                        value={v.key}
                                        onChange={(e) => updateVar(v.id, "key", e.target.value)}
                                        placeholder="KEY"
                                        className="w-1/3 bg-black/40 border-white/10 font-mono text-sm uppercase"
                                    />
                                    <div className="relative flex-1">
                                        <Input
                                            type={v.isVisible ? "text" : "password"}
                                            value={v.value}
                                            onChange={(e) => updateVar(v.id, "value", e.target.value)}
                                            placeholder="Value"
                                            className={`w-full bg-black/40 border-white/10 font-mono text-sm pr-18 ${!v.isVisible ? "tracking-widest" : ""}`}
                                        />
                                        <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5">
                                            <button
                                                onClick={() => toggleVisibility(v.id)}
                                                className="p-1.5 text-muted-foreground hover:text-white hover:bg-white/10 rounded transition-colors"
                                                title={v.isVisible ? "Hide value" : "Show value"}
                                            >
                                                {v.isVisible ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                                            </button>
                                            <button
                                                onClick={() => handleCopy(v.value)}
                                                className="p-1.5 text-muted-foreground hover:text-emerald-400 hover:bg-emerald-500/10 rounded transition-colors"
                                                title="Copy value"
                                            >
                                                <Copy className="h-3.5 w-3.5" />
                                            </button>
                                        </div>
                                    </div>
                                    <button
                                        onClick={() => removeVar(v.id)}
                                        className="p-2 text-muted-foreground/50 hover:text-red-400 hover:bg-red-400/10 rounded-md transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100"
                                        title="Remove variable"
                                    >
                                        <Trash2 className="h-4 w-4" />
                                    </button>
                                </div>
                            ))}

                            <Button
                                onClick={addVariable}
                                variant="outline"
                                className="w-full mt-2 border-dashed border-white/10 text-muted-foreground hover:text-white hover:bg-white/5 hover:border-white/20"
                            >
                                <Plus className="h-4 w-4 mr-2" /> Add New Variable
                            </Button>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="p-4 sm:p-5 border-t border-white/5 bg-[#1a1a1e]/80 flex justify-end gap-3 sticky bottom-0 z-10">
                    <Button variant="outline" onClick={onClose} className="border-white/10 text-muted-foreground hover:bg-white/5 hover:text-white">
                        Cancel
                    </Button>
                    <Button
                        onClick={handleSave}
                        disabled={isSaving || isLoading}
                        className="bg-emerald-500 hover:bg-emerald-600 text-black font-semibold min-w-[100px]"
                    >
                        {isSaving ? <Settings className="h-4 w-4 animate-spin" /> : <><Save className="h-4 w-4 mr-2" /> Save Changes</>}
                    </Button>
                </div>
            </div>
        </div>
    );
}
