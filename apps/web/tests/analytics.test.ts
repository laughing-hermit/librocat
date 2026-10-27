/** What Vercel Web Analytics counts (src/lib/analytics.ts). */
import { readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, test } from "vitest";
import { countedPath, countedUrl, DASHBOARD_PAGES, sizeBucket } from "../src/lib/analytics";

const site = (path: string) => `https://librocat.com${path}`;

/** Every page under src/app/dashboard, as its route ("[id]" segments kept). */
function dashboardRoutes(): string[] {
  const app = join(import.meta.dirname, "../src/app");
  const pages = readdirSync(join(app, "dashboard"), { recursive: true, encoding: "utf8" })
    .filter((f) => f.endsWith(`page.tsx`))
    .map((f) =>
      relative(app, join(app, "dashboard", f))
        .split(sep)
        .slice(0, -1),
    );
  return pages.map((segments) => `/${segments.filter((s) => !s.startsWith("(")).join("/")}`);
}

describe("every page is counted, by route, and never by what it shows", () => {
  test("a public page keeps its path, without query or fragment", () => {
    for (const path of ["/", "/about", "/privacy", "/sign-up", "/sign-in"]) {
      expect(countedUrl(site(path))).toBe(site(path));
    }
    expect(countedUrl(site("/sign-in?client_id=abc&state=xyz"))).toBe(site("/sign-in"));
    expect(countedUrl(site("/reset-password?token=secret#top"))).toBe(site("/reset-password"));
    expect(countedUrl(site("/consent?client_id=abc&scope=openid"))).toBe(site("/consent"));
  });

  test("the dashboard's pages are counted as they are, minus any query", () => {
    for (const path of DASHBOARD_PAGES) expect(countedPath(path)).toBe(path);
    // A saved link's title and a search ride in the query.
    expect(countedUrl(site("/dashboard/sources?saved=Quarterly%20report"))).toBe(
      site("/dashboard/sources"),
    );
    expect(countedUrl(site("/dashboard/concepts?q=stripe+keys"))).toBe(site("/dashboard/concepts"));
  });

  test("DASHBOARD_PAGES is every dashboard page whose path names nothing", () => {
    const fixed = dashboardRoutes().filter((r) => !r.includes("["));
    expect([...fixed].sort()).toEqual([...DASHBOARD_PAGES].sort());
  });

  test("a concept, a kept source, or an invite reports its route, not its id", () => {
    expect(countedPath("/dashboard/concepts/acme/billing/stripe-keys")).toBe(
      "/dashboard/concepts/[...id]",
    );
    expect(countedPath("/dashboard/sources/quarterly-report-pdf-1a2b")).toBe(
      "/dashboard/sources/[id]",
    );
    expect(countedPath("/invite/Zx81kQ")).toBe("/invite/[code]");
    expect(countedUrl(site("/invite/Zx81kQ?next=%2Fdashboard"))).toBe(site("/invite/[code]"));
    // Every dynamic dashboard route maps to a pattern.
    for (const route of dashboardRoutes().filter((r) => r.includes("["))) {
      const example = route.replace(/\[\.\.\.\w+\]|\[\w+\]/, "some/secret-id");
      expect(countedPath(example)).not.toContain("secret");
    }
  });

  test("an address the dashboard doesn't have reports no path", () => {
    expect(countedPath("/dashboard/concept/acme/stripe-keys")).toBe("/dashboard/[unknown]");
    expect(countedPath("/dashboard/library/acme-docs")).toBe("/dashboard/[unknown]");
  });

  test("counting is the same twice, and a trailing slash doesn't matter", () => {
    for (const path of ["/dashboard/concepts/a/b", "/invite/x", "/dashboard/nope", "/about"]) {
      const once = countedUrl(site(path));
      expect(countedUrl(once)).toBe(once);
    }
    expect(countedPath("/dashboard/team/")).toBe("/dashboard/team");
    expect(countedPath("/")).toBe("/");
  });

  test("a public path that merely starts like a private one keeps its path", () => {
    expect(countedPath("/dashboards-explained")).toBe("/dashboards-explained");
    expect(countedPath("/invites")).toBe("/invites");
  });
});

test("a file's size is reported as a range", () => {
  expect(sizeBucket(0)).toBe("under 1 MB");
  expect(sizeBucket(999_999)).toBe("under 1 MB");
  expect(sizeBucket(1_000_000)).toBe("1-10 MB");
  expect(sizeBucket(99_999_999)).toBe("10-100 MB");
  expect(sizeBucket(5_000_000_000)).toBe("over 100 MB");
});
