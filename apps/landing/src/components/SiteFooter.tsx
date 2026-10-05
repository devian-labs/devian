import Link from "next/link";
import { GITHUB_URL, ORG_NAME, ORG_URL } from "@/config/site";

const linkClass = "text-white/60 hover:text-white underline-offset-4 hover:underline";

export function SiteFooter() {
    return (
        <footer className="px-6 md:px-8 py-8 md:py-12 border-t border-white/[0.05] text-center text-white/40 bg-white/5">
            <p className="text-xs md:text-sm font-medium tracking-wide">
                © 2026 Devian Labs. MIT licensed.{" "}
                <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" className={linkClass}>Source on GitHub</a>{" · "}
                <Link href="/blog" className={linkClass}>Blog</Link>{" · "}
                <a href={`${GITHUB_URL}/blob/main/PRIVACY.md`} target="_blank" rel="noopener noreferrer" className={linkClass}>Privacy</a>{" · "}
                <a href={`${GITHUB_URL}/blob/main/LICENSE`} target="_blank" rel="noopener noreferrer" className={linkClass}>License</a>
            </p>
            <p className="mt-2 text-xs md:text-sm font-medium tracking-wide">
                Built by <a href={ORG_URL} target="_blank" rel="noopener" className={linkClass}>{ORG_NAME}</a>
            </p>
        </footer>
    );
}
