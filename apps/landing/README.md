# Devian Landing Page

The marketing site and blog for Devian, built with Next.js (App Router) and MDX.

```bash
# from the repo root
npm install
npm run landing:dev     # http://localhost:3000
npm run landing:build
```

- Blog posts live in `src/app/blog/(posts)/<slug>/page.mdx`. Register each post (title, SEO title, description, date) in `src/lib/posts.ts`; the blog index, sitemap, metadata and JSON-LD all read from it.
- The GitHub repo, release API and Homebrew commands are configured in `src/config/site.ts`.
- Download links come from the GitHub Releases API at runtime, so a new release shows up without redeploying the site.

No environment variables are required. Optional ones:

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_APP_URL` | Canonical URL for metadata, `sitemap.xml`, `robots.txt` and JSON-LD (defaults to `https://devian.app`) |
| `NEXT_PUBLIC_GA_ID` | Google Analytics measurement ID; analytics scripts are omitted when unset |
