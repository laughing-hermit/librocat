/**
 * Where each model call goes. librocat's server uses one model, and writes
 * nothing itself: the writing (descriptions, tags, merges) is the person's own
 * agent's, which does it better. librocat does what an agent can't do well
 * on its own:
 * - `eval`: typed judgments from a System One model (jev.ts): Jev, TypeSafe's,
 *   or an open-source one on a server that speaks TypeSafe's API. Cataloging
 *   picks from the concept's own words, and Libro's screens.
 * Search is by words (model.ts search) and calls no model.
 *
 * librocat.com runs one pipeline, and its users don't choose models: every
 * call goes through the Vercel AI Gateway with AI_GATEWAY_API_KEY
 * (LIBROCAT_AI_GATEWAY_URL moves the base URL; the e2e fake gateway uses it),
 * Jev through its `/v1/evaluate`. A Free library's calls use
 * AI_GATEWAY_API_KEY_FREE when it is set: a key with its own budget in the
 * gateway, so free traffic has a hard ceiling and can never spend what paid
 * plans need.
 *
 * A self-hosted librocat (LIBROCAT_SELF_HOST=1) brings its own System One,
 * online, offline, or none, as LIBROCAT_JEV chooses (`systemOne`): Jev
 * through the gateway or from TypeSafe's own API (TYPESAFE_API_KEY); an
 * open-source server that speaks TypeSafe's API at LIBROCAT_JEV_URL (Von on a
 * CPU, Kev or OpenJev on a GPU), local or not; or none. An LLM doesn't stand
 * in for it: in librocat's own test questions, qwen2.5:3b in Jev's place was
 * right about half the time. `probe:judge` scores the one in use. With no
 * model, nothing is called, and the features it serves wait: librocat works
 * with no model. With a local one, nothing leaves the server.
 */

/** librocat's one model job: typed judgments from a System One (jev.ts). */
export type Job = "eval";

/** Where one job's calls go. `gateway`: the Vercel AI Gateway, which takes its own request options. */
export interface AiTarget {
  base: string;
  key: string;
  model: string;
  gateway: boolean;
  /** The eval job's API (jev.ts): the gateway's `/v1/evaluate`, or TypeSafe's `/v1/systemone`. */
  api?: "evaluate" | "systemone";
  /** A System One server of the operator's own (LIBROCAT_JEV_URL), not TypeSafe's. */
  local?: boolean;
}

export const DEFAULT_GATEWAY = "https://ai-gateway.vercel.sh/v1";
/** librocat.com's model. */
export const DEFAULT_MODELS = { eval: "typesafe-ai/jev" } as const;
/** TypeSafe's own API, for Jev without the gateway (a self-hosted librocat with TYPESAFE_API_KEY). */
export const TYPESAFE_API = "https://api.typesafe.ai/v1";
export const TYPESAFE_MODEL = "jev-latest";

export const selfHosted = (): boolean => process.env.LIBROCAT_SELF_HOST === "1";

const trim = (url: string) => url.replace(/\/$/, "");
export const gatewayBase = (): string =>
  trim(process.env.LIBROCAT_AI_GATEWAY_URL ?? DEFAULT_GATEWAY);

/**
 * Where `job` goes, or null when this deployment has no model for it. `plan`
 * is the library's, for the key its calls are billed to on librocat.com.
 */
export function resolve(_job: Job, plan?: string): AiTarget | null {
  return selfHosted() ? systemOne() : viaGateway(plan);
}

/** Jev through the gateway: librocat's, unless LIBROCAT_EVAL_MODEL names another model. */
function viaGateway(plan?: string): AiTarget | null {
  const env = process.env;
  const key = (plan === "free" && env.AI_GATEWAY_API_KEY_FREE) || env.AI_GATEWAY_API_KEY;
  if (!key) return null;
  const model = env.LIBROCAT_EVAL_MODEL || DEFAULT_MODELS.eval;
  return { base: gatewayBase(), key, model, gateway: true, api: "evaluate" };
}

/**
 * Which System One a self-hosted librocat asks: LIBROCAT_JEV, or, unset, the
 * one it has settings for (a server of its own first, then TypeSafe's key,
 * then the gateway's).
 */
export function jevChoice(): "local" | "gateway" | "typesafe" | "off" {
  const env = process.env;
  const chosen = env.LIBROCAT_JEV?.trim().toLowerCase();
  if (chosen === "local" || chosen === "gateway" || chosen === "typesafe" || chosen === "off") {
    return chosen;
  }
  if (env.LIBROCAT_JEV_URL) return "local";
  if (env.TYPESAFE_API_KEY) return "typesafe";
  if (env.AI_GATEWAY_API_KEY) return "gateway";
  return "off";
}

/** A System One server's model when LIBROCAT_EVAL_MODEL names none: the server picks. */
export const LOCAL_MODEL = "default";

/** Where a self-hosted librocat's eval job goes: as jevChoice says, or nowhere. */
function systemOne(): AiTarget | null {
  const env = process.env;
  const jev = jevChoice();
  if (jev === "local") {
    const url = env.LIBROCAT_JEV_URL;
    if (!url) return null;
    const model = env.LIBROCAT_EVAL_MODEL || LOCAL_MODEL;
    const key = env.LIBROCAT_JEV_KEY ?? "";
    return { base: trim(url), key, model, gateway: false, api: "systemone", local: true };
  }
  if (jev === "typesafe") {
    const key = env.TYPESAFE_API_KEY;
    if (!key) return null;
    const model = env.LIBROCAT_EVAL_MODEL || TYPESAFE_MODEL;
    return { base: TYPESAFE_API, key, model, gateway: false, api: "systemone" };
  }
  return jev === "gateway" ? viaGateway() : null;
}

/** Whether this deployment can make `job`'s calls at all. */
export const hasAi = (job: Job): boolean => resolve(job) !== null;

/**
 * What a job runs on, for whoever runs the server: the model and how it is
 * reached, or why it makes no call. Never a key or an address.
 */
export type InUse = { model: string; via: "gateway" | "typesafe" | "local" } | { off: string };

export function inUse(job: Job): InUse {
  const t = resolve(job);
  if (!t) return { off: whyOff() };
  return {
    model: t.model,
    via: t.local ? "local" : t.api === "systemone" ? "typesafe" : "gateway",
  };
}

/** The System One, as `inUse` reports it (status, probe.ts). */
export function modelsInUse() {
  return { jev: inUse("eval") };
}

/** Why there is no System One: the setting that is missing. */
function whyOff(): string {
  if (!selfHosted()) return "AI_GATEWAY_API_KEY is not set";
  const jev = jevChoice();
  if (jev === "local") return "LIBROCAT_JEV is local, but LIBROCAT_JEV_URL is not set";
  if (jev === "typesafe") return "LIBROCAT_JEV is typesafe, but TYPESAFE_API_KEY is not set";
  if (jev === "gateway") return "LIBROCAT_JEV is gateway, but AI_GATEWAY_API_KEY is not set";
  if (process.env.LIBROCAT_JEV?.trim().toLowerCase() === "off") return "LIBROCAT_JEV is off";
  return "no System One: set LIBROCAT_JEV_URL, TYPESAFE_API_KEY, or AI_GATEWAY_API_KEY";
}

/** Request headers for a target: a server without a key (a local System One) gets none. */
export function headers(t: AiTarget): Record<string, string> {
  return {
    "Content-Type": "application/json",
    ...(t.key ? { Authorization: `Bearer ${t.key}` } : {}),
  };
}

/**
 * Why a request failed, for the log and the probe: its HTTP status and the
 * error's type or code, never its message, which could quote the input.
 */
export async function httpFailure(res: Response): Promise<string> {
  const body = (await res.json().catch(() => null)) as {
    type?: string;
    error?: { type?: string; code?: string } | string;
  } | null;
  const type =
    body?.type ??
    (typeof body?.error === "object" && body.error
      ? (body.error.type ?? body.error.code)
      : undefined);
  return `HTTP ${res.status}${type ? ` ${type}` : ""}`;
}

/** Why a request threw: a timeout (TimeoutError) or a network failure (TypeError: fetch failed). */
export const thrown = (e: unknown): string =>
  e instanceof Error ? `${e.name}: ${e.message}`.slice(0, 120) : "error";
