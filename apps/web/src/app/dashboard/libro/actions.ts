"use server";

import { fetchMutation } from "convex/nextjs";
import { ConvexError } from "convex/values";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getToken } from "@/lib/auth-server";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";

// Libro's review shelf: approve applies the proposal as a revision by its
// author (Libro, or the agent that filed it); dismiss files it away for good;
// verify ("Still true") records that you checked a concept past its review
// date. Setting a review date may carry the date the person picked in its
// form. A decision re-renders the page it was made on, in place: the item
// leaves the shelf. Only a failure navigates, to say so.

/** Libro's report by email: on or off for the signed-in member (Account). */
export async function setReportEmail(enabled: boolean): Promise<void> {
  try {
    const token = await getToken();
    await fetchMutation(api.report.setReportEmail, { enabled }, { token });
  } catch {
    redirect("/dashboard/account?error=email");
  }
  revalidatePath("/dashboard/account");
}

/** Every dashboard page that shows the shelf, its counts, or a concept it changed. */
const refresh = () => revalidatePath("/dashboard", "layout");

/**
 * One decision, from Home or a concept's page (`back`, where a failure is
 * said). The form may carry a review date.
 */
export async function decideProposal(
  id: string,
  decision: "approve" | "dismiss" | "verify",
  back: string,
  form?: FormData,
): Promise<void> {
  const picked = form?.get("date");
  const date = typeof picked === "string" && picked ? picked : undefined;
  let failed: string | null = null;
  try {
    const token = await getToken();
    await fetchMutation(
      api.libro.decide,
      { id: id as Id<"proposals">, decision, ...(date ? { date } : {}) },
      { token },
    );
  } catch (e) {
    // A date that isn't one, or has come already (convex/libro.ts pickedDate).
    failed = date && e instanceof ConvexError ? "date" : "decision";
  }
  if (failed) redirect(withLibro(safeBack(back), failed));
  refresh();
}

/** "Approve all": a group of tag pairs, or of review dates as suggested. */
export async function approveAll(ids: string[]): Promise<void> {
  let failed = false;
  try {
    const token = await getToken();
    await fetchMutation(api.libro.approveAll, { ids: ids as Id<"proposals">[] }, { token });
  } catch {
    failed = true;
  }
  if (failed) redirect(withLibro(REVIEW, "decision"));
  refresh();
}

/** Dismiss a question nothing answered, or a file no concept cites, from Needs you. */
export async function dismissGap(kind: "question" | "source", key: string): Promise<void> {
  let failed = false;
  try {
    const token = await getToken();
    await fetchMutation(api.dashboard.dismissGap, { kind, key }, { token });
  } catch {
    failed = true;
  }
  if (failed) redirect(withLibro(REVIEW, "decision"));
  refresh();
}

/** Only a dashboard path: a decision never sends anyone off the site. */
function safeBack(back: string): string {
  return back.startsWith("/dashboard") && !back.startsWith("//") ? back : REVIEW;
}

/** Where the review queue is: the Library's Needs you. */
const REVIEW = "/dashboard/concepts?tab=review";

/** `back` with what failed, after any query it already has. */
const withLibro = (back: string, failed: string) =>
  `${back}${back.includes("?") ? "&" : "?"}libro=${failed}`;
