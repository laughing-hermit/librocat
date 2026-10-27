/**
 * One signed-in person per plan, saved as a session the other tests start
 * from: `free`, `individual`, and `team`. Each signs in over HTTP and hands
 * the cookie to the browser (support.ts).
 */

import { test } from "@e2e-dev/web";
import { expect } from "e2e";
import { type Plan, person, seedConcepts, sessionCookies } from "./support.ts";

for (const plan of ["free", "individual", "team"] as const satisfies Plan[]) {
  test.setup(
    `a ${plan} library, signed in`,
    { sessions: [plan] },
    async ({ app, browser, screen, session }) => {
      await browser.setCookies(await sessionCookies(person(plan, plan)));
      await app.open("/dashboard");
      await expect(screen.getByRole("heading", "Library")).toBeVisible();
      await session.save(plan);
    },
  );
}

/** An Individual library with concepts in it, linked and tagged, for the bug bash. */
test.setup(
  "an individual library with concepts, signed in",
  { sessions: ["library"] },
  async ({ app, browser, screen, session }) => {
    const who = person("library", "individual");
    await seedConcepts(who, [
      {
        type: "Note",
        id: "auth/token-refresh",
        title: "Token refresh",
        description: "Refresh tokens rotate on every use.",
        tags: ["auth", "security"],
        body: "Refresh tokens rotate on every use. See [sessions](sessions.md) for how long they live.",
      },
      {
        type: "Note",
        id: "auth/sessions",
        title: "Sessions",
        description: "A session lasts 30 days and renews on use.",
        tags: ["auth"],
        body: "Sessions last 30 days. Signing out ends every session on that device.",
      },
      {
        type: "Runbook",
        id: "ops/deploy",
        title: "Deploying the site",
        description: "Push to main and wait for the build.",
        tags: ["ops"],
        body: "Push to main. Vercel builds and runs convex deploy.\n\n1. Merge the PR.\n2. Watch the deploy.\n3. Check the status page.",
      },
      {
        type: "Decision",
        id: "decisions/pnpm",
        title: "We use pnpm",
        description: "pnpm replaced bun on 2026-08-20.",
        tags: ["tooling"],
        body: "We moved from bun to pnpm for strict node_modules and Turborepo support.",
      },
      {
        type: "Note",
        id: "ops/old-deploy",
        title: "Deploying the site (old)",
        description: "The old deploy steps.",
        tags: ["ops"],
        status: "deprecated",
        body: "Run the deploy script by hand. Replaced by [Deploying the site](ops/deploy).",
      },
    ]);
    await browser.setCookies(await sessionCookies(who));
    await app.open("/dashboard");
    await expect(screen.getByRole("heading", "Library")).toBeVisible();
    await session.save("library");
  },
);
