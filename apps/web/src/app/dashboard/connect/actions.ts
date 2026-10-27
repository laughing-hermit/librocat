"use server";

import { fetchMutation } from "convex/nextjs";
import { revalidatePath } from "next/cache";
import { getToken } from "@/lib/auth-server";
import { api } from "../../../../convex/_generated/api";

/** Disconnect one agent: its grant and every token it holds (convex/agents.ts). */
export async function revokeAgent(clientId: string): Promise<void> {
  const token = await getToken();
  await fetchMutation(api.agents.revoke, { clientId }, { token });
  revalidatePath("/dashboard/connect");
}
