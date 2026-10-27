/**
 * What deleting a library says it does, its plan included (Settings ›
 * General). Deleting cancels the library's own subscription at once, with no
 * refund for the time left (the terms); a Team's home takes the Team with it,
 * and the libraries it covered go back to Free (convex/workspaces.ts
 * deleteLibrary). A library a Team covers leaves the Team as it was.
 */

const PLAN_NAME: Record<string, string> = { individual: "Individual", team: "Team" };

const KEEP = "There is no undo: export first to keep a copy.";
const USAGE = "Any pay-as-you-go used this month is billed.";

/** "Docs", "Docs and Wiki", "Docs, Wiki, and Notes". */
const andList = (names: string[]) =>
  new Intl.ListFormat("en", { style: "long", type: "conjunction" }).format(names);

export function deleteLibraryCopy(lib: {
  name: string;
  plan: string;
  /** The Team's home, when a Team covers this library. */
  billedWith: string | null;
  /** The libraries this one's Team covers, when it's the home. */
  covers: string[];
}): { title: string; description: string; row: string } {
  const plan = lib.billedWith ? undefined : PLAN_NAME[lib.plan];
  if (!plan) {
    return {
      title: `Delete “${lib.name}”?`,
      description: lib.billedWith
        ? `Everything in it goes, for everyone. The Team plan stays, billed with ${lib.billedWith}. ${KEEP}`
        : `Everything in it goes, for everyone. ${KEEP}`,
      row: "It goes for everyone. Your other libraries stay.",
    };
  }
  if (lib.plan === "team" && lib.covers.length > 0) {
    const others = andList(lib.covers);
    return {
      title: `Delete “${lib.name}” and end the Team plan?`,
      description: `Everything in it goes, for everyone, and the Team plan ends now, with no refund for the time left: ${others} ${lib.covers.length === 1 ? "goes" : "go"} back to Free. ${USAGE} ${KEEP}`,
      row: `It goes for everyone, and the Team plan ends: ${others} ${lib.covers.length === 1 ? "goes" : "go"} back to Free.`,
    };
  }
  return {
    title: `Delete “${lib.name}” and end its plan?`,
    description: `Everything in it goes, for everyone, and its ${plan} plan ends now, with no refund for the time left. ${USAGE} ${KEEP}`,
    row: "It goes for everyone, and its plan ends. Your other libraries stay.",
  };
}
