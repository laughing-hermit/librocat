import type { FileKind } from "@librocat/core/sources";
import { track } from "@vercel/analytics";
import type { codingAgents, desktopAgents } from "./site";

/**
 * What Vercel Web Analytics counts on librocat Cloud (the privacy page,
 * "Cookies"): a page view for every page, the dashboard's too, and the
 * product events below. A page view reports the page's route, never what the
 * page shows. A concept, a kept source, or an invite reports its route
 * (`/dashboard/concepts/[...id]`), an address the dashboard doesn't have
 * reports `/dashboard/[unknown]`, and no address keeps its query or fragment
 * (a search, a saved page's title, OAuth parameters, a reset token). So no
 * library's content, no id, and no secret leaves the browser. The rest of
 * product use is measured from Convex (the weekly funnel).
 */

/** The dashboard's pages whose paths name nothing: counted as they are. tests/analytics.test.ts holds this to src/app. */
export const DASHBOARD_PAGES = [
  "/dashboard",
  "/dashboard/account",
  "/dashboard/billing",
  "/dashboard/concepts",
  "/dashboard/connect",
  "/dashboard/library",
  "/dashboard/library/new",
  "/dashboard/sources",
  "/dashboard/team",
];

/** Paths that name something, and the route each reports instead. */
const NAMED: [RegExp, string][] = [
  [/^\/dashboard\/concepts\/./, "/dashboard/concepts/[...id]"],
  [/^\/dashboard\/sources\/./, "/dashboard/sources/[id]"],
  [/^\/invite\/./, "/invite/[code]"],
];

/** The path a page view reports. Pure. */
export function countedPath(pathname: string): string {
  const path = pathname.replace(/(.)\/+$/, "$1");
  for (const [pattern, route] of NAMED) if (pattern.test(path)) return route;
  if (path.startsWith("/dashboard/") && !DASHBOARD_PAGES.includes(path)) {
    return "/dashboard/[unknown]";
  }
  return path;
}

/** The address a page view or an event reports: its counted path, with no query or fragment. Pure. */
export function countedUrl(url: string): string {
  const u = new URL(url);
  u.pathname = countedPath(u.pathname);
  u.search = "";
  u.hash = "";
  return u.toString();
}

export type SizeBucket = "under 1 MB" | "1-10 MB" | "10-100 MB" | "over 100 MB";

/** A file's size as a range, so an event never carries an exact size. Pure. */
export function sizeBucket(bytes: number): SizeBucket {
  if (bytes < 1_000_000) return "under 1 MB";
  if (bytes < 10_000_000) return "1-10 MB";
  if (bytes < 100_000_000) return "10-100 MB";
  return "over 100 MB";
}

/**
 * What a person copied to connect an agent (site.ts): a coding agent's
 * install, every agent at once ("plugin", or MCP + Skills: "mcp" and
 * "skills"), or a desktop agent's. Which agents people bring is what
 * decides where librocat works best first.
 */
export type InstallMethod =
  | "plugin"
  | "mcp"
  | "skills"
  | "self-host"
  | (typeof codingAgents)[number]["method"]
  | (typeof desktopAgents)[number]["method"];

/**
 * The product events, each with at most two properties (Vercel Pro's limit),
 * and only kinds and ranges: never a name, an id, or anything a library holds.
 */
type Events = {
  /** A new account entered its emailed code. */
  signed_up: undefined;
  /** A person approved an agent on the consent screen. */
  agent_approved: undefined;
  library_created: undefined;
  /** One file attached on Sources. */
  file_attached: { kind: FileKind; size: SizeBucket };
  link_saved: undefined;
  /** An install command or an agent's config copied, on the landing page or Connect. */
  install_copied: { method: InstallMethod; where: "landing" | "connect" };
  invite_link_created: undefined;
  checkout_started: { plan: "individual" | "team"; interval: "monthly" | "annual" };
  pay_as_you_go: { on: boolean };
  cap_set: undefined;
  index_exported: undefined;
};

export type EventName = keyof Events;
/** The events that carry no properties. */
export type PlainEvent = { [E in EventName]: Events[E] extends undefined ? E : never }[EventName];

/** Count one product event. Where analytics isn't loaded (self-hosted, local), nothing happens. */
export function count<E extends EventName>(
  event: E,
  ...props: Events[E] extends undefined ? [] : [Events[E]]
) {
  track(event, props[0]);
}

/**
 * Run a server action that redirects when it succeeds, and count `event`
 * then. Next rejects such an action's promise with the redirect (its digest
 * starts with NEXT_REDIRECT) instead of resolving it, so a result coming back
 * means the action failed.
 */
export async function countRedirect<T>(event: PlainEvent, action: () => Promise<T>): Promise<T> {
  try {
    return await action();
  } catch (error) {
    const digest = (error as { digest?: unknown } | null)?.digest;
    if (typeof digest === "string" && digest.startsWith("NEXT_REDIRECT")) count(event);
    throw error;
  }
}
