/**
 * Local development helpers (internal: never callable from clients).
 *
 *   pnpm exec convex run dev:seed '{"plan":"individual"}'
 *   pnpm exec convex run dev:issueTestAccessToken '{"plan":"individual"}'
 *
 * `seed` creates a verified user and a workspace on the given plan;
 * `issueTestAccessToken` does the same and signs an MCP access token for that
 * user with the deployment's own key — the token an agent would get from the
 * OAuth flow, minus the browser. It only runs where LIBROCAT_E2E=1 is set on
 * the deployment (dev and local, never prod). See docs/cloud.md §Local
 * development.
 */

import { THESAURUS_ID } from "@librocat/core/library";
import { v } from "convex/values";
import { components, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  internalAction,
  internalMutation,
  internalQuery,
  type MutationCtx,
} from "./_generated/server";
import { codeIdentifiers, removeIdentity } from "./account";
import { pickOf } from "./agents";
import { createAuth, mcpResource } from "./auth";
import {
  DEMO_AGENTS,
  DEMO_CONCEPTS,
  DEMO_LIBRARY,
  DEMO_PEOPLE,
  DEMO_PROPOSALS,
  DEMO_QUESTIONS,
  DEMO_SOURCES,
} from "./demo";
import { demoPdf } from "./demoPdf";
import { dateReason, humanDate, KIND_DAYS } from "./libro";
import { drainMonthly as drainMonthlyFor } from "./limits";
import { createLibraryFor, newSlug, setCurrentLibrary, workspaceForUserId } from "./membership";
import { deleteSome, getByCid, ingest, recentPage as recentPageOf, search } from "./model";
import { logQuestion, questionsSince, summarize } from "./reference";
import { addSource } from "./sources";
import { ensureWorkspace } from "./workspaces";

const plan = v.union(v.literal("free"), v.literal("individual"), v.literal("team"));

/** Put an existing workspace on a plan (the Stripe webhook does this in prod). */
export const setPlan = internalMutation({
  args: { workspaceId: v.id("workspaces"), plan },
  handler: async (ctx, { workspaceId, plan }) => {
    await ctx.db.patch(workspaceId, { plan });
  },
});

/** Change a member's role (the Team page does this by hand: team.setRole). */
export const setMemberRole = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    userId: v.string(),
    role: v.union(v.literal("admin"), v.literal("member"), v.literal("reader")),
  },
  handler: async (ctx, { workspaceId, userId, role }) => {
    const rows = await ctx.db
      .query("members")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .collect();
    const row = rows.find((m) => m.userId === userId);
    if (row) await ctx.db.patch(row._id, { role });
  },
});

/** Put `userId` in `workspaceId` as an Editor, with no invite (team.e2e). LIBROCAT_E2E=1 only. */
export const addMember = internalMutation({
  args: { workspaceId: v.id("workspaces"), userId: v.string() },
  returns: v.null(),
  handler: async (ctx, { workspaceId, userId }) => {
    if (process.env.LIBROCAT_E2E !== "1") {
      throw new Error("addMember is off: set LIBROCAT_E2E=1 on a dev deployment");
    }
    await ctx.db.insert("members", { workspaceId, userId, role: "member" });
    return null;
  },
});

/**
 * Set how much a user's default library keeps (SOURCE_BYTES in model.ts), and
 * of it how much is text (TEXT_BYTES), so a test meets the cap.
 */
export const setSourceBytes = internalMutation({
  args: { userId: v.string(), bytes: v.number(), textBytes: v.optional(v.number()) },
  handler: async (ctx, { userId, bytes, textBytes }) => {
    const ws = await workspaceForUserId(ctx, userId);
    if (!ws) throw new Error(`no library for ${userId}`);
    await ctx.db.patch(ws._id, {
      sourceBytes: bytes,
      ...(textBytes === undefined ? {} : { textBytes }),
    });
  },
});

/** Run source watch now on a user's default library, every cited page (convex/fetching.ts). */
export const watchSources = internalMutation({
  args: { userId: v.string() },
  handler: async (ctx, { userId }) => {
    const ws = await workspaceForUserId(ctx, userId);
    if (!ws) throw new Error(`no library for ${userId}`);
    await ctx.scheduler.runAfter(0, internal.fetching.watch, { workspaceId: ws._id, force: true });
  },
});

/** Use up one of a library's monthly ceilings (limits.ts), so a test meets it. */
export const drainMonthly = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    which: v.union(v.literal("calls"), v.literal("writes"), v.literal("transfer_bytes")),
  },
  handler: async (ctx, { workspaceId, which }) => {
    const ws = await ctx.db.get(workspaceId);
    if (ws) await drainMonthlyFor(ctx, ws, which);
  },
});

/** Clear Libro's run cooldown (convex/libro.ts RUN_COOLDOWN_MS) so a test can call runNow twice back to back. */
export const clearLibroCooldown = internalMutation({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, { workspaceId }) => {
    await ctx.db.patch(workspaceId, { libroRunAt: undefined });
  },
});

/**
 * Set index-credit usage directly, so a test can put a workspace at (or past)
 * INDEX_CREDITS in model.ts and the next indexation is overage. `period`
 * defaults to the current one.
 */
export const setIndexUsage = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    used: v.number(),
    overage: v.optional(v.number()),
    period: v.optional(v.string()),
  },
  handler: async (ctx, { workspaceId, used, overage, period }) => {
    await ctx.db.patch(workspaceId, {
      indexPeriod: period ?? new Date().toISOString().slice(0, 7),
      indexUsed: used,
      indexOverage: overage ?? 0,
    });
  },
});

/** Where a concept's cataloging stands (indexation.ts), for the e2e tests. */
export const catalogState = internalQuery({
  args: { workspaceId: v.id("workspaces"), cid: v.string() },
  handler: async (ctx, { workspaceId, cid }) => {
    const row = await getByCid(ctx, workspaceId, cid);
    return row
      ? {
          waiting: row.catalogWaiting === true,
          inFlight: row.indexingAt !== undefined,
          cataloged: row.indexedAt !== undefined,
        }
      : null;
  },
});

/** A workspace's pay-as-you-go cap and the last cap email it sent (model.ts spendCredits), for the e2e tests. */
export const capState = internalQuery({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, { workspaceId }) => {
    const ws = await ctx.db.get(workspaceId);
    return { capCents: ws?.payAsYouGoCapCents ?? null, notice: ws?.capNotice ?? null };
  },
});

type AuthUser = { _id: string; email: string; name?: string } | null;

const findUserByEmail = (ctx: Pick<MutationCtx, "runQuery">, email: string) =>
  ctx.runQuery(components.betterAuth.adapter.findOne, {
    model: "user",
    where: [{ field: "email", value: email }],
  }) as Promise<AuthUser>;

/**
 * Remove a user who never got a workspace (an abandoned or unverified
 * sign-up). One that owns a workspace goes through account:teardownLibraries.
 */
export const deleteUser = internalMutation({
  args: { email: v.string() },
  handler: async (ctx, { email }) => {
    const user = await findUserByEmail(ctx, email);
    if (!user) return 0;
    const ws = await ctx.db
      .query("workspaces")
      .withIndex("by_owner", (q) => q.eq("ownerId", user._id))
      .first();
    if (ws) throw new Error(`${email} owns workspace ${ws._id}: use account:teardownLibraries`);
    const memberships = await ctx.db
      .query("members")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();
    for (const m of memberships) await ctx.db.delete(m._id);
    await removeIdentity(ctx, user._id);
    return 1;
  },
});

/**
 * Two emailed sign-in codes for `email`, one expired an hour ago and one
 * good for an hour: the daily cleanup (authCleanup.ts) deletes only the
 * first. Returns how many of `email`'s codes exist.
 */
export const addCodes = internalMutation({
  args: { email: v.string() },
  handler: async (ctx, { email }) => {
    if (process.env.LIBROCAT_E2E !== "1") throw new Error("only on an e2e deployment");
    const now = Date.now();
    for (const [purpose, expiresAt] of [
      ["sign-in", now - 3_600_000],
      ["forget-password", now + 3_600_000],
    ] as const) {
      await ctx.runMutation(components.betterAuth.adapter.create, {
        input: {
          model: "verification",
          data: {
            identifier: `${purpose}-otp-${email}`,
            value: "000000:0",
            expiresAt,
            createdAt: now,
            updatedAt: now,
          },
        },
      });
    }
    return null;
  },
});

/** How many emailed codes `email` has (addCodes). */
export const codesOf = internalQuery({
  args: { email: v.string() },
  handler: async (ctx, { email }) => {
    let n = 0;
    for (const identifier of codeIdentifiers(email).exact) {
      const found = (await ctx.runQuery(components.betterAuth.adapter.findMany, {
        model: "verification",
        where: [{ field: "identifier", value: identifier }],
        paginationOpts: { numItems: 10, cursor: null },
      })) as { page: unknown[] };
      n += found.page.length;
    }
    return n;
  },
});

/**
 * What is left of a person and their workspace, as row counts per table: the
 * account-deletion e2e checks that each reads zero after the teardown.
 * Better Auth's tables first (convex/account.ts removeIdentity), then
 * librocat's own (model.ts deleteSome, account.ts teardownLibraries).
 */
export const identityRows = internalQuery({
  args: { userId: v.string(), email: v.string(), workspaceId: v.id("workspaces") },
  handler: async (ctx, { userId, email, workspaceId }) => {
    const auth = async (
      model: "user" | "session" | "account" | "verification" | `oauth${string}`,
      where: { field: string; value: string; operator?: "starts_with" }[],
    ): Promise<number> => {
      const found = (await ctx.runQuery(components.betterAuth.adapter.findMany, {
        model: model as "user",
        where,
        paginationOpts: { numItems: 1000, cursor: null },
      })) as { page: unknown[] };
      return found.page.length;
    };
    const byUser = [{ field: "userId", value: userId }];
    const codes = codeIdentifiers(email);
    let verification = await auth("verification", [
      { field: "identifier", value: codes.prefix, operator: "starts_with" },
    ]);
    for (const identifier of codes.exact) {
      verification += await auth("verification", [{ field: "identifier", value: identifier }]);
    }
    const count = async (rows: Promise<unknown[]>) => (await rows).length;
    return {
      user: await auth("user", [{ field: "_id", value: userId }]),
      session: await auth("session", byUser),
      account: await auth("account", byUser),
      oauthAccessToken: await auth("oauthAccessToken", byUser),
      oauthRefreshToken: await auth("oauthRefreshToken", byUser),
      oauthConsent: await auth("oauthConsent", byUser),
      oauthClient: await auth("oauthClient", byUser),
      verification,
      memberships: await count(
        ctx.db
          .query("members")
          .withIndex("by_user", (q) => q.eq("userId", userId))
          .take(1000),
      ),
      ownedLibraries: await count(
        ctx.db
          .query("workspaces")
          .withIndex("by_owner", (q) => q.eq("ownerId", userId))
          .take(1000),
      ),
      currentLibrary: await count(
        ctx.db
          .query("currentLibrary")
          .withIndex("by_user", (q) => q.eq("userId", userId))
          .take(1000),
      ),
      fileReads: await count(
        ctx.db
          .query("fileReads")
          .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
          .take(1000),
      ),
      agentLibraries: await count(
        ctx.db
          .query("agentLibraries")
          .withIndex("by_user_client", (q) => q.eq("userId", userId))
          .take(1000),
      ),
      workspace: (await ctx.db.get(workspaceId)) ? 1 : 0,
      members: await count(
        ctx.db
          .query("members")
          .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
          .take(1000),
      ),
      invites: await count(
        ctx.db
          .query("invites")
          .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
          .take(1000),
      ),
      concepts: await count(
        ctx.db
          .query("concepts")
          .withIndex("by_workspace_cid", (q) => q.eq("workspaceId", workspaceId))
          .take(1000),
      ),
      bodies: await count(
        ctx.db
          .query("bodies")
          .withIndex("by_workspace_cid", (q) => q.eq("workspaceId", workspaceId))
          .take(1000),
      ),
      links: await count(
        ctx.db
          .query("links")
          .withIndex("by_ws_src", (q) => q.eq("workspaceId", workspaceId))
          .take(1000),
      ),
      revisions: await count(
        ctx.db
          .query("revisions")
          .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
          .take(1000),
      ),
      proposals: await count(
        ctx.db
          .query("proposals")
          .withIndex("by_workspace_status", (q) => q.eq("workspaceId", workspaceId))
          .take(1000),
      ),
      questions: await count(
        ctx.db
          .query("questions")
          .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
          .take(1000),
      ),
      questionWeeks: await count(
        ctx.db
          .query("questionWeeks")
          .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
          .take(1000),
      ),
      tombstones: await count(
        ctx.db
          .query("tombstones")
          .withIndex("by_workspace_cid", (q) => q.eq("workspaceId", workspaceId))
          .take(1000),
      ),
      sources: await count(
        ctx.db
          .query("sources")
          .withIndex("by_workspace_sid", (q) => q.eq("workspaceId", workspaceId))
          .take(1000),
      ),
      sourceParts: await count(
        ctx.db
          .query("sourceParts")
          .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
          .take(1000),
      ),
    };
  },
});

/** True once a deleted library's rows are all gone (account.ts teardownLibraries). */
export const libraryGone = internalQuery({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, { workspaceId }) => {
    if (await ctx.db.get(workspaceId)) return false;
    for (const rows of [
      await ctx.db
        .query("concepts")
        .withIndex("by_workspace_cid", (q) => q.eq("workspaceId", workspaceId))
        .first(),
      await ctx.db
        .query("members")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
        .first(),
      await ctx.db
        .query("revisions")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
        .first(),
      await ctx.db
        .query("currentLibrary")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
        .first(),
      await ctx.db
        .query("facets")
        .withIndex("by_cid", (q) => q.eq("workspaceId", workspaceId))
        .first(),
      await ctx.db
        .query("facetCounts")
        .withIndex("by_kind_value", (q) => q.eq("workspaceId", workspaceId))
        .first(),
    ]) {
      if (rows) return false;
    }
    return true;
  },
});

/** Another library for a user, as the dashboard's New library makes it. Returns its slug. */
export const addLibrary = internalMutation({
  args: { userId: v.string(), name: v.string() },
  handler: async (ctx, { userId, name }) => (await createLibraryFor(ctx, userId, name)).slug,
});

/** A verified user (created directly in the auth component) with a workspace on `plan`. */
export const seed = internalMutation({
  args: { plan: v.optional(plan), email: v.optional(v.string()) },
  handler: async (ctx, args): Promise<{ userId: string; workspaceId: Id<"workspaces"> }> => {
    const email = args.email ?? "dev@localhost";
    let user = await findUserByEmail(ctx, email);
    if (!user) {
      const now = Date.now();
      user = (await ctx.runMutation(components.betterAuth.adapter.create, {
        input: {
          model: "user",
          data: { name: email, email, emailVerified: true, createdAt: now, updatedAt: now },
        },
      })) as AuthUser;
    }
    if (!user) throw new Error("could not create the seed user");
    const ws = await ensureWorkspace(ctx, user._id);
    if (args.plan) await ctx.db.patch(ws._id, { plan: args.plan });
    return { userId: user._id, workspaceId: ws._id };
  },
});

/** A verified user by email, created in the auth component if need be (its trigger gives them a library). */
async function userFor(ctx: MutationCtx, email: string, name?: string): Promise<string> {
  const found = await findUserByEmail(ctx, email);
  if (found) {
    if (name && found.name !== name) {
      await ctx.runMutation(components.betterAuth.adapter.updateOne, {
        input: { model: "user", where: [{ field: "_id", value: found._id }], update: { name } },
      });
    }
    return found._id;
  }
  const now = Date.now();
  const user = (await ctx.runMutation(components.betterAuth.adapter.create, {
    input: {
      model: "user",
      data: { name: name ?? email, email, emailVerified: true, createdAt: now, updatedAt: now },
    },
  })) as AuthUser;
  if (!user) throw new Error(`could not create ${email}`);
  return user._id;
}

/** Register an OAuth client and grant it to `userId`, as approving an agent on /consent does. */
async function grantClient(ctx: MutationCtx, userId: string, clientId: string, name: string) {
  const now = Date.now();
  const client = await ctx.runQuery(components.betterAuth.adapter.findOne, {
    model: "oauthClient",
    where: [{ field: "clientId", value: clientId }],
  });
  if (!client) {
    await ctx.runMutation(components.betterAuth.adapter.create, {
      input: {
        model: "oauthClient",
        data: {
          clientId,
          name,
          redirectUris: ["http://127.0.0.1/callback"],
          public: true,
          createdAt: now,
          updatedAt: now,
        },
      },
    });
  }
  const consent = await ctx.runQuery(components.betterAuth.adapter.findOne, {
    model: "oauthConsent",
    where: [
      { field: "clientId", value: clientId },
      { field: "userId", value: userId },
    ],
  });
  if (!consent) {
    await ctx.runMutation(components.betterAuth.adapter.create, {
      input: {
        model: "oauthConsent",
        data: {
          clientId,
          userId,
          scopes: ["openid", "offline_access"],
          createdAt: now,
          updatedAt: now,
        },
      },
    });
  }
}

/**
 * The demo library: "Acme engineering" on Team, with three teammates, 25
 * concepts on five shelves written by their agents, three sources, and one
 * review-shelf proposal of each kind (convex/demo.ts). Re-running replaces
 * its contents. `email`: your own account joins it as an admin and the
 * dashboard opens on it. Sign in as a teammate with the emailed code
 * (AUTH_DEV_LOG_CODES=1 writes it to the Convex log). LIBROCAT_E2E=1 only.
 * The report and the call keep a file, as an upload does, so they download.
 *
 *   pnpm exec convex run dev:seedDemo '{"email":"you@example.com"}'
 */
export const seedDemo = internalAction({
  args: { email: v.optional(v.string()) },
  handler: async (ctx, { email }): Promise<Record<string, unknown>> => {
    const made = await ctx.runMutation(internal.dev.seedDemoData, { email });
    for (const s of DEMO_SOURCES) {
      if (!s.file) continue;
      const bytes = s.file.mime === "application/pdf" ? demoPdf(s.title, s.text) : s.text;
      const blob = new Blob([bytes], { type: s.file.mime });
      const storageId = await ctx.storage.store(blob);
      await ctx.runMutation(internal.dev.keepDemoFile, {
        workspaceId: made.workspaceId,
        sid: s.id,
        storageId,
        mime: s.file.mime,
        filename: s.file.name,
        fileBytes: blob.size,
      });
    }
    return made;
  },
});

/** A demo source's kept file (seedDemo). */
export const keepDemoFile = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    sid: v.string(),
    storageId: v.id("_storage"),
    mime: v.string(),
    filename: v.string(),
    fileBytes: v.number(),
  },
  handler: async (ctx, { workspaceId, sid, ...file }) => {
    const source = await ctx.db
      .query("sources")
      .withIndex("by_workspace_sid", (q) => q.eq("workspaceId", workspaceId).eq("sid", sid))
      .unique();
    if (source) await ctx.db.patch(source._id, file);
  },
});

export const seedDemoData = internalMutation({
  args: { email: v.optional(v.string()) },
  handler: async (ctx, { email }) => {
    if (process.env.LIBROCAT_E2E !== "1") {
      throw new Error("seedDemo is off: set LIBROCAT_E2E=1 on a dev deployment");
    }
    const DAY = 86_400_000;
    const now = Date.now();
    const people = new Map<string, string>();
    for (const p of DEMO_PEOPLE) people.set(p.email, await userFor(ctx, p.email, p.name));
    const owner = people.get(DEMO_PEOPLE[0].email) as string;

    // The library: the owner's, by name; else their empty first library, renamed; else a new one.
    const owned = await ctx.db
      .query("workspaces")
      .withIndex("by_owner", (q) => q.eq("ownerId", owner))
      .collect();
    let ws = owned.find((w) => w.name === DEMO_LIBRARY) ?? null;
    if (!ws) {
      const first = await ensureWorkspace(ctx, owner);
      ws =
        first.conceptCount === 0 && first.name !== DEMO_LIBRARY
          ? first
          : await createLibraryFor(ctx, owner, DEMO_LIBRARY);
    }
    const wsId = ws._id;
    // Replace what was there: its contents, then its people.
    for (let i = 0; i < 50 && !(await deleteSome(ctx, wsId)); i++);
    for (const m of await ctx.db
      .query("members")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", wsId))
      .collect()) {
      await ctx.db.delete(m._id);
    }
    const you = email ? await userFor(ctx, email.trim().toLowerCase()) : null;
    const members: [string, "admin" | "member" | "reader"][] = DEMO_PEOPLE.map((p) => [
      people.get(p.email) as string,
      p.role,
    ]);
    if (you && !members.some(([id]) => id === you)) members.push([you, "admin"]);
    for (const [userId, role] of members) {
      await ctx.db.insert("members", { workspaceId: wsId, userId, role });
      await setCurrentLibrary(ctx, userId, wsId);
    }
    await ctx.db.patch(wsId, {
      name: DEMO_LIBRARY,
      // A renamed first library ("My library") takes an address that matches its name.
      ...(ws.slug?.startsWith("acme-") ? {} : { slug: await newSlug(ctx, DEMO_LIBRARY) }),
      plan: "team",
      seats: Math.max(3, members.length),
      subscriptionStatus: "active",
    });

    // Each teammate's agents, connected, and working in this library: some
    // used today, some days ago, some not yet (Connect's list). Gabriella
    // also has ChatGPT.
    const everyone = [...people.values(), ...(you ? [you] : [])];
    const grants = DEMO_AGENTS.flatMap((agent) => everyone.map((userId) => [userId, agent]));
    grants.push([people.get("dev@acme.test") as string, "ChatGPT"]);
    for (const [i, [userId, agent]] of grants.entries()) {
      const clientId = `demo-${agent.toLowerCase().replace(/\s+/g, "-")}`;
      await grantClient(ctx, userId, clientId, agent);
      const pick = await pickOf(ctx, userId, clientId);
      if (pick) await ctx.db.patch(pick._id, { workspaceId: wsId });
      else await ctx.db.insert("agentLibraries", { userId, clientId, workspaceId: wsId });
      const now = Date.now();
      const row = {
        workspaceId: wsId,
        name: agent,
        connectedAt: now - (i + 3) * 86_400_000,
        usedAt: i % 4 === 3 ? undefined : now - (i % 4) * 30 * 3_600_000,
      };
      const had = await ctx.db
        .query("agents")
        .withIndex("by_user_client", (q) => q.eq("userId", userId).eq("clientId", clientId))
        .first();
      if (had) await ctx.db.replace(had._id, { userId, clientId, ...row });
      else await ctx.db.insert("agents", { userId, clientId, ...row });
    }

    const writer = (person: string, agent: string) => ({
      by: "agent",
      userId: people.get(person) as string,
      client: agent,
    });
    const fresh = async () => {
      const row = await ctx.db.get(wsId);
      if (!row) throw new Error("the demo library is gone");
      return row;
    };
    for (const s of DEMO_SOURCES) {
      await addSource(
        ctx,
        await fresh(),
        { id: s.id, title: s.title, location: s.location, kind: s.kind, text: s.text },
        writer(s.by, s.agent),
        { review: false },
      );
    }
    const staleOn = new Date(now - 21 * DAY).toISOString().slice(0, 10);
    for (const c of DEMO_CONCEPTS) {
      await ingest(
        ctx,
        await fresh(),
        {
          id: c.id,
          type: c.type,
          title: c.title,
          description: c.description,
          tags: c.tags,
          body: c.body,
          ...(c.sources ? { sources: c.sources } : {}),
          ...(c.id === "oncall/escalation-contacts" ? { stale_after: staleOn } : {}),
        },
        writer(c.by, c.agent),
      );
      // As if written `age` days ago: Home's activity shows this week's.
      const row = await getByCid(ctx, wsId, c.id);
      if (row && c.age > 0) await ctx.db.patch(row._id, { updatedAt: now - c.age * DAY });
    }

    const due = new Date(now + KIND_DAYS.price * DAY).toISOString().slice(0, 10);
    for (const p of DEMO_PROPOSALS) {
      const dated =
        p.kind === "stale"
          ? {
              target: staleOn,
              reason: `Its review date, ${humanDate(staleOn)}, has passed. Still true?`,
            }
          : p.kind === "date"
            ? { target: due, reason: dateReason({ kind: "price", p: 0.91 }, due) }
            : { target: p.target, reason: p.reason };
      await ctx.db.insert("proposals", {
        workspaceId: wsId,
        kind: p.kind,
        subject: p.subject,
        ...(dated.target ? { target: dated.target } : {}),
        reason: dated.reason,
        ...(p.draft ? { draft: p.draft } : {}),
        ...(p.support !== undefined ? { support: p.support } : {}),
        by: p.by,
        ...(p.person ? { userId: people.get(p.person) } : {}),
        ...(p.agent ? { client: p.agent } : {}),
        status: "open",
      });
    }
    // The week's searches, as the MCP's `search` files them, by the team's agents in turn.
    for (const [i, q] of DEMO_QUESTIONS.entries()) {
      const person = DEMO_PEOPLE[i % DEMO_PEOPLE.length].email;
      const agent = DEMO_AGENTS[i % DEMO_AGENTS.length];
      const id = await logQuestion(ctx, wsId, q.text, q.found, {
        userId: people.get(person),
        client: agent,
      });
      if (id && q.opened) await ctx.db.patch(id, { answeredBy: q.opened });
    }
    return {
      library: DEMO_LIBRARY,
      workspaceId: wsId,
      people: members.length,
      concepts: DEMO_CONCEPTS.length,
      sources: DEMO_SOURCES.length,
      proposals: DEMO_PROPOSALS.length,
      questions: DEMO_QUESTIONS.length,
    };
  },
});

/**
 * After BETTER_AUTH_SECRET changes on a dev deployment, the stored signing
 * keys no longer decrypt: drop them so the next signature mints a fresh key.
 * Tokens signed with the old keys stop verifying. LIBROCAT_E2E=1 only.
 */
export const resetSigningKeys = internalMutation({
  args: {},
  handler: async (ctx) => {
    if (process.env.LIBROCAT_E2E !== "1") {
      throw new Error("resetSigningKeys is off: set LIBROCAT_E2E=1 on a dev deployment");
    }
    await ctx.runMutation(components.betterAuth.adapter.deleteMany, {
      input: { model: "jwks" },
      paginationOpts: { numItems: 100, cursor: null },
    });
  },
});

/**
 * A second signing key: a copy of the newest one, dated now. Two first
 * sign-ins at the same moment each create a key, and signing must still work
 * after that (convex/auth.ts jwksWithDates). Returns how many keys there are.
 * LIBROCAT_E2E=1 only.
 */
export const addSigningKey = internalMutation({
  args: {},
  handler: async (ctx): Promise<number> => {
    if (process.env.LIBROCAT_E2E !== "1") {
      throw new Error("addSigningKey is off: set LIBROCAT_E2E=1 on a dev deployment");
    }
    const keys = (await ctx.runQuery(components.betterAuth.adapter.findMany, {
      model: "jwks",
      sortBy: { field: "createdAt", direction: "desc" },
      paginationOpts: { numItems: 100, cursor: null },
    })) as { page: { publicKey: string; privateKey: string }[] };
    const newest = keys.page[0];
    if (!newest) throw new Error("no signing key yet: issue a token first");
    await ctx.runMutation(components.betterAuth.adapter.create, {
      input: {
        model: "jwks",
        data: { publicKey: newest.publicKey, privateKey: newest.privateKey, createdAt: Date.now() },
      },
    });
    return keys.page.length + 1;
  },
});

const TEST_CLIENT_ID = "librocat-e2e";

/**
 * A verified email + password user, for the OAuth e2e: it signs in over HTTP
 * like a person would (the emailed code is skipped by marking the address
 * verified). LIBROCAT_E2E=1 only.
 */
export const createPasswordUser = internalAction({
  args: { email: v.string(), password: v.string() },
  handler: async (ctx, { email, password }): Promise<string> => {
    if (process.env.LIBROCAT_E2E !== "1") {
      throw new Error("createPasswordUser is off: set LIBROCAT_E2E=1 on a dev deployment");
    }
    const auth = createAuth(ctx);
    const res = await auth.api.signUpEmail({ body: { email, password, name: email } });
    await ctx.runMutation(components.betterAuth.adapter.updateOne, {
      input: {
        model: "user",
        where: [{ field: "_id", value: res.user.id }],
        update: { emailVerified: true },
      },
    });
    return res.user.id;
  },
});

/** A user's default library, created if need be, on `plan` (createBrowserUser). */
export const libraryOnPlan = internalMutation({
  args: { userId: v.string(), plan: v.optional(plan) },
  handler: async (ctx, { userId, plan: onPlan }): Promise<Id<"workspaces">> => {
    const { _id: id } = await ensureWorkspace(ctx, userId);
    if (onPlan) await ctx.db.patch(id, { plan: onPlan });
    return id;
  },
});

/**
 * A verified email + password user with a library on `plan`, for the browser
 * tests (browser/support.ts): they sign in over HTTP and hand the session
 * cookie to the browser, so no password is typed on screen. LIBROCAT_E2E=1
 * only.
 */
export const createBrowserUser = internalAction({
  args: { email: v.string(), password: v.string(), plan: v.optional(plan) },
  handler: async (
    ctx,
    { email, password, plan: onPlan },
  ): Promise<{ userId: string; workspaceId: Id<"workspaces"> }> => {
    const userId: string = await ctx.runAction(internal.dev.createPasswordUser, {
      email,
      password,
    });
    const workspaceId: Id<"workspaces"> = await ctx.runMutation(internal.dev.libraryOnPlan, {
      userId,
      plan: onPlan,
    });
    return { userId, workspaceId };
  },
});

/**
 * Register the e2e suites as an OAuth client and grant it to `userId` — what
 * approving an agent on /consent records. Without the grant, an access token
 * for the client is refused (convex/agents.ts agentAllowed).
 */
export const grantTestClient = internalMutation({
  args: { userId: v.string() },
  handler: async (ctx, { userId }) => {
    await grantClient(ctx, userId, TEST_CLIENT_ID, "librocat e2e");
  },
});

/**
 * `count` agents connected to `userId` in `workspaceId`, "Agent 01" the
 * newest, so Connect lists them in order (its pages, browser/agents.e2e.ts).
 * LIBROCAT_E2E=1 only.
 */
export const seedAgents = internalMutation({
  args: { userId: v.string(), workspaceId: v.id("workspaces"), count: v.number() },
  returns: v.null(),
  handler: async (ctx, { userId, workspaceId, count }) => {
    if (process.env.LIBROCAT_E2E !== "1") {
      throw new Error("seedAgents is off: set LIBROCAT_E2E=1 on a dev deployment");
    }
    const now = Date.now();
    for (let n = 1; n <= count; n++) {
      const nn = String(n).padStart(2, "0");
      const clientId = `browser-agent-${nn}`;
      const name = `Agent ${nn}`;
      await grantClient(ctx, userId, clientId, name);
      const had = await ctx.db
        .query("agents")
        .withIndex("by_user_client", (q) => q.eq("userId", userId).eq("clientId", clientId))
        .first();
      const row = { userId, clientId, workspaceId, name, connectedAt: now - n * 86_400_000 };
      if (had) await ctx.db.replace(had._id, row);
      else await ctx.db.insert("agents", row);
    }
    return null;
  },
});

/**
 * Seed (or reuse) a user and sign an MCP access token for it: the same
 * issuer, audience, and key as a real OAuth grant, so the /mcp route and
 * Convex check it exactly as they would an agent's. For the e2e suites.
 */
export const issueTestAccessToken = internalAction({
  args: {
    plan: v.optional(plan),
    email: v.optional(v.string()),
    /** The person's own token, as the dashboard's is: no agent named (`azp`). */
    person: v.optional(v.boolean()),
  },
  handler: async (
    ctx,
    { person, ...args },
  ): Promise<{ token: string; userId: string; workspaceId: Id<"workspaces"> }> => {
    if (process.env.LIBROCAT_E2E !== "1") {
      throw new Error("issueTestAccessToken is off: set LIBROCAT_E2E=1 on a dev deployment");
    }
    const { userId, workspaceId } = await ctx.runMutation(internal.dev.seed, args);
    await ctx.runMutation(internal.dev.grantTestClient, { userId });
    const auth = createAuth(ctx);
    const now = Math.floor(Date.now() / 1000);
    const { token } = await auth.api.signJWT({
      body: {
        payload: {
          sub: userId,
          aud: mcpResource(),
          ...(person ? {} : { azp: TEST_CLIENT_ID }),
          scope: "openid offline_access",
          iat: now,
          exp: now + 3600,
        },
      },
    });
    return { token, userId, workspaceId };
  },
});

/** A page of the Library's concepts by last change, `limit` at a time (model.recentPage), for the e2e. */
export const recentPage = internalQuery({
  args: {
    workspaceId: v.id("workspaces"),
    order: v.union(v.literal("newest"), v.literal("oldest")),
    cursor: v.union(v.string(), v.null()),
    limit: v.number(),
    type: v.optional(v.string()),
    tag: v.optional(v.string()),
    shelf: v.optional(v.string()),
  },
  returns: v.object({ ids: v.array(v.string()), cursor: v.union(v.string(), v.null()) }),
  handler: async (ctx, { workspaceId, ...args }) => {
    const page = await recentPageOf(ctx, workspaceId, args);
    return { ids: page.concepts.map((c) => c.id), cursor: page.cursor };
  },
});

/** The reference desk's last 30 days (convex/reference.ts summarize), for the e2e. */
export const desk = internalQuery({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, { workspaceId }) =>
    summarize(await questionsSince(ctx, workspaceId, Date.now() - 30 * 86_400_000)),
});

// ---- search evaluation (scripts/search-eval.ts) ---------------------------

/** Word search as agents get it (model.search): the first ten ids per query. */
export const searchEvalLexical = internalQuery({
  args: { workspaceId: v.id("workspaces"), queries: v.array(v.string()) },
  handler: async (ctx, { workspaceId, queries }) => {
    const out: string[][] = [];
    for (const query of queries) {
      out.push((await search(ctx, workspaceId, { query, limit: 10 })).map((h) => h.id));
    }
    return out;
  },
});

/** The ids of the workspace's concepts, so the evaluation writes only the ones missing. */
export const searchEvalDocs = internalQuery({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, { workspaceId }) => {
    const rows = await ctx.db
      .query("concepts")
      .withIndex("by_workspace_cid", (q) => q.eq("workspaceId", workspaceId))
      .collect();
    return rows.filter((d) => d.cid !== THESAURUS_ID).map((d) => ({ id: d.cid }));
  },
});

/**
 * Write `count` made-up concepts into a library, from number `start`, past
 * the per-minute limit an agent meets: the scale check (docs/cloud.md, "The
 * catalog index") fills a Team library to its 15,000 this way.
 */
export const bulkIngest = internalMutation({
  args: { workspaceId: v.id("workspaces"), start: v.number(), count: v.number() },
  handler: async (ctx, { workspaceId, start, count }) => {
    for (let i = start; i < start + count; i++) {
      const ws = await ctx.db.get(workspaceId);
      if (!ws) throw new Error(`no library ${workspaceId}`);
      await ingest(
        ctx,
        ws,
        {
          type: i % 3 === 0 ? "Decision" : "Note",
          id: `s${i % 50}/c${i}`,
          title: `Concept ${i}`,
          description: `What concept ${i} says, in a sentence.`,
          tags: [`t${i % 40}`, `u${i % 7}`],
          body: `Concept ${i}, with a [neighbor](c${i + 50}.md) on its shelf.`,
          ...(i % 10 === 0 ? { sources: [`source:src${i % 20}`] } : {}),
        },
        "agent",
      );
    }
    return null;
  },
});
