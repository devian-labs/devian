import type { NextConfig } from "next";
import createMDX from "@next/mdx";

const nextConfig: NextConfig = {
  pageExtensions: ["js", "jsx", "md", "mdx", "ts", "tsx"],
  async redirects() {
    return [{ source: "/blog/local-ai-layer", destination: "/blog/how-devian-reads-agent-history", permanent: true }];
  },
};

const withMDX = createMDX({});

export default withMDX(nextConfig);
