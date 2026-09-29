import { useEffect, useState } from "react";
import { ChevronDown, Download, Terminal, Copy } from "lucide-react";
import pkgData from "../../package.json";
import { HOMEBREW_COMMANDS, LATEST_RELEASE_URL, RELEASES_API_URL } from "@/config/site";

interface Asset {
    name: string;
    browser_download_url: string;
    size: number;
}

interface GithubRelease {
    id: number;
    name: string;
    tag_name: string;
    published_at: string;
    html_url: string;
    assets: Asset[];
}

export function DownloadsSection() {
    const [releases, setReleases] = useState<GithubRelease[]>([]);
    const [loading, setLoading] = useState(true);
    const [showHistory, setShowHistory] = useState(false);
    const [copied, setCopied] = useState(false);
    const [copiedQuarantine, setCopiedQuarantine] = useState(false);

    useEffect(() => {
        fetch(RELEASES_API_URL)
            .then((res) => res.json())
            .then((data) => {
                if (Array.isArray(data)) setReleases(data);
                setLoading(false);
            })
            .catch((err) => {
                console.error("Failed to fetch releases", err);
                setLoading(false);
            });
    }, []);

    const getAssetUrl = (assets: Asset[], extension: string) =>
        assets.find((a) => a.name.endsWith(extension))?.browser_download_url;

    const getAssetSize = (assets: Asset[], extension: string) => {
        const asset = assets.find((a) => a.name.endsWith(extension));
        if (!asset) return null;
        return (asset.size / (1024 * 1024)).toFixed(1) + " MB";
    };

    const latestRelease = releases.length > 0 ? releases[0] : null;
    const oldReleases = releases.length > 1 ? releases.slice(1) : [];

    const macLink = latestRelease
        ? getAssetUrl(latestRelease.assets, ".dmg")
        : LATEST_RELEASE_URL;
    const macSize = latestRelease ? getAssetSize(latestRelease.assets, ".dmg") : "9.8 MB";

    const winLink = latestRelease ? getAssetUrl(latestRelease.assets, ".exe") : null;
    const winSize = latestRelease ? getAssetSize(latestRelease.assets, ".exe") : null;

    const linuxLink = latestRelease ? getAssetUrl(latestRelease.assets, ".AppImage") : null;
    const linuxSize = latestRelease ? getAssetSize(latestRelease.assets, ".AppImage") : null;

    const handleCopyCommand = () => {
        navigator.clipboard.writeText(
            HOMEBREW_COMMANDS.join("\n")
        );
        setCopied(true);
        if (typeof window !== "undefined" && window.gtag) {
            window.gtag("event", "copy_brew_command", {
                event_category: "engagement",
                event_label: "macOS Terminal",
            });
        }
        setTimeout(() => setCopied(false), 2000);
    };

    const handleCopyQuarantine = () => {
        navigator.clipboard.writeText(
            "xattr -dr com.apple.quarantine /Applications/Devian\\ Desktop.app"
        );
        setCopiedQuarantine(true);
        if (typeof window !== "undefined" && window.gtag) {
            window.gtag("event", "copy_quarantine_command", {
                event_category: "engagement",
                event_label: "macOS quarantine fix",
            });
        }
        setTimeout(() => setCopiedQuarantine(false), 2000);
    };

    const trackDownload = (version: string, type: "latest" | "old", platform: "mac" | "windows" | "linux") => {
        if (typeof window !== "undefined" && window.gtag) {
            window.gtag("event", `download_${platform}_${type}`, {
                event_category: "download",
                event_label: version,
            });
        }
    };

    const versionTag = latestRelease?.tag_name || `v${pkgData.version}`;

    return (
        <section
            id="download"
            className="px-6 md:px-8 py-20 md:py-32 max-w-5xl mx-auto text-center border-t border-white/[0.05]"
        >
            <h2 className="text-3xl sm:text-4xl md:text-5xl font-black mb-4 md:mb-6 tracking-tight">
                Ready to take control?
            </h2>

            <p className="text-base sm:text-lg md:text-xl text-white/50 mb-10 md:mb-16 font-light">
                Free, with every feature. No account, no license key.
            </p>

            {loading ? (
                <div className="flex justify-center items-center h-32">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white/20"></div>
                </div>
            ) : (
                <div className="flex flex-col items-center gap-8 max-w-4xl mx-auto">

                    {/* Homebrew Install — macOS only */}
                    <div className="w-full max-w-2xl bg-[#0A0A0C] border border-white/10 rounded-2xl overflow-hidden shadow-2xl">
                        <div className="bg-white/5 px-4 py-3 border-b border-white/5 flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <Terminal className="h-4 w-4 text-white/50" />
                                <span className="text-xs font-mono text-white/50">
                                    Install with Homebrew <span className="text-white/25">(macOS)</span>
                                </span>
                            </div>
                            <button
                                onClick={handleCopyCommand}
                                className="text-white/40 hover:text-white transition flex items-center gap-1.5 text-xs bg-white/5 hover:bg-white/10 px-3 py-1.5 rounded-lg"
                            >
                                <Copy className="h-3.5 w-3.5" />
                                {copied ? "Copied!" : "Copy"}
                            </button>
                        </div>
                        <div className="p-6">
                            <code className="text-sm md:text-base font-mono text-[#4ADE80] whitespace-pre text-left block">
{HOMEBREW_COMMANDS.map((c) => `$ ${c}`).join("\n")}
                            </code>
                        </div>
                    </div>

                    {/* Divider */}
                    <div className="flex items-center gap-4 w-full max-w-2xl">
                        <div className="h-px bg-white/10 flex-1"></div>
                        <span className="text-xs text-white/40 uppercase tracking-widest">
                            Or Download Directly
                        </span>
                        <div className="h-px bg-white/10 flex-1"></div>
                    </div>

                    {/* Platform Cards */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 w-full max-w-2xl">
                        {/* macOS */}
                        <a
                            href={macLink || "#"}
                            download={!!macLink}
                            onClick={() => trackDownload(versionTag, "latest", "mac")}
                            className="bg-white hover:bg-white/90 text-black p-6 rounded-2xl flex flex-col items-start gap-4 transition-all hover:scale-[1.02] active:scale-[0.98] shadow-[0_0_30px_rgba(255,255,255,0.08)] hover:shadow-[0_0_50px_rgba(255,255,255,0.15)]"
                        >
                            <div className="h-10 w-10 bg-[#F5F5F7] rounded-xl flex items-center justify-center shadow-inner">
                                <AppleLogo className="h-5 w-5 text-black" />
                            </div>
                            <div>
                                <div className="text-[10px] font-bold uppercase tracking-widest text-black/40 mb-1">macOS</div>
                                <div className="text-base font-black">Download .dmg</div>
                                <div className="text-[11px] text-black/40 mt-0.5">Apple Silicon · {macSize || "—"}</div>
                            </div>
                        </a>

                        {/* Windows */}
                        <a
                            href={winLink || "#download"}
                            download={!!winLink}
                            onClick={() => winLink && trackDownload(versionTag, "latest", "windows")}
                            className="bg-[#0A0A0C] border border-blue-500/20 hover:border-blue-500/40 text-white p-6 rounded-2xl flex flex-col items-start gap-4 transition-all hover:scale-[1.02] active:scale-[0.98] shadow-[0_0_20px_rgba(59,130,246,0.04)] hover:shadow-[0_0_40px_rgba(59,130,246,0.1)]"
                        >
                            <div className="h-10 w-10 bg-blue-500/10 rounded-xl flex items-center justify-center border border-blue-500/20 shadow-inner">
                                <WindowsLogo className="h-5 w-5 text-blue-400" />
                            </div>
                            <div>
                                <div className="text-[10px] font-bold uppercase tracking-widest text-white/30 mb-1">Windows</div>
                                <div className="text-base font-black">{winLink ? "Download .exe" : "Coming Soon"}</div>
                                <div className="text-[11px] text-white/30 mt-0.5">Windows 10+ · {winSize || "—"}</div>
                            </div>
                        </a>

                        {/* Linux */}
                        <a
                            href={linuxLink || "#download"}
                            download={!!linuxLink}
                            onClick={() => linuxLink && trackDownload(versionTag, "latest", "linux")}
                            className="bg-[#0A0A0C] border border-orange-500/20 hover:border-orange-500/40 text-white p-6 rounded-2xl flex flex-col items-start gap-4 transition-all hover:scale-[1.02] active:scale-[0.98] shadow-[0_0_20px_rgba(249,115,22,0.04)] hover:shadow-[0_0_40px_rgba(249,115,22,0.1)]"
                        >
                            <div className="h-10 w-10 bg-orange-500/10 rounded-xl flex items-center justify-center border border-orange-500/20 shadow-inner">
                                <LinuxLogo className="h-5 w-5 text-orange-400" />
                            </div>
                            <div>
                                <div className="text-[10px] font-bold uppercase tracking-widest text-white/30 mb-1">Linux</div>
                                <div className="text-base font-black">{linuxLink ? "Download .AppImage" : "Coming Soon"}</div>
                                <div className="text-[11px] text-white/30 mt-0.5">Ubuntu 22.04+ · {linuxSize || "—"}</div>
                            </div>
                        </a>
                    </div>

                    {/* macOS Quarantine Fix */}
                    <div className="w-full max-w-2xl bg-[#0A0A0C] border border-yellow-500/20 rounded-2xl overflow-hidden shadow-2xl">
                        <div className="bg-yellow-500/10 px-4 py-3 border-b border-yellow-500/20 flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <Terminal className="h-4 w-4 text-yellow-400" />
                                <span className="text-xs font-mono text-yellow-300">
                                    If macOS blocks Devian Desktop
                                </span>
                            </div>
                            <button
                                onClick={handleCopyQuarantine}
                                className="text-yellow-200/70 hover:text-yellow-100 transition flex items-center gap-1.5 text-xs bg-yellow-500/10 hover:bg-yellow-500/20 px-3 py-1.5 rounded-lg"
                            >
                                <Copy className="h-3.5 w-3.5" />
                                {copiedQuarantine ? "Copied!" : "Copy"}
                            </button>
                        </div>
                        <div className="p-6">
                            <p className="text-xs text-white/60 mb-4 text-left">
                                macOS may block the app because it is not yet notarized by Apple.
                                Run the command below to remove the quarantine flag.
                            </p>
                            <code className="text-sm md:text-base font-mono text-[#4ADE80] whitespace-pre text-left block">
$ xattr -dr com.apple.quarantine /Applications/Devian\ Desktop.app
                            </code>
                        </div>
                    </div>

                    <p className="text-xs md:text-sm text-white/40 font-medium">
                        Current Version:{" "}
                        <span className="text-white/80">{versionTag}</span>
                        {" "}· macOS 12+ · Windows 10+ · Ubuntu 22.04+
                    </p>

                    {/* Version History */}
                    <div className="mt-12 md:mt-16 w-full max-w-2xl">
                        <button
                            onClick={() => setShowHistory(!showHistory)}
                            className="flex items-center justify-center gap-2 text-white/50 hover:text-white transition-colors text-sm font-medium mx-auto"
                        >
                            View Version History
                            <ChevronDown className={`h-4 w-4 transition-transform ${showHistory ? "rotate-180" : ""}`} />
                        </button>

                        {showHistory && oldReleases.length > 0 && (
                            <div className="mt-8 md:mt-10 bg-[#0A0A0C] border border-white/10 rounded-2xl overflow-x-auto shadow-2xl">
                                <table className="min-w-full divide-y divide-white/5">
                                    <thead className="bg-white/5 border-b border-white/10">
                                        <tr>
                                            <th className="px-4 py-4 text-left text-xs font-bold uppercase tracking-wider text-white/60">Version</th>
                                            <th className="px-4 py-4 text-left text-xs font-bold uppercase tracking-wider text-white/60">Date</th>
                                            <th className="px-4 py-4 text-center text-xs font-bold uppercase tracking-wider text-white/60">macOS</th>
                                            <th className="px-4 py-4 text-center text-xs font-bold uppercase tracking-wider text-white/60">Windows</th>
                                            <th className="px-4 py-4 text-center text-xs font-bold uppercase tracking-wider text-white/60">Linux</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-white/5">
                                        {oldReleases.map((release) => {
                                            const mLink = getAssetUrl(release.assets, ".dmg");
                                            const wLink = getAssetUrl(release.assets, ".exe");
                                            const lLink = getAssetUrl(release.assets, ".AppImage");
                                            return (
                                                <tr key={release.id}>
                                                    <td className="px-4 py-4 text-white text-sm font-medium">{release.tag_name}</td>
                                                    <td className="px-4 py-4 text-white/50 text-sm">
                                                        {new Date(release.published_at).toLocaleDateString()}
                                                    </td>
                                                    <td className="px-4 py-4 text-center">
                                                        {mLink ? (
                                                            <a href={mLink} download onClick={() => trackDownload(release.tag_name, "old", "mac")} className="text-white/70 hover:text-white transition flex items-center gap-1 justify-center text-sm">
                                                                <Download className="h-3.5 w-3.5" />.dmg
                                                            </a>
                                                        ) : <span className="text-white/20">—</span>}
                                                    </td>
                                                    <td className="px-4 py-4 text-center">
                                                        {wLink ? (
                                                            <a href={wLink} download onClick={() => trackDownload(release.tag_name, "old", "windows")} className="text-blue-400/70 hover:text-blue-400 transition flex items-center gap-1 justify-center text-sm">
                                                                <Download className="h-3.5 w-3.5" />.exe
                                                            </a>
                                                        ) : <span className="text-white/20">—</span>}
                                                    </td>
                                                    <td className="px-4 py-4 text-center">
                                                        {lLink ? (
                                                            <a href={lLink} download onClick={() => trackDownload(release.tag_name, "old", "linux")} className="text-orange-400/70 hover:text-orange-400 transition flex items-center gap-1 justify-center text-sm">
                                                                <Download className="h-3.5 w-3.5" />.AppImage
                                                            </a>
                                                        ) : <span className="text-white/20">—</span>}
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </section>
    );
}

function AppleLogo({ className }: { className?: string }) {
    return (
        <svg className={className} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 384 512" fill="currentColor">
            <path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z" />
        </svg>
    );
}

function WindowsLogo({ className }: { className?: string }) {
    return (
        <svg className={className} viewBox="0 0 448 512" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
            <path d="M0 93.7l183.6-25.3v177H0V93.7zm0 324.6l183.6 25.3V268.4H0v149.9zm203.8 28L448 480V268.4H203.8v177.9zm0-378.6v180.1H448V32L203.8 67.7z" />
        </svg>
    );
}

function LinuxLogo({ className }: { className?: string }) {
    return (
        <svg className={className} viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 5.5a1.5 1.5 0 110 3 1.5 1.5 0 010-3zm4 0a1.5 1.5 0 110 3 1.5 1.5 0 010-3zm-2 9c-2.21 0-4-1.79-4-4h8c0 2.21-1.79 4-4 4z" />
        </svg>
    );
}
