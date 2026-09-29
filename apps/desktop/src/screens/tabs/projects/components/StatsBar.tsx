import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { HardDrive, Sparkles, AlertTriangle, Activity, Trash2 } from "lucide-react";
import { formatBytes } from "../utils";

interface StatsBarProps {
    totalProjectSize: number;
    totalRecoverableBytes: number;
    staleCount: number;
    inactiveCount: number;
    cleaningAll: boolean;
    hasScanned: boolean;
    projectCount: number;
    onPreviewCleanup: () => void;
}

export function StatsBar({
    totalProjectSize,
    totalRecoverableBytes,
    staleCount,
    inactiveCount,
    cleaningAll,
    
    hasScanned,
    projectCount,
    onPreviewCleanup,
}: StatsBarProps) {
    if (!hasScanned || projectCount === 0) return null;

    return (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Card className="bg-surface-a10 border-white/5 shadow-xs">
                <CardContent className="py-2.5 px-4 flex items-center gap-3">
                    <HardDrive className="h-4 w-4 text-primary shrink-0" />
                    <div>
                        <p className="text-sm font-medium text-white">{formatBytes(totalProjectSize)}</p>
                        <p className="text-xs text-muted-foreground">Total project size</p>
                    </div>
                </CardContent>
            </Card>
            {totalRecoverableBytes > 0 && (
                <Card className="bg-linear-to-r from-amber-500/10 to-orange-500/10 border-amber-500/20 shadow-xs">
                    <CardContent className="py-2.5 px-4 flex items-center gap-3">
                        <Sparkles className="h-4 w-4 text-amber-400 shrink-0" />
                        <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-amber-200">{formatBytes(totalRecoverableBytes)}</p>
                            <p className="text-xs text-amber-200/60">Safe to Clean</p>
                        </div>
                        <Button
                            variant="ghost" size="sm"
                            className="h-7 text-xs text-amber-300 hover:bg-amber-500/20 shrink-0 rounded-full"
                            onClick={onPreviewCleanup}
                            disabled={cleaningAll}
                        >
                            <Trash2 className="h-3 w-3 mr-1" />
                            {cleaningAll ? "Cleaning..." : "Clean"}
                        </Button>
                    </CardContent>
                </Card>
            )}
            {staleCount > 0 && (
                <Card className="bg-red-500/5 border-red-500/15 shadow-xs">
                    <CardContent className="py-2.5 px-4 flex items-center gap-3">
                        <AlertTriangle className="h-4 w-4 text-red-400 shrink-0" />
                        <div>
                            <p className="text-sm font-medium text-red-300">{staleCount} Abandoned</p>
                            <p className="text-xs text-red-300/60">90+ days inactive</p>
                        </div>
                    </CardContent>
                </Card>
            )}
            {inactiveCount > 0 && (
                <Card className="bg-amber-500/5 border-amber-500/15 shadow-xs">
                    <CardContent className="py-2.5 px-4 flex items-center gap-3">
                        <Activity className="h-4 w-4 text-amber-400 shrink-0" />
                        <div>
                            <p className="text-sm font-medium text-amber-300">{inactiveCount} Inactive</p>
                            <p className="text-xs text-amber-300/60">30-90 days</p>
                        </div>
                    </CardContent>
                </Card>
            )}
        </div>
    );
}
