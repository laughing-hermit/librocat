/**
 * Every page as screenshots, top to bottom, for a person's review of the UI:
 * `pnpm exec e2e run --tag screens` (desktop and phone), then the
 * .e2e/artifacts folders. Not part of the gating run.
 */

import { type Browser, test } from "@e2e-dev/web";
import { expect } from "e2e";
import { seedConcepts, signIn } from "./support.ts";

type App = { open(path: string): Promise<unknown>; screenshot(label?: string): Promise<string> };

/** Screenshots down the page, one viewport at a time (at most eight). */
async function shoot(app: App, browser: Browser, label: string) {
  const [height, view] = await browser.evaluate(() => [
    document.documentElement.scrollHeight,
    window.innerHeight,
  ]);
  for (let i = 0, y = 0; y < height && i < 8; i++, y += view) {
    await browser.evaluate((top: number) => {
      window.scrollTo(0, top);
      return null;
    }, y);
    await app.screenshot(`${label}-${i + 1}`);
  }
}

const publicPages = [
  ["landing", "/"],
  ["connect", "/connect"],
  ["about", "/about"],
  ["terms", "/terms"],
  ["privacy", "/privacy"],
  ["security", "/security"],
  ["disclaimer", "/disclaimer"],
  ["sign-in", "/sign-in"],
  ["sign-up", "/sign-up"],
  ["reset-password", "/reset-password"],
] as const;

test("the public pages", { tags: ["screens"] }, async ({ app, browser, screen }) => {
  for (const [label, path] of publicPages) {
    await app.open(path);
    await expect(screen.getByRole("heading").first()).toBeVisible();
    await shoot(app, browser, label);
  }
});

const dashboardPages = [
  ["home", "/dashboard"],
  ["concepts", "/dashboard/concepts"],
  ["concept", "/dashboard/concepts/ops/deploy"],
  ["connect", "/dashboard/connect"],
  ["team", "/dashboard/team"],
  ["billing", "/dashboard/billing"],
  ["library", "/dashboard/library"],
  ["account", "/dashboard/account"],
  ["new-library", "/dashboard/library/new"],
] as const;

test("the dashboard, with a library in it", { tags: ["screens"] }, async ({
  app,
  browser,
  screen,
}) => {
  const who = await signIn(browser, "screens", "team");
  await seedConcepts(who, [
    {
      type: "Note",
      id: "auth/token-refresh",
      title: "Token refresh",
      description: "Refresh tokens rotate on every use.",
      tags: ["auth"],
      body: "Refresh tokens rotate on every use. See [sessions](sessions.md).",
    },
    {
      type: "Note",
      id: "auth/sessions",
      title: "Sessions",
      description: "A session lasts 30 days.",
      tags: ["auth"],
      body: "Sessions last 30 days and renew on use.",
    },
    {
      type: "Runbook",
      id: "ops/deploy",
      title: "Deploying the site",
      description: "Push to main and wait for the build.",
      tags: ["ops"],
      // Every kind of Markdown a concept page shows.
      body: [
        "Push to `main`. Vercel builds the site and runs `convex deploy`.",
        "# Steps",
        "1. Merge the PR.\n2. Watch the deploy.\n3. Check [the status page](https://status.librocat.com).",
        "# Roll back",
        "```bash\nvercel rollback\n```",
        "| Check | Expect |\n| --- | --- |\n| The site | 200 |\n| `/mcp` | 401 |",
        "> If sign-in breaks, see [token refresh](/auth/token-refresh.md).",
      ].join("\n\n"),
    },
  ]);
  for (const [label, path] of dashboardPages) {
    await app.open(path);
    await expect(screen.getByRole("heading").first()).toBeVisible();
    await shoot(app, browser, label);
  }
});
