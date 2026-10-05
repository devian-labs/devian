"use client";

import Link from "next/link";
import { ArrowLeft, Activity } from "lucide-react";
import { SiteFooter } from "@/components/SiteFooter";

export default function BlogLayout({ children }: { children: React.ReactNode }) {
    return (
        <div className="min-h-screen bg-[#121212] text-white selection:bg-primary/30 font-sans">
            {/* Navigation */}
            <nav className="fixed top-0 left-0 right-0 h-16 border-b border-white/5 bg-[#121212]/80 backdrop-blur-xl z-[60] flex items-center justify-between px-4 md:px-8">
                <Link href="/blog" className="flex items-center gap-3">
                    <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-primary/30 to-primary/10 flex items-center justify-center border border-primary/20 shadow-[0_0_15px_rgba(101,140,194,0.3)]">
                        <Activity className="h-4 w-4 text-primary" />
                    </div>
                    <span className="text-lg font-bold tracking-tight">Devian Blog</span>
                </Link>
                <Link href="/" className="text-sm font-medium text-white/70 hover:text-white transition-colors">Home</Link>
            </nav>

            <main className="max-w-4xl mx-auto pt-32 px-6 md:px-8 pb-32">
                <Link href="/blog" className="inline-flex items-center gap-2 text-sm font-medium text-white/50 hover:text-white transition-all mb-12 bg-white/5 hover:bg-white/10 px-4 py-2 rounded-full border border-white/5">
                    <ArrowLeft className="h-4 w-4" /> Back to Blog
                </Link>

                <div className="prose prose-invert prose-primary max-w-none prose-headings:font-black prose-headings:tracking-tight prose-a:text-primary hover:prose-a:text-primary/80 prose-img:rounded-2xl prose-img:border prose-img:border-white/10 prose-hr:border-white/10">
                    {children}
                </div>
            </main>
            <SiteFooter />
        </div>
    );
}
