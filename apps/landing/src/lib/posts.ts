import type { Metadata } from "next";
import { OG_IMAGES, TWITTER_IMAGES } from "@/config/site";

export interface Post {
    slug: string;
    /** Shown on the blog index card. */
    title: string;
    /** `<title>`, ~50–60 characters. */
    seoTitle: string;
    /** Meta description, ~120–160 characters. */
    description: string;
    excerpt: string;
    /** ISO date (YYYY-MM-DD). */
    date: string;
    author: string;
    tags: string[];
}

/** Every blog post, newest first. Add new posts here and in `src/app/blog/(posts)/<slug>/page.mdx`. */
export const POSTS: Post[] = [
    {
        slug: "introducing-devian",
        title: "Devian 2.0: Stay in control of your AI agents",
        seoTitle: "Devian 2.0: Stay in Control of Your AI Coding Agents",
        description:
            "Devian 2.0 puts Claude Code, Codex, Cursor, OpenCode and Antigravity sessions, leftover servers, memory, token spend and plan limits in one free app.",
        excerpt:
            "One place to see what Claude Code, Codex, Cursor, OpenCode and Antigravity did on your machine, clean up after them and track what they cost. Free and open source.",
        date: "2026-09-29",
        author: "Devian Team",
        tags: ["Release", "AI agents"],
    },
    {
        slug: "how-devian-reads-agent-history",
        title: "How Devian reads your agents' history",
        seoTitle: "How Devian Reads Claude Code, Codex & Cursor History",
        description:
            "Where Claude Code, Codex, Cursor, OpenCode and Antigravity keep their history, how Devian counts tokens without double-counting and traces leftovers.",
        excerpt:
            "Where each agent keeps its transcripts, how tokens are counted without double-counting, and how leftover processes are traced back to a session.",
        date: "2026-09-29",
        author: "Engineering",
        tags: ["Engineering", "Privacy"],
    },
];

export function getPost(slug: string): Post {
    const post = POSTS.find((p) => p.slug === slug);
    if (!post) throw new Error(`Unknown blog post: ${slug}`);
    return post;
}

export const postPath = (slug: string) => `/blog/${slug}`;

export const formatPostDate = (iso: string) =>
    new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });

/** `metadata` export for a post's page.mdx. */
export function postMetadata(slug: string): Metadata {
    const post = getPost(slug);
    return {
        title: { absolute: post.seoTitle },
        description: post.description,
        alternates: { canonical: postPath(slug) },
        openGraph: {
            type: "article",
            locale: "en_US",
            siteName: "Devian",
            url: postPath(slug),
            title: post.seoTitle,
            description: post.description,
            publishedTime: post.date,
            authors: [post.author],
            tags: post.tags,
            images: OG_IMAGES,
        },
        twitter: {
            card: "summary_large_image",
            title: post.seoTitle,
            description: post.description,
            images: TWITTER_IMAGES,
        },
    };
}
