/**
 * Teams: a workspace shared by as many people as it has seats (model.ts), each signed in
 * with their own account — so every write says who made it, and removing a
 * person removes only them. People join through one share link per
 * workspace; an admin regenerates it to revoke the old one. Only the Team
 * plan has seats to share.
 */

import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import { authComponent } from "./auth";
import { authUserId, personId } from "./identity";
import {
  currentWorkspaceForUserId,
  ensureWorkspace,
  pausedIn,
  type Role,
  setCurrentLibrary,
  workspaceForUserId,
} from "./membership";
import { deleteSome, seatsOf } from "./model";
import { nameOf, peopleOf } from "./people";
import { teamHomeOf, teamLibraries, teamPeople } from "./teamCover";

async function requireUser(ctx: QueryCtx) {
  const userId = await authUserId(ctx);
  if (!userId) throw new ConvexError("not signed in");
  return userId;
}

async function membership(ctx: QueryCtx, workspaceId: Id<"workspaces">, userId: string) {
  return (
    await ctx.db
      .query("members")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .collect()
  ).find((m) => m.userId === userId);
}

/** The caller's workspace (the dashboard's library), and whether they administer it. */
async function requireWorkspaceRole(ctx: QueryCtx) {
  const userId = await requireUser(ctx);
  const ws = await currentWorkspaceForUserId(ctx, userId);
  if (!ws) throw new ConvexError("no workspace yet");
  const me = await membership(ctx, ws._id, userId);
  return { userId, ws, admin: me?.role === "admin" || ws.ownerId === userId };
}

/** An admin of the dashboard's library, themselves: an agent never manages the team. */
async function requireAdmin(ctx: QueryCtx) {
  await personId(ctx);
  const r = await requireWorkspaceRole(ctx);
  if (!r.admin) throw new ConvexError("only a workspace admin can manage the team");
  return r;
}

const newCode = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(18)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

/**
 * Everyone in the caller's workspace, the seats, and (for admins) the invite
 * link code. On a Team, the seats used count each person once across its
 * libraries (teamCover.ts).
 */
export const overview = query({
  args: {},
  handler: async (ctx) => {
    const { userId, ws, admin } = await requireWorkspaceRole(ctx);
    const rows = await ctx.db
      .query("members")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", ws._id))
      .collect();
    const people = await peopleOf(
      ctx,
      rows.map((m) => m.userId),
    );
    const members = rows.map((m) => {
      const person = people.get(m.userId);
      return {
        userId: m.userId,
        // The name they gave, when it says more than their email does.
        name: person?.name.trim() && person.name.trim() !== person.email ? nameOf(person) : null,
        email: person?.email ?? "(deleted account)",
        // As people see it: the owner is an admin, a member an Editor.
        role: (m.userId === ws.ownerId || m.role === "admin"
          ? "admin"
          : m.role === "reader"
            ? "reader"
            : "editor") as Role,
        you: m.userId === userId,
        owner: m.userId === ws.ownerId,
        // Its Team ended: only its owner uses it until it's on Team again (membership.ts).
        paused: pausedIn(ws, m.userId),
      };
    });
    const invite = admin
      ? await ctx.db
          .query("invites")
          .withIndex("by_workspace", (q) => q.eq("workspaceId", ws._id))
          .first()
      : null;
    const home = await teamHomeOf(ctx, ws);
    return {
      workspace: ws.name,
      plan: ws.plan,
      seats: seatsOf(ws),
      seatsUsed: home ? (await teamPeople(ctx, home)).size : rows.length,
      libraries: home ? (await teamLibraries(ctx, home)).length : 1,
      admin,
      members,
      inviteCode: invite?.code ?? null,
      inviteRole: invite?.role === "reader" ? ("reader" as const) : ("editor" as const),
    };
  },
});

/**
 * Mint the workspace's share link, replacing (and so revoking) any previous
 * one. The people who join through it are Editors, or Readers when it says
 * so (`role`).
 */
export const createInvite = mutation({
  args: { role: v.optional(v.union(v.literal("member"), v.literal("reader"))) },
  handler: async (ctx, { role }) => {
    const { userId, ws } = await requireAdmin(ctx);
    if (seatsOf(ws) <= 1) {
      throw new ConvexError("invites need the Team plan: choose it on the Billing page");
    }
    await removeInvites(ctx, ws._id);
    const code = newCode();
    await ctx.db.insert("invites", {
      workspaceId: ws._id,
      code,
      createdBy: userId,
      ...(role === "reader" ? { role } : {}),
    });
    return code;
  },
});

async function removeInvites(ctx: MutationCtx, workspaceId: Id<"workspaces">) {
  const old = await ctx.db
    .query("invites")
    .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
    .collect();
  for (const invite of old) await ctx.db.delete(invite._id);
}

/** Turn the share link off. */
export const revokeInvite = mutation({
  args: {},
  handler: async (ctx) => {
    const { ws } = await requireAdmin(ctx);
    await removeInvites(ctx, ws._id);
    return null;
  },
});

/** What an invite leads to, for the /invite page before accepting. Null when revoked. */
export const invite = query({
  args: { code: v.string() },
  handler: async (ctx, { code }) => {
    const row = await ctx.db
      .query("invites")
      .withIndex("by_code", (q) => q.eq("code", code))
      .unique();
    if (!row) return null;
    const ws = await ctx.db.get(row.workspaceId);
    if (!ws) return null;
    const inviter = await authComponent.getAnyUserById(ctx, row.createdBy);
    // What the person joins as, for the invite to say before they press Join.
    const role: "editor" | "reader" = row.role === "reader" ? "reader" : "editor";
    return { workspace: ws.name, invitedBy: inviter?.email ?? null, role };
  },
});

/**
 * Join the workspace behind an invite; the dashboard switches to it. A
 * person can belong to several libraries, but a new teammate usually has
 * only the empty one made at sign-up: that one is folded away, so the team's
 * library becomes their default and their agents' plain /mcp URL reaches it.
 * A library that holds concepts or has a plan stays, and the team's is
 * reached with `?library=`.
 */
export const accept = mutation({
  args: { code: v.string() },
  handler: async (ctx, { code }) => {
    // A person joins a team, not their agent.
    await personId(ctx);
    const userId = await requireUser(ctx);
    const row = await ctx.db
      .query("invites")
      .withIndex("by_code", (q) => q.eq("code", code))
      .unique();
    if (!row) throw new ConvexError("this invite link was revoked or never existed");
    const target = (await ctx.db.get(row.workspaceId)) as Doc<"workspaces"> | null;
    if (!target) throw new ConvexError("the workspace behind this invite is gone");
    if (await membership(ctx, target._id, userId)) return target._id;

    const current = await workspaceForUserId(ctx, userId);
    const others = await ctx.db
      .query("members")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    const foldable =
      current &&
      current._id !== target._id &&
      others.length === 1 &&
      current.ownerId === userId &&
      current.conceptCount === 0 &&
      !current.stripeSubscriptionId;
    if (current && foldable) {
      await deleteSome(ctx, current._id);
      const mine = await ctx.db
        .query("members")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", current._id))
        .collect();
      for (const m of mine) await ctx.db.delete(m._id);
      await removeInvites(ctx, current._id);
      await ctx.db.delete(current._id);
    }

    // On a Team, a person takes one seat across all its libraries (teamCover.ts).
    const home = await teamHomeOf(ctx, target);
    const people = home
      ? await teamPeople(ctx, home)
      : new Set(
          (
            await ctx.db
              .query("members")
              .withIndex("by_workspace", (q) => q.eq("workspaceId", target._id))
              .collect()
          ).map((m) => m.userId),
        );
    const seats = seatsOf(home ?? target);
    if (!people.has(userId) && people.size >= seats) {
      throw new ConvexError(
        `${target.name} has no free seat (${seats} on its plan): ask its admin to ` +
          "add a seat on the Billing page",
      );
    }
    await ctx.db.insert("members", {
      workspaceId: target._id,
      userId,
      role: row.role ?? "member",
    });
    await setCurrentLibrary(ctx, userId, target._id);
    return target._id;
  },
});

/**
 * Change what someone may do in the library: an admin runs it, an Editor
 * (member) and their agents change it, a Reader and their agents only read
 * it. Admins only; the owner is always an admin, and an admin doesn't
 * change their own role (another admin does), so a library always keeps one.
 */
export const setRole = mutation({
  args: {
    userId: v.string(),
    role: v.union(v.literal("admin"), v.literal("member"), v.literal("reader")),
  },
  handler: async (ctx, { userId, role }) => {
    const { userId: me, ws } = await requireAdmin(ctx);
    if (userId === ws.ownerId) throw new ConvexError("the library's owner is always an admin");
    if (userId === me) throw new ConvexError("another admin changes your role");
    const m = await membership(ctx, ws._id, userId);
    if (!m) throw new ConvexError("they're not in this library");
    await ctx.db.patch(m._id, { role });
    return null;
  },
});

/** Take someone off the team. Admins only; the owner stays. */
export const removeMember = mutation({
  args: { userId: v.string() },
  handler: async (ctx, { userId }) => {
    const { ws } = await requireAdmin(ctx);
    if (userId === ws.ownerId) throw new ConvexError("the workspace owner cannot be removed");
    const m = await membership(ctx, ws._id, userId);
    if (m) await ctx.db.delete(m._id);
    // Removed from their only library, they get a new one of their own.
    await ensureWorkspace(ctx, userId);
    return null;
  },
});
