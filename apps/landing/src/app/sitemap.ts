import type { MetadataRoute } from "next";
import { SITE_URL } from "@/config/site";
import { POSTS, postPath } from "@/lib/posts";

export default function sitemap(): MetadataRoute.Sitemap {
    const latestPost = POSTS.map((p) => p.date).sort().at(-1);

    return [
        {
            url: SITE_URL,
            lastModified: new Date(),
            changeFrequency: "weekly",
            priority: 1,
        },
        {
            url: `${SITE_URL}/blog`,
            lastModified: latestPost,
            changeFrequency: "weekly",
            priority: 0.8,
        },
        ...POSTS.map((post) => ({
            url: `${SITE_URL}${postPath(post.slug)}`,
            lastModified: post.date,
            changeFrequency: "monthly" as const,
            priority: 0.6,
        })),
    ];
}
