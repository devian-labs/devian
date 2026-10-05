"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { MessageSquare } from "lucide-react";
import { SiteFooter } from "@/components/SiteFooter";
import { formatPostDate, POSTS as posts } from "@/lib/posts";

export function BlogIndex() {
    return (
        <div className="min-h-screen bg-[#121212] text-white selection:bg-primary/30 font-sans">
            {/* Navigation */}
            <nav className="flex items-center justify-between px-4 md:px-8 py-4 border-b border-white/5 sticky top-0 bg-[#121212]/80 backdrop-blur-xl z-50">
                <Link href="/" className="flex items-center gap-3">
                    <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-primary/30 to-primary/10 flex items-center justify-center border border-primary/20 shadow-[0_0_15px_rgba(101,140,194,0.3)]">
                        <MessageSquare className="h-5 w-5 text-primary" />
                    </div>
                    <span className="text-xl font-bold tracking-tight">Devian</span>
                </Link>
                <Link href="/" className="text-sm font-medium text-white/70 hover:text-white transition-colors">Home</Link>
            </nav>

            <main className="max-w-7xl mx-auto px-6 md:px-8 py-16 md:py-24">
                <header className="mb-12 md:mb-16">
                    <h1 className="text-3xl md:text-4xl font-black tracking-tight mb-3 text-white">Devian Blog</h1>
                </header>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 md:gap-8">
                    {posts.map((post, idx) => (
                        <motion.article
                            key={idx}
                            initial={{ opacity: 0, y: 20 }}
                            whileInView={{ opacity: 1, y: 0 }}
                            viewport={{ once: true }}
                            transition={{ delay: idx * 0.1, duration: 0.5, ease: "easeOut" }}
                            className="flex"
                        >
                            <Link href={`/blog/${post.slug}`} className="block w-full">
                                <div className="h-full bg-white/[0.02] border border-white/5 hover:border-white/10 hover:bg-white/[0.04] rounded-[16px] md:rounded-[20px] p-6 md:p-8 transition-all duration-300 flex flex-col justify-start">
                                    <time dateTime={post.date} className="text-sm font-medium text-white/40 mb-3 block">{formatPostDate(post.date)}</time>

                                    <h2 className="text-2xl md:text-3xl font-bold mb-4 text-white/95 leading-tight group-hover:text-primary transition-colors">{post.title}</h2>

                                    <p className="text-base md:text-lg text-white/60 leading-relaxed font-light mb-6 md:mb-8 flex-grow">{post.excerpt}</p>

                                    <div className="flex flex-wrap gap-2 mt-auto pt-4 border-t border-white/[0.05]">
                                        {post.tags.map(tag => (
                                            <span
                                                key={tag}
                                                className="px-3.5 py-1.5 rounded-full bg-white/[0.04] text-xs font-semibold text-white/60 lowercase tracking-wide"
                                            >
                                                {tag}
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            </Link>
                        </motion.article>
                    ))}
                </div>
            </main>
            <SiteFooter />
        </div>
    );
}
