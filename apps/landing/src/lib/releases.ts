"use client";

import { useEffect, useState } from "react";
import { RELEASES_API_URL } from "@/config/site";

export interface Asset {
    name: string;
    browser_download_url: string;
    size: number;
}

export interface GithubRelease {
    id: number;
    tag_name: string;
    published_at: string;
    html_url: string;
    draft: boolean;
    prerelease: boolean;
    assets: Asset[];
}

export type Platform = "mac" | "windows" | "linux";

/** Installer files per platform, most useful first. */
const INSTALLERS: Record<Platform, string[]> = {
    mac: [".dmg"],
    windows: ["-setup.exe", ".exe", ".msi"],
    linux: [".AppImage", ".deb"],
};

export function findAsset(release: GithubRelease | null, suffix: string) {
    return release?.assets.find((a) => a.name.endsWith(suffix) && !a.name.endsWith(".sig")) ?? null;
}

export function installers(release: GithubRelease | null, platform: Platform) {
    const seen = new Set<string>();
    return INSTALLERS[platform]
        .map((s) => findAsset(release, s))
        .filter((a): a is Asset => !!a && !seen.has(a.name) && !!seen.add(a.name));
}

export const fmtSize = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(0)} MB`;

export const extension = (name: string) => (name.endsWith("-setup.exe") ? ".exe" : name.slice(name.lastIndexOf(".")));

/**
 * Published releases, newest first. `status` is "none" when the repository
 * has no public release yet, so the page never links to a file that isn't there.
 */
export function useReleases() {
    const [releases, setReleases] = useState<GithubRelease[]>([]);
    const [status, setStatus] = useState<"loading" | "ready" | "none" | "error">("loading");

    useEffect(() => {
        fetch(RELEASES_API_URL)
            .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`GitHub returned ${res.status}`))))
            .then((data: GithubRelease[]) => {
                const published = Array.isArray(data) ? data.filter((r) => !r.draft && !r.prerelease) : [];
                setReleases(published);
                setStatus(published.length ? "ready" : "none");
            })
            .catch(() => setStatus("error"));
    }, []);

    return { releases, latest: releases[0] ?? null, status };
}
