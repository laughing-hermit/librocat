/**
 * Helpers for the browser suite: people on each plan, signed in over HTTP so
 * no password is typed on screen (a typed secret would hide the screen from
 * the model and from screenshots), and the codes the local stack "emails" to
 * its log.
 */

import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import type { Browser } from "@e2e-dev/web";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";

export const site = process.env.LIBROCAT_E2E_SITE_URL ?? "http://localhost:3000";
const cliCwd = process.env.LIBROCAT_E2E_CLI_CWD ?? new URL("..", import.meta.url).pathname;

export type Plan = "free" | "individual" | "team";

/** An internal Convex function, through the CLI against the local deployment. */
export function runDev<T>(fn: string, args: Record<string, unknown>): T {
  const r = spawnSync("node_modules/.bin/convex", ["run", fn, JSON.stringify(args)], {
    cwd: cliCwd,
    env: { ...process.env, CONVEX_AGENT_MODE: "anonymous" },
    encoding: "utf8",
  });
  if (r.status !== 0) throw new Error(`convex run ${fn} failed: ${r.stderr}`);
  return (r.stdout.trim() ? JSON.parse(r.stdout) : null) as T;
}

export interface Person {
  email: string;
  password: string;
  userId: string;
  workspaceId: string;
}

/** A new person whose library is on `plan`. */
export function person(label: string, plan: Plan = "free"): Person {
  const email = `browser-${label}-${Date.now()}@example.com`;
  const password = `fixture-${randomBytes(9).toString("base64url")}`;
  const { userId, workspaceId } = runDev<{ userId: string; workspaceId: string }>(
    "dev:createBrowserUser",
    { email, password, plan },
  );
  return { email, password, userId, workspaceId };
}

/** The session cookies a sign-in sets, for `browser.setCookies`. */
export async function sessionCookies(who: Person) {
  const res = await fetch(`${site}/api/auth/sign-in/email`, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/json", origin: site },
    body: JSON.stringify({ email: who.email, password: who.password }),
  });
  if (!res.ok) throw new Error(`sign-in answered ${res.status}`);
  return res.headers.getSetCookie().map((c) => {
    const [pair = ""] = c.split(";");
    const i = pair.indexOf("=");
    return { name: pair.slice(0, i).trim(), value: pair.slice(i + 1), url: site };
  });
}

/** The last code the stack "emailed" to `email` (AUTH_DEV_LOG_CODES writes it to the Convex log). */
export function emailedCode(email: string): string | null {
  const path = process.env.LIBROCAT_E2E_CONVEX_LOG;
  if (!path) throw new Error("LIBROCAT_E2E_CONVEX_LOG is not set: run the suite with pnpm run e2e");
  const log = readFileSync(path, "utf8");
  const at = log.lastIndexOf(`[dev] email to ${email}:`);
  if (at < 0) return null;
  return /code is (\d+)/.exec(log.slice(at, at + 400))?.[1] ?? null;
}

/** A new person on `plan`, signed in in this browser. */
export async function signIn(
  browser: Browser,
  label: string,
  plan: Plan = "free",
): Promise<Person> {
  const who = person(label, plan);
  await browser.setCookies(await sessionCookies(who));
  return who;
}

export interface Concept {
  type: string;
  id: string;
  title: string;
  description?: string;
  tags?: string[];
  body?: string;
  status?: string;
}

/** Concepts in `who`'s library, written the way an agent writes them (the MCP's ingest). */
export async function seedConcepts(who: Person, concepts: Concept[]) {
  const { token } = runDev<{ token: string }>("dev:issueTestAccessToken", { email: who.email });
  const client = new ConvexHttpClient(
    process.env.LIBROCAT_E2E_CONVEX_URL ?? "http://127.0.0.1:3210",
  );
  client.setAuth(token);
  for (const c of concepts) await client.mutation(api.mcp.ingest, c);
}

/** Text sources in `who`'s library, added in turn the way an agent adds them (the MCP's add_source). */
export async function seedSources(who: Person, titles: string[]) {
  const { token } = runDev<{ token: string }>("dev:issueTestAccessToken", { email: who.email });
  const client = new ConvexHttpClient(
    process.env.LIBROCAT_E2E_CONVEX_URL ?? "http://127.0.0.1:3210",
  );
  client.setAuth(token);
  for (const title of titles) await client.mutation(api.mcp.addSource, { title, text: title });
}

/** A search by `who`'s agent that finds nothing: Needs you lists it as Couldn't find. */
export async function askUnanswered(who: Person, query: string) {
  const { token } = runDev<{ token: string }>("dev:issueTestAccessToken", { email: who.email });
  const client = new ConvexHttpClient(
    process.env.LIBROCAT_E2E_CONVEX_URL ?? "http://127.0.0.1:3210",
  );
  client.setAuth(token);
  await client.mutation(api.mcp.searchWords, { query });
}
