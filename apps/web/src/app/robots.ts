// Relative imports: tests/seo.test.ts loads this file, and vitest has no @/ alias.
import type { MetadataRoute } from "next";
import { selfHost } from "../lib/self-host";

// librocat Cloud welcomes every crawler to its public pages, search engines
// and AI assistants alike: an answer engine can only cite what it can read.
// The dashboard, the API, and the MCP endpoint aren't pages; the sign-in
// pages say noindex themselves. A self-hosted librocat is someone's own
// library, so it asks crawlers to stay out.
export default function robots(): MetadataRoute.Robots {
  if (selfHost) return { rules: { userAgent: "*", disallow: "/" } };
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/api/", "/mcp", "/dashboard"] },
    sitemap: "https://librocat.com/sitemap.xml",
  };
}
