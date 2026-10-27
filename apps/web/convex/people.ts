/**
 * Who people are, for the pages that show teammates (Connect's agents, Team):
 * their names and emails from the Better Auth component, in one call.
 */

import { components } from "./_generated/api";
import type { QueryCtx } from "./_generated/server";

export type Person = { id: string; name: string; email: string };

/** These people, by id; a deleted account is missing. */
export async function peopleOf(ctx: QueryCtx, ids: string[]): Promise<Map<string, Person>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const people: Person[] = await ctx.runQuery(components.betterAuth.users.byIds, { ids: unique });
  return new Map(people.map((p) => [p.id, p]));
}

/** What teammates see a person called: the name they gave, else their email. */
export function nameOf(person: Person | undefined): string {
  return person?.name.trim() || person?.email || "Someone";
}
