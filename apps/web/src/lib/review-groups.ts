/**
 * The three groups Needs you shows a person (each row's badge, and the
 * filter's chips): what the library is missing, what may be out of date,
 * and what's said twice. Plain data, for the server rows and the client
 * filter alike.
 */
export const GROUPS = ["Missing", "Outdated", "Duplicates"] as const;
export type Group = (typeof GROUPS)[number];
