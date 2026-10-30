import { slugify } from "@librocat/core/format";
import { ConvexError } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { peopleOf } from "./people";

// A person can belong to several libraries (a library is a `workspaces` row),
// like Supabase projects. Four ways to name one:
// - the default: the first library they joined;
// - an agent's own: the one its person picked on /consent when they
//   approved it (agentLibraries), which the plain /mcp URL reaches, else the
//   default, so an agent set up once never changes library by itself;
// - by slug: `/mcp?library=<slug>`, for a repo that pins its library;
// - the dashboard's current library: the one they last switched to.

/**
 * Whether someone's place in a library is paused. Only a Team shares a
 * library: on any other plan (its Team ended) only its owner uses it. The
 * membership stays, so choosing Team again brings everyone back with their
 * roles, and nothing in the library is deleted. A self-hosted librocat has
 * no plans.
 */
export const pausedIn = (ws: Doc<"workspaces">, userId: string): boolean =>
  process.env.LIBROCAT_SELF_HOST !== "1" && ws.plan !== "team" && ws.ownerId !== userId;

/** What a paused teammate is told. */
export const PAUSED =
  "This library is paused for you: it's no longer on Team, so only its owner can use it. " +
  "Nothing in it was deleted, and its owner can bring you back by choosing Team on its " +
  "Billing page.";

async function membershipsOf(ctx: QueryCtx, userId: string) {
  return await ctx.db
    .query("members")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();
}

/**
 * The user's default library: the first they joined that isn't paused
 * (pausedIn), else the first they own but `except` (one being deleted: its
 * row stays until its teardown ends, convex/account.ts).
 */
export async function workspaceForUserId(
  ctx: QueryCtx,
  userId: string,
  except?: Id<"workspaces">,
): Promise<Doc<"workspaces"> | null> {
  for (const m of await membershipsOf(ctx, userId)) {
    const ws = await ctx.db.get(m.workspaceId);
    if (ws && !pausedIn(ws, userId)) return ws;
  }
  const owned = await ctx.db
    .query("workspaces")
    .withIndex("by_owner", (q) => q.eq("ownerId", userId))
    .take(2);
  return owned.find((ws) => ws._id !== except) ?? null;
}

/**
 * Whether the first library the user joined is paused for them. An agent
 * they picked no library for reaches that one, so it stops (convex/mcp.ts)
 * rather than move to another: an agent never changes library by itself.
 */
export async function defaultPaused(ctx: QueryCtx, userId: string) {
  const first = await ctx.db
    .query("members")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .first();
  const ws = first ? await ctx.db.get(first.workspaceId) : null;
  return ws !== null && pausedIn(ws, userId);
}

/**
 * Every library the user belongs to and isn't paused in, with their
 * membership, in the order they joined. `default`: the first they joined,
 * which the plain /mcp URL reaches.
 */
export async function librariesOf(ctx: QueryCtx, userId: string) {
  const out: { ws: Doc<"workspaces">; member: Doc<"members">; default: boolean }[] = [];
  for (const [i, member] of (await membershipsOf(ctx, userId)).entries()) {
    const ws = await ctx.db.get(member.workspaceId);
    if (ws && !pausedIn(ws, userId)) out.push({ ws, member, default: i === 0 });
  }
  return out;
}

/** The libraries the user is paused in (pausedIn), for the dashboard to say so. */
export async function pausedLibrariesOf(ctx: QueryCtx, userId: string) {
  const out: Doc<"workspaces">[] = [];
  for (const member of await membershipsOf(ctx, userId)) {
    const ws = await ctx.db.get(member.workspaceId);
    if (ws && pausedIn(ws, userId)) out.push(ws);
  }
  return out;
}

/** Is the user in this library, but paused (pausedIn)? */
export async function pausedMember(ctx: QueryCtx, userId: string, ws: Doc<"workspaces">) {
  if (!pausedIn(ws, userId)) return false;
  return (await membershipsOf(ctx, userId)).some((m) => m.workspaceId === ws._id);
}

/** Does the user belong to this library, and isn't paused in it (pausedIn)? */
export async function belongsTo(ctx: QueryCtx, userId: string, workspaceId: Id<"workspaces">) {
  if (!(await membershipsOf(ctx, userId)).some((m) => m.workspaceId === workspaceId)) return false;
  const ws = await ctx.db.get(workspaceId);
  return ws !== null && !pausedIn(ws, userId);
}

/** The library with this slug, whoever's it is. */
export async function bySlug(ctx: QueryCtx, slug: string) {
  return await ctx.db
    .query("workspaces")
    .withIndex("by_slug", (q) => q.eq("slug", slug.trim().toLowerCase()))
    .unique();
}

/** The library with this slug, if the user belongs to it; null otherwise. */
export async function libraryBySlug(ctx: QueryCtx, userId: string, slug: string) {
  const ws = await bySlug(ctx, slug);
  if (!ws) return null;
  return (await belongsTo(ctx, userId, ws._id)) ? ws : null;
}

/** The dashboard's library: the one last switched to, if still theirs, else the default. */
export async function currentWorkspaceForUserId(
  ctx: QueryCtx,
  userId: string,
): Promise<Doc<"workspaces"> | null> {
  const pref = await ctx.db
    .query("currentLibrary")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
  if (pref) {
    const mine = await membershipsOf(ctx, userId);
    if (mine.some((m) => m.workspaceId === pref.workspaceId)) {
      const ws = await ctx.db.get(pref.workspaceId);
      if (ws && !pausedIn(ws, userId)) return ws;
    }
  }
  return await workspaceForUserId(ctx, userId);
}

/** Make `workspaceId` the dashboard's library for the user. */
export async function setCurrentLibrary(
  ctx: MutationCtx,
  userId: string,
  workspaceId: Doc<"workspaces">["_id"],
) {
  const pref = await ctx.db
    .query("currentLibrary")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
  if (pref) await ctx.db.patch(pref._id, { workspaceId });
  else await ctx.db.insert("currentLibrary", { userId, workspaceId });
}

const TAIL = "abcdefghijklmnopqrstuvwxyz0123456789";

/**
 * A new library's slug: its name, and six random characters so slugs never
 * collide and cannot be guessed from a name ("acme-docs-k3f9x2"). A slug
 * never changes, since agents' configs hold it; renaming keeps it.
 */
export async function newSlug(ctx: MutationCtx, name: string): Promise<string> {
  const base = slugify(name).slice(0, 40).replace(/-+$/, "") || "library";
  for (;;) {
    const tail = Array.from(crypto.getRandomValues(new Uint8Array(6)))
      .map((b) => TAIL[b % TAIL.length])
      .join("");
    const slug = `${base}-${tail}`;
    const taken = await ctx.db
      .query("workspaces")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .first();
    if (!taken) return slug;
  }
}

/** The library's slug, given one first if it predates slugs. */
export async function slugOf(ctx: MutationCtx, ws: Doc<"workspaces">): Promise<string> {
  if (ws.slug) return ws.slug;
  const slug = await newSlug(ctx, ws.name);
  await ctx.db.patch(ws._id, { slug });
  return slug;
}

/** Create a library owned by `userId`, with them as its admin. */
export async function createLibraryFor(ctx: MutationCtx, userId: string, name: string) {
  const wsId = await ctx.db.insert("workspaces", {
    name,
    slug: await newSlug(ctx, name),
    ownerId: userId,
    plan: "free",
    conceptCount: 0,
  });
  await ctx.db.insert("members", { workspaceId: wsId, userId, role: "admin" });
  return (await ctx.db.get(wsId)) as Doc<"workspaces">;
}

/**
 * The user's default library, created on first need: at sign-up (the auth
 * component's user trigger, convex/auth.ts, which passes the name given), on
 * a first write, or when the library being deleted (`except`) was their
 * last. Idempotent. Free of Better Auth imports, so auth.ts can use it
 * without a cycle.
 */
export async function ensureWorkspace(
  ctx: MutationCtx,
  userId: string,
  name?: string,
  except?: Id<"workspaces">,
) {
  const existing = await workspaceForUserId(ctx, userId, except);
  if (existing) {
    if (existing.slug) return existing;
    await slugOf(ctx, existing);
    return (await ctx.db.get(existing._id)) as Doc<"workspaces">;
  }
  const owner = name ?? (await peopleOf(ctx, [userId])).get(userId)?.name;
  return await createLibraryFor(ctx, userId, firstLibraryName(owner));
}

/**
 * A first library's name, its owner's, as a device's is ("Ana's library"),
 * so a Team's people read whose it is. "My library" when the name is an
 * email (an account made by a script) or too long for a library name.
 */
export function firstLibraryName(name: string | undefined): string {
  const first = name?.trim().split(/\s+/)[0] ?? "";
  return first && !first.includes("@") && first.length <= 50 ? `${first}'s library` : "My library";
}

/** A person's say in a library, as people see it: the owner is always an admin. */
export type Role = "admin" | "editor" | "reader";

/** Their role in this library, or null when they aren't in it or are paused in it. */
export async function roleIn(
  ctx: QueryCtx,
  ws: Doc<"workspaces">,
  userId: string,
): Promise<Role | null> {
  if (ws.ownerId === userId) return "admin";
  if (pausedIn(ws, userId)) return null;
  const m = (await membershipsOf(ctx, userId)).find((x) => x.workspaceId === ws._id);
  if (!m) return null;
  return m.role === "admin" ? "admin" : m.role === "reader" ? "reader" : "editor";
}

/** Readers (and their agents) read; admins and Editors change the library. */
export async function canWrite(ctx: QueryCtx, ws: Doc<"workspaces">, userId: string) {
  const role = await roleIn(ctx, ws, userId);
  return role === "admin" || role === "editor";
}

/** What a Reader's change is told. */
export const READ_ONLY =
  "You can read this library but not change it: ask one of its admins to make you an " +
  "Editor (Team page).";

/** Refuse a Reader's change, saying how to get one made. */
export async function requireWriter(ctx: QueryCtx, ws: Doc<"workspaces">, userId: string) {
  if (!(await canWrite(ctx, ws, userId))) throw new ConvexError(READ_ONLY);
}
