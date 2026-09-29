# Devian Landing Page

The marketing site and blog for Devian, built with Next.js (App Router) and MDX.

```bash
# from the repo root
npm install
npm run landing:dev     # http://localhost:3000
npm run landing:build
```

- Blog posts live in `src/app/blog/(posts)/<slug>/page.mdx`. Add new posts to the index in `src/app/blog/page.tsx`.
- The GitHub repo, release API and Homebrew commands are configured in `src/config/site.ts`.
- Download links come from the GitHub Releases API at runtime, so a new release shows up without redeploying the site.

No environment variables are required. Optional ones:

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_APP_URL` | Canonical URL for `sitemap.xml` and `robots.txt` (defaults to `https://devian.app`) |
| `NEXT_PUBLIC_GA_ID` | Google Analytics measurement ID; analytics scripts are omitted when unset |
