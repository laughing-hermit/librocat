/**
 * The landing page's pictures of the product (src/app/page.tsx), taken from
 * the local app with the demo library: Acme engineering, seeded with
 * `dev:seedDemo` (DEVELOPERS.md). It signs in, opens each page (1152 or 720
 * pixels wide, with twice the pixels), and saves the part that shows the
 * point as WebP in src/assets/landing/. Run it again after a UI change, with
 * the app running:
 *
 *   cd apps/web && LANDING_EMAIL=… LANDING_PASSWORD=… node scripts/landing-shots.ts
 *
 * SITE sets the app's address (http://localhost:3000 by default). The
 * account is a demo admin's; its password stays in the environment.
 */

import { mkdirSync } from "node:fs";
import { chromium, type Page } from "playwright";
import sharp from "sharp";

const site = process.env.SITE ?? "http://localhost:3000";
const email = process.env.LANDING_EMAIL;
const password = process.env.LANDING_PASSWORD;
if (!email || !password) throw new Error("set LANDING_EMAIL and LANDING_PASSWORD");

const out = new URL("../src/assets/landing/", import.meta.url);
type Box = { x: number; y: number; width: number; height: number };

/**
 * The box of the card around the first element showing `text` (a row, or a
 * card), widened by `pad` pixels on every side. `outer` 2 takes the card
 * around that one: an open concept is a row inside its own card.
 */
async function cardAround(page: Page, text: string, pad = 12, outer = 1): Promise<Box> {
  // A tab's content can come in after the page's own requests settle.
  await page.getByText(text).first().waitFor();
  const box = await page.evaluate(
    ([needle, margin, level]) => {
      const walker = document.createTreeWalker(document.querySelector("main") ?? document.body, 4);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if (!n.textContent?.includes(needle as string)) continue;
        let found = 0;
        for (let el = n.parentElement; el; el = el.parentElement) {
          // A row has a border; a shadcn Card, a ring (a box shadow).
          const style = getComputedStyle(el);
          if (Number.parseFloat(style.borderTopWidth) > 0 || style.boxShadow !== "none") {
            if (++found < (level as number)) continue;
            const r = el.getBoundingClientRect();
            const m = margin as number;
            return {
              x: r.x - m,
              y: r.y + window.scrollY - m,
              width: r.width + 2 * m,
              height: r.height + 2 * m,
            };
          }
        }
      }
      return null;
    },
    [text, pad, outer] as const,
  );
  if (!box) throw new Error(`nothing on ${page.url()} shows "${text}"`);
  return box;
}

/**
 * From the top of the page down to the bottom of the card around `text`,
 * short of the next row (the rows are 8 pixels apart).
 */
async function topTo(page: Page, text: string): Promise<Box> {
  const card = await cardAround(page, text, 4);
  return { x: 0, y: 0, width: page.viewportSize()?.width ?? 1152, height: card.y + card.height };
}

// What each picture shows, beside the landing page's words (page.tsx). The
// library spans the page, so it's taken as wide as a laptop; the others sit
// in half a row, so they're taken narrower, for text big enough to read.
const SHOTS: { name: string; path: string; width?: number; part: (page: Page) => Promise<Box> }[] =
  [
    // Under the hero: the library, on Libro's "Needs you".
    {
      name: "library",
      path: "/dashboard/concepts?tab=review",
      width: 1152,
      part: (p) => topTo(p, "reads as"),
    },
    // Every agent, every teammate: page 2 is the teammates' agents, in use.
    {
      name: "agents",
      path: "/dashboard/connect?tab=agents&page=2",
      part: (p) => cardAround(p, "Every agent in your libraries"),
    },
    // Kept current by Libro: a concept Libro flagged, with its file.
    {
      name: "libro",
      path: "/dashboard/concepts/deploys/release-process",
      part: async (p) => {
        // The concept opens in place: measure it once it has opened all the way.
        await p.getByText("SOC 2 Type II report, 2026").first().waitFor();
        await p.waitForTimeout(800);
        return cardAround(p, "Merge to main; GitHub Actions builds", 6, 2);
      },
    },
    // Your documents, findable.
    {
      name: "files",
      path: "/dashboard/concepts?tab=files",
      part: (p) => topTo(p, "Incident response handbook"),
    },
    // Yours to keep: export and import.
    { name: "export", path: "/dashboard/library", part: (p) => cardAround(p, "Your data") },
  ];

mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1152, height: 820 },
  deviceScaleFactor: 2,
});

await page.goto(`${site}/sign-in`);
await page.getByLabel("Email").fill(email);
await page.getByLabel("Password").fill(password);
await page.getByRole("button", { name: "Sign in" }).click();
await page.waitForURL(/\/dashboard/);

for (const shot of SHOTS) {
  await page.setViewportSize({ width: shot.width ?? 720, height: 820 });
  await page.goto(`${site}${shot.path}`, { waitUntil: "networkidle" });
  // The dev server's badge and the scrollbar aren't the product.
  await page.addStyleTag({
    content: "nextjs-portal { display: none !important } ::-webkit-scrollbar { display: none }",
  });
  await page.evaluate(() => document.fonts.ready);
  const png = await page.screenshot({
    // The whole page, so a part below the window's bottom edge isn't cut.
    fullPage: true,
    clip: await shot.part(page),
    animations: "disabled",
    caret: "hide",
  });
  const file = new URL(`${shot.name}.webp`, out);
  const info = await sharp(png).webp({ quality: 85, effort: 6 }).toFile(file.pathname);
  console.log(`${shot.name}.webp ${info.width}×${info.height} ${Math.round(info.size / 1024)} KB`);
}

await browser.close();
