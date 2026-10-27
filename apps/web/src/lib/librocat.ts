// Server-side data access for the dashboard, backed by Convex. The dashboard
// is the control plane (browse, export/delete, billing, connected agents);
// concept writes go through the MCP, per docs/architecture.md.

import { fetchAction, fetchMutation, fetchQuery } from "convex/nextjs";
import type { FunctionArgs, FunctionReference, FunctionReturnType } from "convex/server";
import { headers } from "next/headers";
import { cache } from "react";
import { api } from "../../convex/_generated/api";
import { getToken } from "./auth-server";
import { errorMessage } from "./convex-error";

export { conceptHref, sourceHref } from "./hrefs";

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL;

// The shapes the pages render are the Convex functions' own return types.
type Overview = FunctionReturnType<typeof api.dashboard.overview>;
export type Status = Overview["status"];
export type Me = NonNullable<FunctionReturnType<typeof api.workspaces.me>>;
export type IndexCredits = NonNullable<Me["workspace"]>["indexCredits"];
export type Proposal = Overview["shelf"][number];
/** A question this week's searches found no answer for (Home). */
export type Gap = Overview["questions"]["gaps"][number];
/** A source no concept cites yet (Home). */
export type Waiting = Overview["waiting"][number];
export type History = NonNullable<FunctionReturnType<typeof api.dashboard.concept>["history"]>;
/** A list or search row: a summary, with a snippet from search. */
export type Concept =
  | FunctionReturnType<typeof api.concepts.list>["concepts"][number]
  | FunctionReturnType<typeof api.concepts.search>[number];

export type ApiResult<T> = { data: T | null; error: string | null };

const NOT_CONFIGURED = "The workspace backend is not connected (NEXT_PUBLIC_CONVEX_URL is unset).";

async function call<Q extends FunctionReference<"query">>(
  fn: Q,
  args: FunctionArgs<Q>,
): Promise<ApiResult<FunctionReturnType<Q>>> {
  if (!CONVEX_URL) return { data: null, error: NOT_CONFIGURED };
  try {
    const token = await getToken();
    return { data: await fetchQuery(fn, args, { token }), error: null };
  } catch (exc) {
    return { data: null, error: errorMessage(exc) };
  }
}

/**
 * `call` for a mutation. Every read of a library is one: it counts what it
 * reads against the library's calls (convex/metered.ts), so a page that
 * reads the library makes one such call; the small reads stay queries.
 */
async function mutate<M extends FunctionReference<"mutation">>(
  fn: M,
  args: FunctionArgs<M>,
): Promise<ApiResult<FunctionReturnType<M>>> {
  if (!CONVEX_URL) return { data: null, error: NOT_CONFIGURED };
  try {
    const token = await getToken();
    return { data: await fetchMutation(fn, args, { token }), error: null };
  } catch (exc) {
    return { data: null, error: errorMessage(exc) };
  }
}

/** Home in one counted call: the counts, the review shelf, and this week's activity. */
export const getOverview = () => mutate(api.dashboard.overview, {});

/** Who is signed in, with their library: once a request, though the layout and the page both ask. */
export const getMe = cache(() => call(api.workspaces.me, {}));

/** Whether Libro's review comes to the signed-in member by email. */
export const getReportEmail = () => call(api.report.myReportEmail, {});

/** The signed-in user's libraries, for the switcher and Library settings (once a request). */
export const getLibraries = cache(() => call(api.workspaces.libraries, {}));

/** The agents (OAuth clients) this user approved, for the Connect page. */
export const getAgents = () => call(api.agents.list, {});

/** The team: members, seats, and (for admins) the invite link code. */
export const getTeam = () => call(api.team.overview, {});

/** What one more seat costs the open Team, from its subscription (convex/stripe.ts seatPrice); null when unknown. */
export async function getSeatPrice() {
  if (!CONVEX_URL) return null;
  try {
    return await fetchAction(api.stripe.seatPrice, {}, { token: await getToken() });
  } catch {
    return null;
  }
}

/** What Individual to Team would bill the open library (convex/stripe.ts switchPrice); null when unknown. */
export async function getSwitchPrice() {
  if (!CONVEX_URL) return null;
  try {
    return await fetchAction(api.stripe.switchPrice, {}, { token: await getToken() });
  } catch {
    return null;
  }
}

/** Where an invite leads, for /invite/[code]; data is null when revoked. */
export const getInvite = (code: string) => call(api.team.invite, { code });

/** Make the user a workspace when they have none. Idempotent; false when it failed. */
export async function ensureWorkspace(): Promise<boolean> {
  if (!CONVEX_URL) return false;
  try {
    const token = await getToken();
    await fetchMutation(api.workspaces.ensure, {}, { token });
    return true;
  } catch {
    // The dashboard still renders; queries surface their own errors.
    return false;
  }
}

/** The Library's filters, as its URL carries them. */
export type LibraryFilters = {
  q?: string;
  type?: string;
  tag?: string;
  shelf?: string;
  after?: string;
  /** `oldest`: the list oldest first; none, newest first. */
  sort?: string;
};

/** The Library in one counted call: a page of concepts through its filters, and what each filter offers. */
export const getLibrary = ({ q, after, sort, ...filters }: LibraryFilters, review = false) =>
  mutate(api.dashboard.library, {
    query: q?.trim() || undefined,
    ...filters,
    cursor: after ?? null,
    review,
    order: sort === "oldest" ? "oldest" : "newest",
  });

export type Library = FunctionReturnType<typeof api.dashboard.library>;

/**
 * Who wrote something, one way everywhere: the person and their agent
 * ("maya@acme.test with Claude Code"), or whichever of the two is known.
 */
export function whoWrote(person: string | null, agent: string | null): string {
  if (person && agent) return `${person} with ${agent}`;
  return person ?? agent ?? "Libro";
}

/** The shelf a concept sits on: its address up to the last slash ("billing/"), or "" at the top. */
export const shelfOf = (id: string) => {
  const slash = id.lastIndexOf("/");
  return slash === -1 ? "" : id.slice(0, slash + 1);
};

/**
 * A concept's page in one counted call: the concept, its links both ways,
 * its history, `revision`'s snapshot, and the open proposals about it. A
 * null concept means it doesn't exist.
 */
export const getConceptPage = (id: string, revision?: string) =>
  mutate(api.dashboard.concept, { id, ...(revision ? { revision } : {}) });

/** One kept source: its catalog record, who cites it, and one part of its text. */
export const readSource = (id: string, part?: number) => mutate(api.sources.read, { id, part });

/** What a source is, in a word (convex/sources.ts KINDS). */
const KIND: Record<string, string> = {
  md: "Markdown",
  txt: "Text",
  html: "Web page",
  pdf: "PDF",
  docx: "Word document",
  document: "Document",
  sheet: "Spreadsheet",
  slides: "Slides",
  transcript: "Transcript",
  other: "File",
};

/** What a source is and where it came from: "Web page · handbook.acme.test", "PDF · report.pdf". */
export function originOf(s: {
  kind: string;
  location?: string;
  file?: { name: string; mime: string };
}): string {
  const kind = s.file?.mime.startsWith("image/") ? "Picture" : (KIND[s.kind] ?? "File");
  let from = s.file?.name ?? s.location ?? "";
  try {
    if (s.location && /^https?:\/\//.test(s.location)) from = new URL(s.location).hostname;
  } catch {
    // Not a URL after all: the location as given.
  }
  return from ? `${kind} · ${from}` : kind;
}

/**
 * The remote MCP endpoint: `/mcp` on this site (a Next.js route on Vercel).
 * Derived from the request, so it is right in dev, preview, and production.
 */
export const mcpUrl = async (): Promise<string> => {
  if (process.env.NEXT_PUBLIC_LIBROCAT_MCP_URL) return process.env.NEXT_PUBLIC_LIBROCAT_MCP_URL;
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}/mcp`;
};
