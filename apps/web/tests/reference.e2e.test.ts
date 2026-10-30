/**
 * The ready-reference file and Libro's weekly report, end to end, against a
 * running stack and `next dev` on :3000 (the unsubscribe route). Filing a
 * question calls no model: it is grouped by its words.
 *   LIBROCAT_E2E_CONVEX_URL=http://127.0.0.1:3210 pnpm test
 */

import { spawnSync } from "node:child_process";
import { ConvexHttpClient } from "convex/browser";
import { expect, test } from "vitest";
import { api } from "../convex/_generated/api";

const url = process.env.LIBROCAT_E2E_CONVEX_URL;
const run = url ? test : test.skip;
const cliCwd = process.env.LIBROCAT_E2E_CLI_CWD || new URL("..", import.meta.url).pathname;
const site = process.env.LIBROCAT_E2E_SITE_URL ?? "http://localhost:3000";

// biome-ignore lint/suspicious/noExplicitAny: fixture JSON from the CLI
function runDev(fn: string, args: Record<string, unknown>): any {
  const r = spawnSync("node_modules/.bin/convex", ["run", fn, JSON.stringify(args)], {
    cwd: cliCwd,
    env: { ...process.env, CONVEX_AGENT_MODE: "anonymous" },
    encoding: "utf8",
  });
  expect(r.status).toBe(0);
  return r.stdout.trim() ? JSON.parse(r.stdout) : null;
}

run(
  "questions are filed, grouped by their words, answered, and reported; the report email unsubscribes in one click",
  async () => {
    const client = new ConvexHttpClient(url as string);
    const { token, workspaceId } = runDev("dev:issueTestAccessToken", {
      email: `desk-${Date.now()}@example.com`,
    });
    client.setAuth(token);
    const desk = async () => runDev("dev:desk", { workspaceId });

    // A question that finds nothing is a gap in the collection; the same
    // content words, worded another way, are the same question.
    const search = (query: string) => client.mutation(api.mcp.searchWords, { query });
    expect(await search("stripe key rotation")).toEqual([]);
    expect(await search("Rotation of the Stripe keys?")).toEqual([]);
    expect(await desk()).toMatchObject({ asked: 2, found_nothing: 2, distinct: 1 });
    expect((await desk()).unanswered[0]).toMatchObject({
      text: "Rotation of the Stripe keys?",
      count: 2,
    });

    // Written down, the question finds it; the concept opened next is its answer.
    await client.mutation(api.mcp.ingest, {
      type: "Runbook",
      id: "runbooks/stripe-rotation",
      title: "Stripe key rotation",
      description: "How to rotate the Stripe secret key.",
      tags: ["billing"],
      body: "Rotate the key in Stripe, then update STRIPE_SECRET_KEY in Doppler.",
    });
    const found = await search("stripe key rotation");
    expect(found[0]?.id).toBe("runbooks/stripe-rotation");
    await client.mutation(api.mcp.get, { id: "runbooks/stripe-rotation" });
    // Asked again: the earlier answer comes first, and says why.
    const again = await search("Stripe key rotation?");
    expect(again[0]).toMatchObject({ id: "runbooks/stripe-rotation", ready_reference: true });
    // Through the action an older Next.js calls during a deploy, the same answer.
    const viaAction = await client.action(api.mcp.search, { query: "rotation of the stripe keys" });
    expect(viaAction[0]).toMatchObject({ id: "runbooks/stripe-rotation", ready_reference: true });
    expect((await desk()).unanswered).toEqual([]);
    expect((await desk()).frequent[0]).toMatchObject({
      count: 5,
      answer: "runbooks/stripe-rotation",
    });

    // Other words, another question, and nothing has them: a gap of its own.
    expect(await search("offsite dinner venue")).toEqual([]);
    expect(await desk()).toMatchObject({ asked: 6, distinct: 2 });
    expect((await desk()).unanswered.map((q: { text: string }) => q.text)).toEqual([
      "offsite dinner venue",
    ]);

    // A question carrying a credential is never kept.
    await search(`find ${"sk_live_"}${"x".repeat(24)}`);
    expect((await desk()).asked).toBe(6);

    // Libro's report: Monday's email (logged in dev).
    const report = runDev("report:reportData", { workspaceId }).report;
    expect(await client.query(api.report.myReportEmail, {})).toBe(true);
    expect(report).toMatchObject({
      // A Free library: the month since its last report.
      period: "month",
      added: { count: 1 },
      questions: { asked: 6, unanswered: [{ text: "offsite dinner venue", count: 1 }] },
    });
    const sent = runDev("report:sendReport", { workspaceId });
    expect(sent).toMatchObject({ sent: 1 });
    expect(sent.subject).toBe("Libro's report: 1 new concept, 1 unanswered question");

    // One-click unsubscribe: a forged token does nothing; the signed link, through the site, works.
    const data = runDev("report:reportData", { workspaceId });
    const link = new URL(
      runDev("report:unsubscribeLink", { memberId: data.recipients[0].memberId }),
    );
    const member = link.searchParams.get("m") as string;
    expect((await client.mutation(api.report.unsubscribe, { member, token: "forged" })).ok).toBe(
      false,
    );
    expect(await client.query(api.report.myReportEmail, {})).toBe(true);
    // Opening the link only asks: a mail scanner opening it unsubscribes no one.
    const asked = await fetch(`${site}/api/unsubscribe${link.search}`);
    expect(asked.status).toBe(200);
    expect(await asked.text()).toContain("Stop the report");
    expect(await client.query(api.report.myReportEmail, {})).toBe(true);
    // Its button does.
    const res = await fetch(`${site}/api/unsubscribe${link.search}`, {
      method: "POST",
      body: new URLSearchParams({ confirm: "1" }),
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("will not get Libro's report");
    expect(await client.query(api.report.myReportEmail, {})).toBe(false);
    expect(runDev("report:sendReport", { workspaceId })).toMatchObject({ sent: 0 });
    // Back on from Account's switch.
    await client.mutation(api.report.setReportEmail, { enabled: true });
    expect(await client.query(api.report.myReportEmail, {})).toBe(true);
  },
  90_000,
);
