import { useState, useEffect } from "react";
import { readPref } from "@/lib/prefs";
import { SETTING } from "@/lib/settings";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { DownloadCloud, X } from "lucide-react";
import { Button } from "@/components/ui/button";

export function UpdaterNotification() {
    const [updateAvailable, setUpdateAvailable] = useState<any>(null);
    const [isUpdating, setIsUpdating] = useState(false);
    const [progress, setProgress] = useState(0);
    const [dismissed, setDismissed] = useState(false);

    useEffect(() => {
        async function checkForUpdates() {
            // Settings → General → "Check for updates automatically".
            if (!readPref<boolean>(SETTING.autoUpdate, true)) return;
            try {
                const update = await check();
                if (update) {
                    console.log("Update available:", update.version);
                    setUpdateAvailable(update);
                }
            } catch (error) {
                console.error("Failed to check for updates:", error);
            }
        }
        
        // Brief delay before checking to not block initial render heavily
        const timer = setTimeout(() => {
            checkForUpdates();
        }, 3000);

        return () => clearTimeout(timer);
    }, []);

    const handleUpdate = async () => {
        if (!updateAvailable) return;
        
        setIsUpdating(true);
        let downloaded = 0;
        let contentLength = 0;

        try {
            await updateAvailable.downloadAndInstall((event: any) => {
                switch (event.event) {
                    case "Started":
                        contentLength = event.data.contentLength || 0;
                        console.log(`Started downloading ${contentLength} bytes`);
                        break;
                    case "Progress":
                        downloaded += event.data.chunkLength;
                        if (contentLength > 0) {
                            setProgress(Math.round((downloaded / contentLength) * 100));
                        }
                        break;
                    case "Finished":
                        console.log("Download finished");
                        break;
                }
            });

            console.log("Update installed, relaunching...");
            await relaunch();
        } catch (error) {
            console.error("Failed to install update:", error);
            setIsUpdating(false);
        }
    };

    if (!updateAvailable || dismissed) return null;

    return (
        <div className="fixed bottom-6 right-6 z-50 animate-in slide-in-from-bottom-5">
            <div className="bg-background border border-border/50 shadow-lg rounded-xl p-4 flex flex-col gap-3 min-w-[320px] max-w-[400px]">
                <div className="flex justify-between items-start gap-4">
                    <div className="flex gap-3">
                        <div className="bg-primary/10 p-2 rounded-lg h-fit text-primary">
                            <DownloadCloud className="h-5 w-5" />
                        </div>
                        <div>
                            <h3 className="font-semibold text-sm">Update Available</h3>
                            <p className="text-xs text-muted-foreground mt-0.5">
                                Version {updateAvailable.version} is ready to install.
                            </p>
                            {updateAvailable.body && (
                                <p className="text-xs text-muted-foreground mt-2 line-clamp-2">
                                    {updateAvailable.body}
                                </p>
                            )}
                        </div>
                    </div>
                    {!isUpdating && (
                        <button 
                            onClick={() => setDismissed(true)}
                            className="text-muted-foreground hover:text-foreground transition-colors"
                        >
                            <X className="h-4 w-4" />
                        </button>
                    )}
                </div>

                {isUpdating ? (
                    <div className="space-y-2">
                        <div className="flex justify-between text-xs">
                            <span className="text-muted-foreground">Downloading...</span>
                            <span className="font-medium">{progress}%</span>
                        </div>
                        <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
                            <div 
                                className="h-full bg-primary transition-all duration-200"
                                style={{ width: `${progress}%` }}
                            />
                        </div>
                    </div>
                ) : (
                    <div className="flex justify-end gap-2 mt-1">
                        <Button 
                            variant="ghost" 
                            size="sm" 
                            onClick={() => setDismissed(true)}
                            className="text-xs h-8"
                        >
                            Later
                        </Button>
                        <Button 
                            variant="default" 
                            size="sm" 
                            onClick={handleUpdate}
                            className="text-xs h-8"
                        >
                            Install & Restart
                        </Button>
                    </div>
                )}
            </div>
        </div>
    );
}
