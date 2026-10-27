"use server";

import { ConceptView } from "@/components/concept-view";
import { requireSession } from "@/lib/require-session";

/**
 * A concept opened in place, in one counted call: a Library row's whole
 * view, or `brief`, inside a Needs you row (its text, its line, its links).
 */
export async function openConcept(id: string, brief = false) {
  await requireSession();
  return <ConceptView id={id} brief={brief} />;
}
