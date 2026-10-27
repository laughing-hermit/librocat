"use client";

import { inject, pageview } from "@vercel/analytics";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { countedPath, countedUrl } from "@/lib/analytics";

/**
 * Vercel Web Analytics on librocat Cloud (app/layout.tsx), with no cookie: a
 * page view for every page, sent by route, and the events lib/analytics.ts
 * names. Speed Insights measures how fast each route loads and responds for
 * real visitors, on the free tier that comes with every Vercel plan (not
 * Plus): past 10,000 events in 30 days it pauses, and it never bills. All of
 * it goes through countedUrl first, so no id, search, or token is sent.
 */
export function SiteAnalytics() {
  const pathname = usePathname();
  const counted = useRef<string | null>(null);
  useEffect(() => {
    inject(
      {
        framework: "next",
        basePath: process.env.NEXT_PUBLIC_VERCEL_OBSERVABILITY_BASEPATH,
        // Page views are sent below, by route, not by the script from the address bar.
        disableAutoTrack: true,
        beforeSend: (event) => ({ ...event, url: countedUrl(event.url) }),
      },
      process.env.NEXT_PUBLIC_VERCEL_OBSERVABILITY_CLIENT_CONFIG,
    );
  }, []);
  // Every navigation counts, even between two concepts that share a route,
  // but a page only once: React runs this twice on mount in development.
  useEffect(() => {
    if (counted.current === pathname) return;
    counted.current = pathname;
    const route = countedPath(pathname);
    pageview({ route, path: route });
  }, [pathname]);
  // Vercel's own paths: the first-party base path that serves Web Analytics
  // (NEXT_PUBLIC_VERCEL_OBSERVABILITY_BASEPATH) answers 404 for Speed
  // Insights, so its script never loaded and no vitals were sent.
  return (
    <SpeedInsights
      scriptSrc="/_vercel/speed-insights/script.js"
      endpoint="/_vercel/speed-insights/vitals"
      beforeSend={(event) => ({ ...event, url: countedUrl(event.url) })}
    />
  );
}
