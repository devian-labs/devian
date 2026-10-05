import type { Metadata } from "next";
import { BlogIndex } from "@/components/BlogIndex";
import { BlogIndexJsonLd } from "@/components/JsonLd";
import { OG_IMAGES, TWITTER_IMAGES } from "@/config/site";

const title = "AI Coding Agents Blog: Releases & Engineering Notes";
const description =
    "Release notes and engineering posts from the Devian team on keeping AI coding agents like Claude Code, Codex and Cursor visible, tidy and affordable.";

export const metadata: Metadata = {
    title,
    description,
    alternates: { canonical: "/blog" },
    openGraph: {
        type: "website",
        locale: "en_US",
        siteName: "Devian",
        url: "/blog",
        title: `${title} | Devian`,
        description,
        images: OG_IMAGES,
    },
    twitter: {
        card: "summary_large_image",
        title: `${title} | Devian`,
        description,
        images: TWITTER_IMAGES,
    },
};

export default function Page() {
    return (
        <>
            <BlogIndexJsonLd />
            <BlogIndex />
        </>
    );
}
