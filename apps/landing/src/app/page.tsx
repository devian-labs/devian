"use client";

import { motion } from "framer-motion";
import { ChevronRight, Activity, Box, Network, HardDrive, ShieldCheck, Github, Heart, Code2, Gauge, FilePenLine, Plug, Users } from "lucide-react";
import Link from "next/link";
import { DownloadsSection } from "@/components/DownloadsSection";
import { GITHUB_URL, LATEST_RELEASE_URL, RELEASES_API_URL } from "@/config/site";
import pkgData from "../../package.json";
import { useState, useEffect } from "react";

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

export default function Home() {
  const [macLink, setMacLink] = useState<string>(LATEST_RELEASE_URL);
  const [releaseTag, setReleaseTag] = useState<string>(`v${pkgData.version}`);

  useEffect(() => {
    fetch(RELEASES_API_URL)
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data) && data.length > 0) {
          const latestRelease: GithubRelease = data[0];
          const dmgAsset = latestRelease.assets.find((a) => a.name.endsWith(".dmg"));
          if (dmgAsset) setMacLink(dmgAsset.browser_download_url);
          setReleaseTag(latestRelease.tag_name);
        }
      })
      .catch((err) => {
        console.error("Failed to fetch releases", err);
      });
  }, []);

  return (
    <div id="top" className="flex flex-col min-h-screen bg-[#121212] text-white selection:bg-primary/30 font-sans">
      {/* Navigation */}
      <nav className="flex items-center justify-between px-4 md:px-8 py-4 border-b border-white/5 sticky top-0 bg-[#121212]/80 backdrop-blur-xl z-50">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-primary/30 to-primary/10 flex items-center justify-center border border-primary/20 shadow-[0_0_15px_rgba(101,140,194,0.3)]">
            <Activity className="h-5 w-5 text-primary" />
          </div>
          <span className="text-xl font-bold tracking-tight">Devian</span>
        </div>

        <div className="hidden md:flex items-center gap-8 text-sm font-medium text-white/70 tracking-wide">
          <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 hover:text-white transition-colors"><Github className="h-4 w-4" />GitHub</a>
          <Link href="/blog" className="hover:text-white transition-colors">Blog</Link>
          <Link href="#download" className="bg-primary/10 text-primary border border-primary/20 px-5 py-2 rounded-full hover:bg-primary hover:text-white transition-all shadow-[0_0_10px_rgba(101,140,194,0.1)]">
            Download
          </Link>
        </div>
      </nav>

      {/* Hero Section */}
      <main className="flex-1 overflow-hidden">
        <section className="relative px-4 md:px-8 pt-20 md:pt-32 pb-24 md:pb-40 text-center max-w-6xl mx-auto">
          {/* Background Glows */}
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[400px] bg-primary/20 blur-[150px] rounded-full pointer-events-none" />

          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease: "easeOut" }}
            className="relative z-10"
          >
            <div className="inline-flex items-center gap-2 px-3 md:px-4 py-1.5 rounded-full bg-white/[0.03] border border-white/[0.08] text-primary text-[10px] md:text-xs font-semibold mb-6 md:mb-8 shadow-sm backdrop-blur-md">
              <Sparkles className="h-3 md:h-3.5 w-3 md:w-3.5" />
              <span className="tracking-wide">Free &amp; Open Source</span>
            </div>

            <h1 className="text-4xl sm:text-5xl md:text-7xl lg:text-8xl font-black tracking-tighter mb-4 sm:mb-6 md:mb-8 text-transparent bg-clip-text bg-gradient-to-b from-white via-white/90 to-white/40 leading-[1.1]">
              Your AI agents work fast.<br className="hidden sm:block" />
              Stay in control.
            </h1>

            <p className="text-base sm:text-lg md:text-xl lg:text-2xl text-white/50 max-w-3xl mx-auto mb-8 sm:mb-10 md:mb-14 leading-relaxed font-light">
              See what Claude Code, Codex, Cursor, OpenCode and Antigravity actually did on your machine: every command, every file, <span className="text-white/80 font-medium">every server they left running.</span>
            </p>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-4 md:gap-5 w-full max-w-md sm:max-w-none mx-auto">
              <a href={macLink} onClick={() => {
                if (typeof window !== 'undefined' && window.gtag) {
                  window.gtag('event', 'download_mac_dmg_hero', {
                    event_category: 'download',
                    event_label: releaseTag,
                  });
                }
              }} download className="group flex items-center gap-3 bg-white text-black px-6 md:px-10 py-4 md:py-5 rounded-2xl font-bold hover:bg-white/90 transition-all w-full sm:w-auto justify-center shadow-[0_0_40px_rgba(255,255,255,0.15)] hover:shadow-[0_0_60px_rgba(255,255,255,0.25)] hover:scale-[1.02] active:scale-[0.98]">
                <AppleLogo className="h-5 w-5" />
                <span className="text-base md:text-lg">Download for macOS (Apple Silicon)</span>
              </a>
              <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" className="group flex items-center gap-2 bg-white/[0.03] border border-white/[0.08] text-white px-6 md:px-10 py-4 md:py-5 rounded-2xl font-bold hover:bg-white/[0.08] transition-all w-full sm:w-auto justify-center backdrop-blur-md hover:border-white/[0.15]">
                <Github className="h-5 w-5" />
                <span className="text-base md:text-lg">Star on GitHub</span>
                <ChevronRight className="h-5 w-5 group-hover:translate-x-1 transition-transform" />
              </a>
            </div>

            <p className="mt-8 text-sm text-white/40 flex items-center justify-center gap-2 font-medium tracking-wide">
              <ShieldCheck className="h-4 w-4" />
              100% Local. Privacy by design.
            </p>
          </motion.div>

          {/* App Preview Placeholder */}
          <motion.div
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 1, delay: 0.3, ease: "easeOut" }}
            className="mt-16 md:mt-28 relative z-10"
          >
            <div className="aspect-square sm:aspect-[4/3] md:aspect-[16/10] w-full max-w-5xl mx-auto bg-[#1e1e1e] rounded-[16px] md:rounded-[24px] shadow-[0_0_50px_rgba(101,140,194,0.15)] md:shadow-[0_0_100px_rgba(101,140,194,0.15)] border border-white/[0.08] flex flex-col overflow-hidden relative group ring-1 ring-white/10">

              {/* Fake OS Window Controls */}
              <div className="absolute top-0 left-0 right-0 h-8 md:h-10 bg-[#1c1c1e] flex items-center px-3 md:px-4 gap-1.5 md:gap-2 border-b border-white/5 z-20 backdrop-blur-md">
                <div className="w-3 h-3 rounded-full bg-[#FF5F56] shadow-sm" />
                <div className="w-3 h-3 rounded-full bg-[#FFBD2E] shadow-sm" />
                <div className="w-3 h-3 rounded-full bg-[#27C93F] shadow-sm" />
              </div>

              {/* The Dashboard Image */}
              <div className="w-full h-full pt-8 md:pt-10 relative z-10">
                <img
                  src="/dashboard.png"
                  alt="Devian Dashboard Preview"
                  className="w-full h-full object-cover object-top opacity-90 group-hover:opacity-100 transition-opacity duration-500"
                />
              </div>

              {/* Decorative inner glows */}
              <div className="absolute -left-32 -top-32 w-96 h-96 bg-primary/20 blur-[120px] opacity-50 pointer-events-none" />
              <div className="absolute -right-32 -bottom-32 w-96 h-96 bg-purple-500/20 blur-[120px] opacity-50 pointer-events-none" />
            </div>
          </motion.div>
        </section>

        {/* Quick Stats / Logo Cloud Alternative */}
        <section className="py-16 md:py-24 border-y border-white/[0.05] bg-white/[0.01] relative overflow-hidden">
          <div className="absolute left-0 top-0 bottom-0 w-16 md:w-32 bg-gradient-to-r from-[#121212] to-transparent z-10" />
          <div className="absolute right-0 top-0 bottom-0 w-16 md:w-32 bg-gradient-to-l from-[#121212] to-transparent z-10" />

          <div className="max-w-6xl mx-auto px-6 md:px-8 grid grid-cols-2 md:grid-cols-4 gap-8 md:gap-12 text-center relative z-0">
            <div>
              <div className="text-3xl md:text-4xl font-black mb-1 md:mb-2 text-white tracking-tight">5</div>
              <div className="text-[10px] md:text-sm text-white/50 uppercase tracking-widest font-bold">Agents Supported</div>
            </div>
            <div>
              <div className="text-3xl md:text-4xl font-black mb-1 md:mb-2 text-primary tracking-tight">MCP</div>
              <div className="text-[10px] md:text-sm text-white/50 uppercase tracking-widest font-bold">Agents Can Ask It</div>
            </div>
            <div>
              <div className="text-3xl md:text-4xl font-black mb-1 md:mb-2 text-white tracking-tight">100%</div>
              <div className="text-[10px] md:text-sm text-white/50 uppercase tracking-widest font-bold">Privacy Focused</div>
            </div>
            <div>
              <div className="text-3xl md:text-4xl font-black mb-1 md:mb-2 text-white tracking-tight">$0</div>
              <div className="text-[10px] md:text-sm text-white/50 uppercase tracking-widest font-bold">Free, No Account</div>
            </div>
          </div>
        </section>

        {/* Features Section */}
        <section id="features" className="px-6 md:px-8 py-20 md:py-36 max-w-7xl mx-auto">
          <div className="text-center mb-12 md:mb-24">
            <h2 className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-black mb-4 md:mb-6 tracking-tight">Know what your agents did</h2>
            <p className="text-base sm:text-lg md:text-xl text-white/50 max-w-2xl mx-auto font-light leading-relaxed">
              Agents run commands, start servers and write memory you never look at. Devian reads their local history and watches their processes, so you stay the one in charge.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
            {/* Session timeline */}
            <div className="col-span-1 md:col-span-8 bg-gradient-to-br from-white/[0.03] to-white/[0.01] border border-white/[0.05] rounded-[24px] md:rounded-[32px] p-8 md:p-10 hover:border-white/[0.1] transition-all group relative overflow-hidden">
              <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-primary/10 blur-[100px] -translate-y-1/2 translate-x-1/3 opacity-0 group-hover:opacity-100 transition-opacity duration-700" />

              <div className="relative z-10">
                <div className="flex items-start justify-between mb-8 md:mb-10">
                  <div className="h-12 w-12 md:h-14 md:w-14 rounded-xl md:rounded-2xl bg-primary/10 flex items-center justify-center border border-primary/20 shadow-inner">
                    <Activity className="h-6 w-6 md:h-7 md:w-7 text-primary" />
                  </div>
                  <div className="px-3 md:px-4 py-1 md:py-1.5 rounded-full bg-white/[0.05] border border-white/[0.1] text-white/70 text-[8px] md:text-[10px] font-bold uppercase tracking-widest backdrop-blur-md">Every agent</div>
                </div>
                <h3 className="text-2xl md:text-3xl font-bold mb-3 md:mb-4">Session timeline</h3>
                <p className="text-white/50 leading-relaxed max-w-md text-base md:text-lg font-light">
                  One timeline across all your agents: what you asked, every command they ran, every file they touched. Force pushes, sudo, rm -rf and .env edits get flagged.
                </p>
                <div className="mt-10 flex flex-wrap gap-3">
                  <div className="px-4 py-2 rounded-xl bg-white/5 border border-white/[0.05] text-sm font-medium flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-[#d95926]" />Claude Code</div>
                  <div className="px-4 py-2 rounded-xl bg-white/5 border border-white/[0.05] text-sm font-medium flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-[#3987e5]" />Codex</div>
                  <div className="px-4 py-2 rounded-xl bg-white/5 border border-white/[0.05] text-sm font-medium flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-[#c98500]" />Cursor</div>
                  <div className="px-4 py-2 rounded-xl bg-white/5 border border-white/[0.05] text-sm font-medium flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-[#199e70]" />OpenCode</div>
                  <div className="px-4 py-2 rounded-xl bg-white/5 border border-white/[0.05] text-sm font-medium flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-[#d55181]" />Antigravity</div>
                </div>
              </div>
            </div>

            {/* Leftover sweep */}
            <div className="col-span-1 md:col-span-4 bg-gradient-to-br from-white/[0.03] to-white/[0.01] border border-white/[0.05] rounded-[24px] md:rounded-[32px] p-8 md:p-10 hover:border-white/[0.1] transition-all group relative overflow-hidden">
              <div className="absolute bottom-0 right-0 w-[300px] h-[300px] bg-purple-500/10 blur-[80px] translate-y-1/2 translate-x-1/4 opacity-0 group-hover:opacity-100 transition-opacity duration-700" />

              <div className="relative z-10 flex flex-col h-full">
                <div className="h-12 w-12 md:h-14 md:w-14 rounded-xl md:rounded-2xl bg-purple-500/10 flex items-center justify-center border border-purple-500/20 mb-6 md:mb-10 shadow-inner">
                  <Network className="h-6 w-6 md:h-7 md:w-7 text-purple-400" />
                </div>
                <div>
                  <h3 className="text-2xl md:text-3xl font-bold mb-3 md:mb-4">Leftover sweep</h3>
                  <p className="text-white/50 leading-relaxed text-base md:text-lg font-light">
                    Dev servers, test runners and containers that outlive the session are traced back to the agent that started them. Stop them all in one click.
                  </p>
                </div>
              </div>
            </div>

            {/* Docker Adapter */}
            <div className="col-span-1 md:col-span-4 bg-gradient-to-br from-white/[0.03] to-white/[0.01] border border-white/[0.05] rounded-[24px] md:rounded-[32px] p-8 md:p-10 hover:border-white/[0.1] transition-all group relative overflow-hidden">
              <div className="absolute top-0 left-0 w-[300px] h-[300px] bg-blue-500/10 blur-[80px] -translate-y-1/4 -translate-x-1/4 opacity-0 group-hover:opacity-100 transition-opacity duration-700" />

              <div className="relative z-10 flex flex-col h-full">
                <div className="h-12 w-12 md:h-14 md:w-14 rounded-xl md:rounded-2xl bg-blue-500/10 flex items-center justify-center border border-blue-500/20 mb-6 md:mb-10 shadow-inner">
                  <Box className="h-6 w-6 md:h-7 md:w-7 text-blue-400" />
                </div>
                <div>
                  <h3 className="text-2xl md:text-3xl font-bold mb-3 md:mb-4">Tokens & spend</h3>
                  <p className="text-white/50 leading-relaxed text-base md:text-lg font-light">
                    Tokens per agent, project and model, priced at list rates, so you know what a day of agent work really costs.
                  </p>
                </div>
              </div>
            </div>

            {/* Disk Analyzer */}
            <div className="col-span-1 md:col-span-8 bg-gradient-to-br from-white/[0.03] to-white/[0.01] border border-white/[0.05] rounded-[24px] md:rounded-[32px] p-8 md:p-10 hover:border-white/[0.1] transition-all group relative overflow-hidden flex flex-col justify-between">
              <div className="absolute bottom-0 left-0 w-[500px] h-[500px] bg-amber-500/10 blur-[100px] translate-y-1/3 -translate-x-1/4 opacity-0 group-hover:opacity-100 transition-opacity duration-700" />

              <div className="relative z-10">
                <div className="h-12 w-12 md:h-14 md:w-14 rounded-xl md:rounded-2xl bg-amber-500/10 flex items-center justify-center border border-amber-500/20 mb-6 md:mb-10 shadow-inner">
                  <HardDrive className="h-6 w-6 md:h-7 md:w-7 text-amber-400" />
                </div>
                <h3 className="text-2xl md:text-3xl font-bold mb-3 md:mb-4">Clean up after them</h3>
                <p className="text-white/50 leading-relaxed max-w-lg text-base md:text-lg font-light">
                  Old transcripts, rewind checkpoints, undo snapshots and editor caches pile up for good. Take the space back, along with node_modules and Docker leftovers.
                </p>
              </div>

              <div className="relative z-10 mt-10 p-4 rounded-2xl bg-white/5 border border-white/[0.05] inline-block font-mono text-sm text-white/40">
                Scanning... <span className="text-amber-400">Claude Code left 2 dev servers and 1 container running (1.4 GB).</span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mt-6">
            {MORE_FEATURES.map((f) => (
              <div key={f.title} className="bg-gradient-to-br from-white/[0.03] to-white/[0.01] border border-white/[0.05] rounded-[24px] p-7 hover:border-white/[0.1] transition-all">
                <div className="h-11 w-11 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center mb-6">{f.icon}</div>
                <h3 className="text-xl font-bold mb-2">{f.title}</h3>
                <p className="text-white/50 leading-relaxed font-light">{f.body}</p>
              </div>
            ))}
          </div>
        </section>


        {/* Open Source Section */}
        <OpenSourceSection />

        {/* Download Section */}
        <DownloadsSection />
      </main>

      {/* Footer */}
      <footer className="px-6 md:px-8 py-8 md:py-12 border-t border-white/[0.05] text-center text-white/40 bg-white/5">
        <p className="text-xs md:text-sm font-medium tracking-wide">
          © 2026 Devian Labs. MIT licensed.{" "}
          <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" className="text-white/60 hover:text-white underline-offset-4 hover:underline">Source on GitHub</a>{" · "}
          <a href={`${GITHUB_URL}/blob/main/PRIVACY.md`} target="_blank" rel="noopener noreferrer" className="text-white/60 hover:text-white underline-offset-4 hover:underline">Privacy</a>
        </p>
      </footer>
    </div>
  );
}

const MORE_FEATURES = [
  { icon: <Gauge className="h-5 w-5 text-primary" />, title: "Plan limits", body: "Your Claude and Codex 5-hour and weekly limits, and when they reset, always in the top bar." },
  { icon: <Users className="h-5 w-5 text-orange-400" />, title: "Every Claude account", body: "Personal, work, Bedrock: each Claude Code config folder shows up on its own. Include only the ones you want." },
  { icon: <FilePenLine className="h-5 w-5 text-emerald-400" />, title: "Memory editor", body: "Read, edit and prune CLAUDE.md, AGENTS.md and saved memories right in the app. No editor round-trip." },
  { icon: <Plug className="h-5 w-5 text-purple-400" />, title: "MCP server", body: "Connect it once and your agents can ask Devian what's running, what they changed and what's safe to stop." },
];

function OpenSourceSection() {
  const points = [
    { icon: <Heart className="h-5 w-5 text-rose-400" />, title: "Free forever", body: "Every feature is free: sessions, leftovers, memory, usage and limits, cleanup and the MCP server. No accounts, no license keys, no trials." },
    { icon: <Code2 className="h-5 w-5 text-primary" />, title: "MIT licensed", body: "Read the code, fork it, ship it inside your own tools. Devian is built in the open with Tauri, Rust and React." },
    { icon: <ShieldCheck className="h-5 w-5 text-emerald-400" />, title: "Local by default", body: "Your code, prompts and agent history stay on your machine. Auditable, because the source is right there." },
  ];

  return (
    <section id="open-source" className="px-6 md:px-8 py-20 md:py-32 max-w-6xl mx-auto border-t border-white/[0.05]">
      <div className="text-center mb-12 md:mb-16">
        <h2 className="text-3xl sm:text-4xl md:text-5xl font-black mb-4 md:mb-6 tracking-tight">Open source, all of it.</h2>
        <p className="text-base sm:text-lg md:text-xl text-white/50 font-light max-w-2xl mx-auto">
          Devian is a community project. Contributions, bug reports and ideas are welcome.
        </p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6">
        {points.map((p) => (
          <div key={p.title} className="bg-white/[0.02] border border-white/[0.06] rounded-3xl p-6 md:p-8">
            <div className="h-11 w-11 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center mb-5">{p.icon}</div>
            <h3 className="text-xl font-bold mb-2">{p.title}</h3>
            <p className="text-white/50 leading-relaxed font-light">{p.body}</p>
          </div>
        ))}
      </div>
      <div className="flex justify-center mt-10 md:mt-12">
        <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 bg-white/[0.03] border border-white/[0.08] text-white px-6 py-3 rounded-2xl font-semibold hover:bg-white/[0.08] transition-all">
          <Github className="h-5 w-5" /> Contribute on GitHub
        </a>
      </div>
    </section>
  );
}

function Sparkles({ className }: { className?: string }) {
  return (
    <svg className={className} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" /></svg>
  );
}

function AppleLogo({ className }: { className?: string }) {
  return (
    <svg className={className} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 384 512" fill="currentColor">
      <path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z" />
    </svg>
  );
}
