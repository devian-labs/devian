import type { Metadata } from "next";
import { HomePage } from "@/components/HomePage";
import { SoftwareJsonLd } from "@/components/JsonLd";
import { SITE_DESCRIPTION, SITE_TITLE } from "@/config/site";

export const metadata: Metadata = {
  title: { absolute: SITE_TITLE },
  description: SITE_DESCRIPTION,
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    locale: "en_US",
    siteName: "Devian",
    url: "/",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
  },
};

export default function Page() {
  return (
    <>
      <SoftwareJsonLd />
      <HomePage />
    </>
  );
}
