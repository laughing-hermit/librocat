/** What search engines and AI assistants are told about librocat Cloud's pages. */
import { afterEach, expect, test, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

test("librocat Cloud lets crawlers read its public pages, and lists them", async () => {
  const robots = (await import("../src/app/robots")).default();
  expect(robots.rules).toEqual({
    userAgent: "*",
    allow: "/",
    disallow: ["/api/", "/mcp", "/dashboard"],
  });
  expect(robots.sitemap).toBe("https://librocat.com/sitemap.xml");
  const urls = (await import("../src/app/sitemap")).default().map((e) => e.url);
  expect(urls).toEqual([
    "https://librocat.com",
    "https://librocat.com/connect",
    "https://librocat.com/about",
    "https://librocat.com/security",
    "https://librocat.com/privacy",
    "https://librocat.com/terms",
    "https://librocat.com/disclaimer",
  ]);
});

test("a self-hosted librocat asks crawlers to stay out", async () => {
  vi.stubEnv("LIBROCAT_SELF_HOST", "1");
  const robots = (await import("../src/app/robots")).default();
  expect(robots.rules).toEqual({ userAgent: "*", disallow: "/" });
  expect((await import("../src/app/sitemap")).default()).toEqual([]);
});
