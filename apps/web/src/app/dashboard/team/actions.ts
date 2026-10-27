"use server";

import { fetchAction, fetchMutation } from "convex/nextjs";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getToken } from "@/lib/auth-server";
import { errorMessage } from "@/lib/convex-error";
import { api } from "../../../../convex/_generated/api";

export type TeamResult = { ok: true } | { ok: false; error: string };
/** A new invite link's result: its code, to copy at once. */
export type InviteResult = { ok: true; code: string } | { ok: false; error: string };

async function run(fn: (token: string | undefined) => Promise<unknown>): Promise<TeamResult> {
  try {
    await fn(await getToken());
    revalidatePath("/dashboard/team");
    return { ok: true };
  } catch (exc) {
    return { ok: false, error: errorMessage(exc) };
  }
}

/** A new share link, for Editors or Readers; the old one stops working. */
export async function createInvite(role: "editor" | "reader" = "editor"): Promise<InviteResult> {
  let code = "";
  const result = await run(async (token) => {
    code = await fetchMutation(
      api.team.createInvite,
      { role: role === "reader" ? "reader" : "member" },
      { token },
    );
  });
  return result.ok ? { ok: true, code } : result;
}

/**
 * One more seat on the Team, billed like the others (charged at once): what a full
 * Team needs before a new person can join (convex/stripe.ts updateSeats).
 */
export async function addSeat(seats: number): Promise<TeamResult> {
  let approve: string | null = null;
  try {
    ({ approve } = await fetchAction(
      api.stripe.updateSeats,
      { seats: seats + 1 },
      { token: await getToken() },
    ));
  } catch (exc) {
    return { ok: false, error: errorMessage(exc) };
  }
  // The bank asks its cardholder to approve the charge: on Stripe's page.
  if (approve) redirect(approve);
  revalidatePath("/dashboard/team");
  revalidatePath("/dashboard/billing");
  return { ok: true };
}

/** What someone may do here: run it (admin), change it (Editor), or read it (Reader). */
export async function setRole(
  userId: string,
  role: "admin" | "editor" | "reader",
): Promise<TeamResult> {
  return run((token) =>
    fetchMutation(
      api.team.setRole,
      { userId, role: role === "editor" ? "member" : role },
      { token },
    ),
  );
}

export async function revokeInvite(): Promise<TeamResult> {
  return run((token) => fetchMutation(api.team.revokeInvite, {}, { token }));
}

export async function removeMember(userId: string): Promise<TeamResult> {
  return run((token) => fetchMutation(api.team.removeMember, { userId }, { token }));
}

/** Join the workspace behind an invite, then open it: the invite's form action (useActionState). */
export async function acceptInvite(code: string, _before?: TeamResult | null): Promise<TeamResult> {
  const result = await run((token) => fetchMutation(api.team.accept, { code }, { token }));
  if (result.ok) redirect("/dashboard");
  return result;
}
