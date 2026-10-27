"use server";

import { fetchMutation } from "convex/nextjs";
import { getToken } from "@/lib/auth-server";
import { api } from "../../../../convex/_generated/api";
import { errorMessage } from "../../../lib/convex-error";

/**
 * The library an agent will work in, picked on /consent just before its
 * person approves it (convex/agents.ts choose). Null when it's saved, else
 * what went wrong, for the form to show.
 */
export async function pickLibrary(clientId: string, library: string): Promise<string | null> {
  try {
    const token = await getToken();
    await fetchMutation(api.agents.choose, { clientId, library }, { token });
    return null;
  } catch (exc) {
    return errorMessage(exc, "the library could not be picked");
  }
}
