import type { MetadataRoute } from "next";
import { SITE_DESCRIPTION, SITE_NAME, THEME_COLOR } from "@/config/site";

export default function manifest(): MetadataRoute.Manifest {
    return {
        name: "Devian: Control Center for AI Coding Agents",
        short_name: SITE_NAME,
        description: SITE_DESCRIPTION,
        start_url: "/",
        display: "standalone",
        background_color: THEME_COLOR,
        theme_color: THEME_COLOR,
        icons: [
            { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
            { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
        ],
    };
}
