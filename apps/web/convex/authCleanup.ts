/**
 * Daily: what Better Auth no longer needs is deleted, a batch at a time
 * (convex/betterAuth/cleanup.ts): expired sessions, emailed codes, and
 * tokens. Registering an agent needs no sign-in, and is never limited nor
 * undone, which could turn away people connecting their agents; instead
 * the owner hears when unusually many registered in a day.
 */

import { v } from "convex/values";
import { components, internal } from "./_generated/api";
import { internalAction, internalMutation } from "./_generated/server";
import { ownerAddresses, sendEmail } from "./email";

const DAY = 86_400_000;
/** More client registrations than this in a day, and the owner gets a note. */
export const REGISTRATIONS_NOTE = 5_000;

export const prune = internalMutation({
  args: { more: v.optional(v.boolean()), deleted: v.optional(v.number()) },
  handler: async (ctx, { more: again = false, deleted = 0 }) => {
    // The day's first run counts the day's registrations (a bounded read).
    if (!again) {
      const registered = await ctx.runQuery(components.betterAuth.cleanup.registeredSince, {
        since: Date.now() - DAY,
        limit: REGISTRATIONS_NOTE + 1,
      });
      if (registered > REGISTRATIONS_NOTE) {
        await ctx.scheduler.runAfter(0, internal.authCleanup.noteRegistrations, {});
      }
    }
    const run = await ctx.runMutation(components.betterAuth.cleanup.expired, {});
    const total = deleted + run.deleted;
    if (run.more) {
      await ctx.scheduler.runAfter(1_000, internal.authCleanup.prune, {
        more: true,
        deleted: total,
      });
    }
    return { deleted: total, more: run.more };
  },
});

/** The owner's note (LIBROCAT_FUNNEL_EMAIL): many registrations in a day, none turned away. */
export const noteRegistrations = internalAction({
  args: {},
  handler: async () => {
    const to = ownerAddresses();
    const many = REGISTRATIONS_NOTE.toLocaleString("en-US");
    for (const address of to) {
      await sendEmail({
        to: address,
        subject: `librocat: more than ${many} agent registrations in a day`,
        text: [
          `More than ${many} OAuth clients registered with librocat in the last day: agents connecting, or someone registering by script.`,
          "Nobody was turned away. Each registration is a small row, kept, since an agent may come back with it.",
          "If it goes on, look at the requests to /api/auth/oauth2/register in Vercel's firewall.",
        ].join("\n\n"),
      });
    }
    return { sent: to.length };
  },
});
