"use client";

import { useState } from "react";
import { BellRing, ChevronDown, Copy, Download, Terminal } from "lucide-react";
import { GITHUB_URL, HOMEBREW_COMMANDS } from "@/config/site";
import { extension, fmtSize, installers, type Asset, type Platform, useReleases } from "@/lib/releases";

const track = (event: string, label: string) => {
    if (typeof window !== "undefined" && window.gtag) window.gtag("event", event, { event_category: "download", event_label: label });
};

const PLATFORMS: { id: Platform; name: string; requirement: string; Logo: (p: { className?: string }) => React.ReactElement; tone: string }[] = [
    { id: "mac", name: "macOS", requirement: "Apple Silicon · macOS 12+", Logo: AppleLogo, tone: "text-white" },
    { id: "windows", name: "Windows", requirement: "Windows 10+ · x64", Logo: WindowsLogo, tone: "text-blue-400" },
    { id: "linux", name: "Linux", requirement: "Ubuntu 22.04+ · x64", Logo: LinuxLogo, tone: "text-orange-400" },
];

function CopyBlock({ label, lines, event }: { label: string; lines: string[]; event: string }) {
    const [copied, setCopied] = useState(false);
    return (
        <div className="w-full bg-[#0A0A0C] border border-white/10 rounded-2xl overflow-hidden">
            <div className="bg-white/5 px-4 py-2.5 border-b border-white/5 flex items-center justify-between gap-3">
                <span className="flex items-center gap-2 text-xs font-mono text-white/50"><Terminal className="h-3.5 w-3.5" />{label}</span>
                <button
                    onClick={() => {
                        navigator.clipboard.writeText(lines.join("\n")).catch(() => {});
                        setCopied(true);
                        track(event, label);
                        setTimeout(() => setCopied(false), 2000);
                    }}
                    className="text-white/40 hover:text-white transition flex items-center gap-1.5 text-xs bg-white/5 hover:bg-white/10 px-3 py-1.5 rounded-lg"
                >
                    <Copy className="h-3.5 w-3.5" />{copied ? "Copied" : "Copy"}
                </button>
            </div>
            <pre className="p-5 text-[13px] md:text-sm font-mono text-[#4ADE80] text-left overflow-x-auto">{lines.map((l) => `$ ${l}`).join("\n")}</pre>
        </div>
    );
}

function PlatformCard({ platform, files, version }: { platform: (typeof PLATFORMS)[number]; files: Asset[]; version: string }) {
    const [primary, ...others] = files;
    const { Logo } = platform;
    return (
        <div className={`rounded-2xl p-5 flex flex-col gap-4 text-left ${platform.id === "mac" ? "bg-white text-black" : "bg-[#0A0A0C] border border-white/10 text-white"}`}>
            <div className="flex items-center gap-3">
                <div className={`h-10 w-10 rounded-xl flex items-center justify-center ${platform.id === "mac" ? "bg-black/5" : "bg-white/5 border border-white/10"}`}>
                    <Logo className={`h-5 w-5 ${platform.id === "mac" ? "text-black" : platform.tone}`} />
                </div>
                <div>
                    <div className="text-sm font-bold">{platform.name}</div>
                    <div className={`text-[11px] ${platform.id === "mac" ? "text-black/45" : "text-white/40"}`}>{platform.requirement}</div>
                </div>
            </div>
            {primary ? (
                <>
                    <a
                        href={primary.browser_download_url}
                        onClick={() => track(`download_${platform.id}`, version)}
                        className={`flex items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-bold transition-colors ${platform.id === "mac" ? "bg-black text-white hover:bg-black/85" : "bg-white/10 hover:bg-white/15"}`}
                    >
                        <Download className="h-4 w-4" /> Download {extension(primary.name)}
                    </a>
                    <div className={`text-[11px] -mt-1 text-center ${platform.id === "mac" ? "text-black/45" : "text-white/40"}`}>
                        {fmtSize(primary.size)}
                        {others.length > 0 && <> · also{" "}
                            {others.map((a, i) => (
                                <span key={a.name}>
                                    {i > 0 && ", "}
                                    <a href={a.browser_download_url} onClick={() => track(`download_${platform.id}`, version)} className="underline underline-offset-2 hover:opacity-80">{extension(a.name)}</a>
                                </span>
                            ))}
                        </>}
                    </div>
                </>
            ) : (
                <div className={`rounded-xl py-2.5 text-center text-sm ${platform.id === "mac" ? "bg-black/5 text-black/45" : "bg-white/5 text-white/40"}`}>Not in this release</div>
            )}
        </div>
    );
}

export function DownloadsSection() {
    const { releases, latest, status } = useReleases();
    const [showHistory, setShowHistory] = useState(false);
    const older = releases.slice(1);

    return (
        <section id="download" className="px-6 md:px-8 py-20 md:py-32 max-w-5xl mx-auto text-center border-t border-white/[0.05]">
            <h2 className="text-3xl sm:text-4xl md:text-5xl font-black mb-4 md:mb-6 tracking-tight">Ready to take control?</h2>
            <p className="text-base sm:text-lg md:text-xl text-white/50 mb-10 md:mb-14 font-light">Free, with every feature. No account, no license key.</p>

            {status === "loading" && (
                <div className="flex justify-center items-center h-32"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white/20" /></div>
            )}

            {(status === "none" || status === "error") && (
                <div className="max-w-2xl mx-auto rounded-2xl border border-white/10 bg-white/[0.02] p-8 space-y-5">
                    <div className="mx-auto h-11 w-11 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center"><BellRing className="h-5 w-5 text-primary" /></div>
                    <div className="space-y-2">
                        <p className="text-lg font-bold">{status === "none" ? "Devian 2.0 is almost here" : "Couldn't load the downloads"}</p>
                        <p className="text-sm text-white/50 leading-relaxed">
                            {status === "none"
                                ? "Installers for macOS, Windows and Linux will be published on GitHub shortly. Watch the repository for releases to get notified the moment they're out."
                                : "GitHub didn't answer just now. Every installer is also listed on the releases page."}
                        </p>
                    </div>
                    <div className="flex flex-col sm:flex-row gap-3 justify-center">
                        <a href={status === "none" ? GITHUB_URL : `${GITHUB_URL}/releases`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center justify-center gap-2 bg-white text-black px-5 py-2.5 rounded-xl text-sm font-bold hover:bg-white/90">
                            {status === "none" ? "Watch on GitHub" : "Open releases"}
                        </a>
                        <a href={`${GITHUB_URL}#readme`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center justify-center gap-2 bg-white/5 border border-white/10 px-5 py-2.5 rounded-xl text-sm font-semibold hover:bg-white/10">
                            Build from source
                        </a>
                    </div>
                </div>
            )}

            {status === "ready" && latest && (
                <div className="flex flex-col items-center gap-8 max-w-3xl mx-auto">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 w-full">
                        {PLATFORMS.map((p) => <PlatformCard key={p.id} platform={p} files={installers(latest, p.id)} version={latest.tag_name} />)}
                    </div>
                    <p className="text-xs md:text-sm text-white/40">
                        Latest: <a href={latest.html_url} target="_blank" rel="noopener noreferrer" className="text-white/80 hover:text-white">{latest.tag_name}</a>
                        {" "}· {new Date(latest.published_at).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })} · updates install from inside the app
                    </p>

                    <div className="flex flex-col gap-4 w-full max-w-2xl">
                        <CopyBlock label="Or with Homebrew (macOS)" lines={HOMEBREW_COMMANDS} event="copy_brew_command" />
                        <div className="text-left space-y-2">
                            <CopyBlock label="If macOS says the app can't be opened" lines={["xattr -dr com.apple.quarantine /Applications/Devian*.app"]} event="copy_quarantine_command" />
                            <p className="text-[11px] text-white/35 px-1">Devian isn&apos;t notarized by Apple yet. This clears the download flag so macOS lets it open.</p>
                        </div>
                    </div>

                    {older.length > 0 && (
                        <div className="w-full">
                            <button onClick={() => setShowHistory(!showHistory)} className="flex items-center justify-center gap-2 text-white/50 hover:text-white transition-colors text-sm font-medium mx-auto" aria-expanded={showHistory}>
                                Earlier versions <ChevronDown className={`h-4 w-4 transition-transform ${showHistory ? "rotate-180" : ""}`} />
                            </button>
                            {showHistory && (
                                <ul className="mt-6 divide-y divide-white/5 rounded-2xl border border-white/10 bg-[#0A0A0C] text-left">
                                    {older.map((r) => (
                                        <li key={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 text-sm">
                                            <a href={r.html_url} target="_blank" rel="noopener noreferrer" className="font-medium text-white hover:underline">{r.tag_name}</a>
                                            <span className="text-white/40">{new Date(r.published_at).toLocaleDateString()}</span>
                                            <span className="ml-auto flex gap-3">
                                                {PLATFORMS.flatMap((p) => installers(r, p.id).slice(0, 1)).map((a) => (
                                                    <a key={a.name} href={a.browser_download_url} className="text-white/60 hover:text-white">{extension(a.name)}</a>
                                                ))}
                                            </span>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>
                    )}
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
