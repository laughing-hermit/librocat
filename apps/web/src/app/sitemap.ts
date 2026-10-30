// Relative imports: tests/seo.test.ts loads this file, and vitest has no @/ alias.
import type { MetadataRoute } from "next";
import { selfHost } from "../lib/self-host";
import { site } from "../lib/site";

const BASE = "https://librocat.com";

// librocat.com's public pages. The legal ones change together, on the
// date at their top (site.legalUpdated).
export default function sitemap(): MetadataRoute.Sitemap {
  if (selfHost) return [];
  const legal = new Date(site.legalUpdated);
  return [
    { url: BASE, changeFrequency: "weekly", priority: 1 },
    { url: `${BASE}/connect`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${BASE}/about`, changeFrequency: "monthly", priority: 0.7 },
    { url: `${BASE}/security`, lastModified: legal, changeFrequency: "monthly", priority: 0.5 },
    { url: `${BASE}/privacy`, lastModified: legal, changeFrequency: "monthly", priority: 0.3 },
    { url: `${BASE}/terms`, lastModified: legal, changeFrequency: "monthly", priority: 0.3 },
    { url: `${BASE}/disclaimer`, lastModified: legal, changeFrequency: "monthly", priority: 0.3 },
    // What agents read about librocat (public/llms.txt).
    { url: `${BASE}/llms.txt`, changeFrequency: "monthly", priority: 0.5 },
  ];
}
