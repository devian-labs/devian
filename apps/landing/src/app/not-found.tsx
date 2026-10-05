import type { Metadata } from "next";
import Link from "next/link";
import { SiteFooter } from "@/components/SiteFooter";

export const metadata: Metadata = {
    title: "Page not found",
    robots: { index: false, follow: true },
};

export default function NotFound() {
    return (
        <div className="flex flex-col min-h-screen bg-[#121212] text-white font-sans">
            <main className="flex-1 flex flex-col items-center justify-center text-center px-6 py-24">
                <p className="text-sm font-semibold text-primary tracking-wide mb-4">404</p>
                <h1 className="text-3xl md:text-5xl font-black tracking-tight mb-4">Page not found</h1>
                <p className="text-white/50 mb-10 max-w-md">The page you&apos;re looking for doesn&apos;t exist or has moved.</p>
                <div className="flex gap-3">
                    <Link href="/" className="bg-white text-black px-5 py-2.5 rounded-xl text-sm font-bold hover:bg-white/90">Go home</Link>
                    <Link href="/blog" className="bg-white/5 border border-white/10 px-5 py-2.5 rounded-xl text-sm font-semibold hover:bg-white/10">Read the blog</Link>
                </div>
            </main>
            <SiteFooter />
        </div>
    );
}
