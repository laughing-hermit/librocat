"use server";

import { fetchMutation } from "convex/nextjs";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getToken } from "@/lib/auth-server";
import { api } from "../../../convex/_generated/api";

/** Delete every concept in the workspace. The UI confirms before calling. */
export async function deleteIndex(): Promise<void> {
  if (!process.env.NEXT_PUBLIC_CONVEX_URL) redirect("/dashboard");
  try {
    const token = await getToken();
    await fetchMutation(api.concepts.deleteAll, {}, { token });
  } catch {
    redirect("/dashboard/library?error=empty");
  }
  revalidatePath("/dashboard");
  redirect("/dashboard/concepts?done=emptied");
}
