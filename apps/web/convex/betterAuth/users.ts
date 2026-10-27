// People's names and emails, many in one call: Connect's list of agents and
// the Team page show who each one is (convex/people.ts).
import { v } from "convex/values";
import { query } from "./_generated/server";

export const byIds = query({
  args: { ids: v.array(v.string()) },
  returns: v.array(v.object({ id: v.string(), name: v.string(), email: v.string() })),
  handler: async (ctx, { ids }) => {
    const people: { id: string; name: string; email: string }[] = [];
    for (const id of ids.slice(0, 500)) {
      const userId = ctx.db.normalizeId("user", id);
      const user = userId ? await ctx.db.get(userId) : null;
      if (user) people.push({ id, name: user.name, email: user.email });
    }
    return people;
  },
});
