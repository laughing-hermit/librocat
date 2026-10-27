/**
 * Jev, TypeSafe's System One model: typed judgments (yes/no probabilities, a
 * choice among named options, a score on a scale) instead of generated text.
 * Many questions about one state cost one request; input tokens only, at a
 * small fraction of an LLM call. librocat's server asks only Jev: it selects
 * and judges, and the writing is the person's own agent's.
 *
 * Jev is reached through the Vercel AI Gateway's `/v1/evaluate`
 * (https://vercel.com/docs/ai-gateway/modalities/evaluation), or, on a
 * self-hosted librocat with TYPESAFE_API_KEY, TypeSafe's own `/v1/systemone`
 * (https://docs.typesafe.ai/api), which calls a yes/no question a "noul". A
 * self-hosted librocat may instead run an open-source System One model on a
 * server that speaks that API (LIBROCAT_JEV_URL: Von, Kev, OpenJev, ...).
 * Without any, its judgments are off: no LLM answers in their place.
 */

import { type AiTarget, headers, httpFailure, resolve, thrown } from "./ai";

export type Question =
  | { type: "boolean"; instructions: string; criteria?: { true: string; false: string } }
  | { type: "choice"; instructions: string; criteria: Record<string, string> }
  | { type: "score"; instructions: string; criteria: string[] };

export type Answer =
  | { type: "boolean"; probability: number }
  | { type: "choice"; choice: string; probabilities: Record<string, number> }
  | { type: "score"; score: number; probabilities: Record<string, number> };

export interface Evaluation {
  answers: Record<string, Answer>;
  /** US dollars, as the gateway reports it (0 when it does not say). */
  cost: number;
}

/** Why a request gave no answers: its HTTP status, a timeout, or a reply with none. */
export type Failed = { failed: string };

/**
 * Ask Jev `questions` about `state`, for a library on `plan` (the key its
 * calls use, ai.ts). Null when there is no model for it or the call fails:
 * every caller treats Jev as optional and falls back.
 */
export async function evaluate(
  state: unknown,
  questions: Record<string, Question>,
  plan?: string,
): Promise<Evaluation | null> {
  if (Object.keys(questions).length === 0) return null;
  const e = await tryEvaluate(state, questions, plan);
  return "answers" in e ? e : null;
}

/** `evaluate`, saying why when there are no answers (probe.ts). */
export async function tryEvaluate(
  state: unknown,
  questions: Record<string, Question>,
  plan?: string,
): Promise<Evaluation | Failed> {
  const target = resolve("eval", plan);
  if (target?.api === "evaluate") return await atGateway(target, state, questions);
  if (target?.api === "systemone") return await atTypeSafe(target, state, questions);
  return { failed: "no Jev" };
}

async function atGateway(
  t: AiTarget,
  state: unknown,
  questions: Record<string, Question>,
): Promise<Evaluation | Failed> {
  try {
    const res = await fetch(`${t.base}/evaluate`, {
      method: "POST",
      headers: headers(t),
      body: JSON.stringify({
        model: t.model,
        state,
        questions,
        // Zero data retention, from TypeSafe itself only (not a reseller
        // route): neither the gateway nor TypeSafe keeps the request past
        // answering, nor trains on it. No extra cost on Vercel Pro. With no
        // such route, the gateway answers 400 and the caller retries later.
        providerOptions: { gateway: { zeroDataRetention: true, only: ["typesafe-ai"] } },
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      console.warn(JSON.stringify({ jev: { status: res.status } }));
      return { failed: await httpFailure(res) };
    }
    const out = (await res.json()) as {
      answers?: Record<string, Answer>;
      providerMetadata?: { gateway?: { cost?: string } };
    };
    if (!out.answers) return { failed: "a reply with no answers" };
    return { answers: out.answers, cost: Number(out.providerMetadata?.gateway?.cost ?? 0) };
  } catch (e) {
    return { failed: thrown(e) };
  }
}

/** Jev's questions as TypeSafe's API takes them: a yes/no question is a "noul". Pure, exported for tests. */
export function typesafeQuestions(questions: Record<string, Question>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(questions).map(([id, q]) => [
      id,
      q.type === "boolean" ? { ...q, type: "noul" } : q,
    ]),
  );
}

/** TypeSafe's answers in the gateway's shape, leaving out any other. Pure, exported for tests. */
/**
 * A `/v1/systemone` reply's answers: TypeSafe's `answers` map, or the same
 * answers grouped by type (`nouls`, `choices`, `scores`), as some servers
 * that speak the API send them.
 */
export function answersOf(reply: Record<string, unknown>): Record<string, unknown> {
  if (reply.answers && typeof reply.answers === "object") {
    return reply.answers as Record<string, unknown>;
  }
  const out: Record<string, unknown> = {};
  for (const [group, type] of [
    ["nouls", "noul"],
    ["choices", "choice"],
    ["scores", "score"],
  ] as const) {
    const g = reply[group];
    if (!g || typeof g !== "object") continue;
    for (const [id, a] of Object.entries(g as Record<string, object>)) out[id] = { type, ...a };
  }
  return out;
}

export function fromTypeSafe(answers: Record<string, unknown>): Record<string, Answer> {
  const out: Record<string, Answer> = {};
  for (const [id, a] of Object.entries(answers)) {
    const r = (a ?? {}) as {
      type?: string;
      noul?: unknown;
      choice?: unknown;
      score?: unknown;
      probabilities?: Record<string, number>;
    };
    const probabilities = r.probabilities ?? {};
    if (r.type === "noul" && typeof r.noul === "number") {
      out[id] = { type: "boolean", probability: r.noul };
    } else if (r.type === "choice" && typeof r.choice === "string") {
      out[id] = { type: "choice", choice: r.choice, probabilities };
    } else if (r.type === "score" && typeof r.score === "number") {
      out[id] = { type: "score", score: r.score, probabilities };
    }
  }
  return out;
}

/**
 * A System One through TypeSafe's API: Jev from TypeSafe, or an open-source
 * model on the operator's own server (a self-hosted librocat's choice, ai.ts),
 * which may be slower on a CPU.
 */
async function atTypeSafe(
  t: AiTarget,
  state: unknown,
  questions: Record<string, Question>,
): Promise<Evaluation | Failed> {
  try {
    const res = await fetch(`${t.base}/systemone`, {
      method: "POST",
      headers: headers(t),
      body: JSON.stringify({ model: t.model, state, questions: typesafeQuestions(questions) }),
      signal: AbortSignal.timeout(t.local ? 120_000 : 20_000),
    });
    if (!res.ok) {
      const via = t.local ? "local" : "typesafe";
      console.warn(JSON.stringify({ jev: { status: res.status, via } }));
      return { failed: await httpFailure(res) };
    }
    const answers = fromTypeSafe(answersOf((await res.json()) as Record<string, unknown>));
    if (Object.keys(answers).length === 0) return { failed: "a reply with no answers" };
    // Self-hosted, there is no billing: TypeSafe bills the key's owner.
    return { answers, cost: 0 };
  } catch (e) {
    return { failed: thrown(e) };
  }
}

/** A boolean answer's probability, or 0 when the answer is missing or not boolean. */
export const yes = (e: Evaluation, id: string): number => {
  const a = e.answers[id];
  return a?.type === "boolean" ? a.probability : 0;
};
