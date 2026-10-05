import {
    GITHUB_URL,
    LATEST_RELEASE_URL,
    ORG_GITHUB_URL,
    ORG_LOGO_URL,
    ORG_NAME,
    ORG_URL,
    SITE_DESCRIPTION,
    SITE_NAME,
    SITE_URL,
} from "@/config/site";
import { getPost, postPath } from "@/lib/posts";

type Json = Record<string, unknown>;

const ORG_ID = `${ORG_URL}/#organization`;
const WEBSITE_ID = `${SITE_URL}/#website`;
const APP_ID = `${SITE_URL}/#software`;
const abs = (path: string) => `${SITE_URL}${path === "/" ? "" : path}`;

/** Renders schema.org JSON-LD as a native script tag (per the Next.js JSON-LD guide). */
export function JsonLd({ data }: { data: Json }) {
    return (
        <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }}
        />
    );
}

const breadcrumbs = (items: [name: string, path: string][]): Json => ({
    "@type": "BreadcrumbList",
    itemListElement: items.map(([name, path], i) => ({ "@type": "ListItem", position: i + 1, name, item: abs(path) })),
});

/** Organization + WebSite, rendered once in the root layout. */
export function SiteJsonLd() {
    return (
        <JsonLd
            data={{
                "@context": "https://schema.org",
                "@graph": [
                    {
                        "@type": "Organization",
                        "@id": ORG_ID,
                        name: ORG_NAME,
                        url: ORG_URL,
                        logo: { "@type": "ImageObject", url: ORG_LOGO_URL },
                        sameAs: [ORG_GITHUB_URL],
                    },
                    {
                        "@type": "WebSite",
                        "@id": WEBSITE_ID,
                        name: SITE_NAME,
                        url: SITE_URL,
                        inLanguage: "en-US",
                        publisher: { "@id": ORG_ID },
                    },
                ],
            }}
        />
    );
}

/** The desktop app itself, on the home page. */
export function SoftwareJsonLd() {
    return (
        <JsonLd
            data={{
                "@context": "https://schema.org",
                "@type": "SoftwareApplication",
                "@id": APP_ID,
                name: SITE_NAME,
                alternateName: "Devian Desktop",
                description: SITE_DESCRIPTION,
                url: SITE_URL,
                applicationCategory: "DeveloperApplication",
                operatingSystem: "macOS 12+ (Apple Silicon), Windows 10+, Linux (Ubuntu 22.04+)",
                downloadUrl: LATEST_RELEASE_URL,
                screenshot: abs("/dashboard.png"),
                image: abs("/icon-512.png"),
                isAccessibleForFree: true,
                license: "https://opensource.org/licenses/MIT",
                offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
                featureList: [
                    "Session timeline across Claude Code, Codex, Cursor, OpenCode and Antigravity",
                    "Leftover dev servers, test runners and containers traced back to the agent that started them",
                    "Token usage and spend per agent, project and model",
                    "Claude and Codex plan limits",
                    "Memory editor for CLAUDE.md, AGENTS.md and saved memories",
                    "Cleanup of old transcripts, checkpoints, caches, node_modules and Docker leftovers",
                    "MCP server for your agents",
                ],
                sameAs: [GITHUB_URL],
                publisher: { "@id": ORG_ID },
                author: { "@id": ORG_ID },
            }}
        />
    );
}

export function BlogIndexJsonLd() {
    return (
        <JsonLd
            data={{
                "@context": "https://schema.org",
                ...breadcrumbs([
                    ["Home", "/"],
                    ["Blog", "/blog"],
                ]),
            }}
        />
    );
}

export function PostJsonLd({ slug }: { slug: string }) {
    const post = getPost(slug);
    const url = abs(postPath(slug));
    return (
        <JsonLd
            data={{
                "@context": "https://schema.org",
                "@graph": [
                    {
                        "@type": "BlogPosting",
                        "@id": `${url}#article`,
                        headline: post.seoTitle,
                        description: post.description,
                        url,
                        mainEntityOfPage: url,
                        datePublished: post.date,
                        dateModified: post.date,
                        inLanguage: "en-US",
                        keywords: post.tags.join(", "),
                        image: abs("/opengraph-image"),
                        author: { "@type": "Organization", name: ORG_NAME, url: ORG_URL },
                        publisher: { "@id": ORG_ID, "@type": "Organization", name: ORG_NAME, url: ORG_URL, logo: { "@type": "ImageObject", url: ORG_LOGO_URL } },
                        isPartOf: { "@id": WEBSITE_ID },
                    },
                    breadcrumbs([
                        ["Home", "/"],
                        ["Blog", "/blog"],
                        [post.title, postPath(slug)],
                    ]),
                ],
            }}
        />
    );
}
