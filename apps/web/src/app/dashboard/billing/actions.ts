"use server";

import { fetchAction, fetchMutation } from "convex/nextjs";
import { ConvexError } from "convex/values";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getToken } from "@/lib/auth-server";
import { api } from "../../../../convex/_generated/api";

/** Start a Stripe Checkout session for a paid plan and redirect to it. */
export async function startCheckout(
  plan: "individual" | "team",
  interval: "monthly" | "annual",
): Promise<void> {
  if (!process.env.NEXT_PUBLIC_CONVEX_URL) redirect("/dashboard/billing?error=convex");
  let url: string | null = null;
  let error = "stripe";
  try {
    const token = await getToken();
    url = (await fetchAction(
      api.stripe.createCheckoutSession,
      { plan, interval },
      { token },
    )) as string;
  } catch (e) {
    if (adminOnly(e)) error = "admin";
  }
  if (!url) redirect(`/dashboard/billing?error=${error}`);
  redirect(url);
}

/**
 * Individual to Team, on the same subscription (convex/stripe.ts
 * switchToTeam): the difference charged at once, prorated at the moment
 * Billing priced it (`prorationDate`), with a seat for each person in the
 * library.
 */
export async function switchToTeam(form: FormData): Promise<void> {
  if (!process.env.NEXT_PUBLIC_CONVEX_URL) redirect("/dashboard/billing?error=convex");
  const shown = Number(form.get("prorationDate"));
  let error: string | null = null;
  let approve: string | null = null;
  try {
    const token = await getToken();
    ({ approve } = await fetchAction(
      api.stripe.switchToTeam,
      Number.isInteger(shown) && shown > 0 ? { prorationDate: shown } : {},
      { token },
    ));
  } catch (e) {
    error = adminOnly(e) ? "admin" : declined(e) ? "card" : "switch";
  }
  if (error) redirect(`/dashboard/billing?error=${error}`);
  // The bank asks its cardholder to approve the charge: on Stripe's page.
  if (approve) redirect(approve);
  revalidatePath("/dashboard", "layout");
  redirect("/dashboard/billing?done=team");
}

/**
 * A new library, made to buy a plan for at once (New library past the Free
 * one): it is created, the dashboard switches to it, then its Checkout opens.
 */
export async function createLibraryAndCheckout(
  name: string,
  plan: "individual" | "team",
): Promise<{ error: string }> {
  let made = false;
  let error = "The library could not be made. Please try again.";
  try {
    const token = await getToken();
    await fetchMutation(api.workspaces.createLibrary, { name, checkout: true }, { token });
    made = true;
  } catch (e) {
    if (e instanceof ConvexError) error = String(e.data);
  }
  if (!made) return { error };
  revalidatePath("/dashboard", "layout");
  await startCheckout(plan, "annual");
  return { error };
}

/** Open the Stripe Customer Portal: cancel, change card, download invoices. */
export async function openPortal(): Promise<void> {
  if (!process.env.NEXT_PUBLIC_CONVEX_URL) redirect("/dashboard/billing?error=convex");
  let url: string | null = null;
  let error = "portal";
  try {
    const token = await getToken();
    url = (await fetchAction(api.stripe.createPortalSession, {}, { token })) as string;
  } catch (e) {
    if (adminOnly(e)) error = "admin";
  }
  if (!url) redirect(`/dashboard/billing?error=${error}`);
  redirect(url);
}

/** Change a Team library's seats (its admin only); Stripe prorates the change and bills it at once. */
export async function changeSeats(form: FormData): Promise<void> {
  const seats = Number(form.get("seats"));
  let approve: string | null = null;
  try {
    const token = await getToken();
    ({ approve } = await fetchAction(api.stripe.updateSeats, { seats }, { token }));
  } catch (e) {
    redirect(`/dashboard/billing?error=${seatsError(e)}`);
  }
  // The bank asks its cardholder to approve the charge: on Stripe's page.
  if (approve) redirect(approve);
  revalidatePath("/dashboard/billing");
  redirect("/dashboard/billing?done=seats");
}

/**
 * Which seats message Billing shows: the reason updateSeats gave
 * (convex/stripe.ts), so a failure that isn't about the count says so.
 */
function seatsError(e: unknown): string {
  const why = e instanceof ConvexError ? String(e.data) : "";
  if (why.startsWith("choose from")) return "seats-range";
  if (adminOnly(e)) return "admin";
  if (declined(e)) return "card";
  if (why.startsWith("seats come with")) return "seats-plan";
  return "seats";
}

/** Whether Convex refused because only the library's admin may do it (convex/stripe.ts). */
function adminOnly(e: unknown): boolean {
  return e instanceof ConvexError && String(e.data).startsWith("only a library's admin");
}

/** Whether the card on file didn't pay, so nothing changed (convex/stripe.ts DECLINED). */
function declined(e: unknown): boolean {
  return e instanceof ConvexError && String(e.data).startsWith("the card on file was declined");
}

/** Turn pay-as-you-go indexation on or off for the workspace. */
export async function setPayAsYouGo(enabled: boolean): Promise<void> {
  try {
    const token = await getToken();
    await fetchMutation(api.workspaces.setPayAsYouGo, { enabled }, { token });
  } catch {
    redirect("/dashboard/billing?error=payg");
  }
  revalidatePath("/dashboard/billing");
  redirect("/dashboard/billing");
}

/** Set the most pay-as-you-go may bill in a month, in whole dollars (its admins only). */
export async function setPayAsYouGoCap(form: FormData): Promise<void> {
  const dollars = Number(form.get("dollars"));
  try {
    const token = await getToken();
    await fetchMutation(api.workspaces.setPayAsYouGoCap, { dollars }, { token });
  } catch {
    redirect("/dashboard/billing?error=cap");
  }
  revalidatePath("/dashboard/billing");
  redirect("/dashboard/billing?done=cap");
}

/**
 * Delete the workspace and the account (GDPR): cancels any subscription,
 * wipes the index, and removes the identity — not just "Empty library" in Settings,
 * which only clears concepts. The UI confirms before calling. Same
 * fire-and-forget-then-redirect shape as deleteIndex (dashboard/actions.ts):
 * the teardown runs in scheduled slices, so this only kicks it off.
 */
export async function deleteAccount(): Promise<void> {
  if (!process.env.NEXT_PUBLIC_CONVEX_URL) redirect("/dashboard/account");
  try {
    const token = await getToken();
    await fetchMutation(api.account.deleteAccount, {}, { token });
  } catch {
    redirect("/dashboard/account?error=delete");
  }
  redirect("/");
}
