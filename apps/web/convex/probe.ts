/**
 * librocat's model, checked: Jev, or the System One in its place (ai.ts).
 * What it runs on, then one small real call, on fixed text, never a
 * library's: a few hundred tokens.
 *
 *   npx convex run probe:models                   # librocat.com, or a dev deployment
 *   ./models.sh                                   # self-hosted (self-host/)
 *   npx convex run probe:models '{"calls": false}'   # what it runs on, no call
 *   npx convex run probe:judge                    # how well the System One does librocat's jobs
 *   ./models.sh judge                             # the same, self-hosted
 *
 * self-host/deploy.sh prints the last after every deploy.
 */

import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { inUse, modelsInUse } from "./ai";
import type { Concept } from "./indexation";
import { type Question, tryEvaluate, yes } from "./jev";
import { judgeAll, tally } from "./judgeCases";

export const models = internalAction({
  args: { calls: v.optional(v.boolean()) },
  handler: async (_ctx, { calls = true }) => {
    if (!calls) return modelsInUse();
    return { jev: await checkJev() };
  },
});

/** A concept for Jev to read. */
const NOTE: Concept = {
  type: "Reference",
  title: "Staging database",
  description: null,
  tags: [],
  body:
    "The staging database runs Postgres 16 in us-east-1. It is restored from the " +
    "production snapshot every Sunday at 02:00 UTC, so changes made there last a week at most.",
};

/** A claim the note makes (Postgres) and one it doesn't (MySQL): Jev should answer near 1, then near 0. */
const CLAIMS: Record<string, Question> = {
  postgres: {
    type: "boolean",
    instructions: "Does the concept say the staging database runs Postgres?",
  },
  mysql: {
    type: "boolean",
    instructions: "Does the concept say the staging database runs MySQL?",
  },
};

async function timed<T>(call: () => Promise<T>): Promise<[T, number]> {
  const started = Date.now();
  const result = await call();
  return [result, Date.now() - started];
}

/** Jev judges both claims. */
async function checkJev() {
  const role = inUse("eval");
  if ("off" in role) return role;
  const [r, ms] = await timed(() => tryEvaluate({ concept: NOTE }, CLAIMS));
  if ("failed" in r) return { ...role, ms, ...failure(r.failed) };
  const round = (x: number) => Math.round(x * 100) / 100;
  const judged = { postgres: round(yes(r, "postgres")), mysql: round(yes(r, "mysql")) };
  return { ...role, ms, ok: true, judged };
}

/** The usual causes of a failure, and what to check. */
const HINTS: [RegExp, string][] = [
  [/^HTTP 40[13]/, "check the key"],
  [/^HTTP 404/, "check the model's name, and that the URL ends in /v1"],
  [
    /fetch failed|ECONNREFUSED|ENOTFOUND|EAI_AGAIN/,
    "Convex can't reach the URL; in Docker, the systemone profile's is http://systemone:8000/v1",
  ],
  [/TimeoutError/, "no answer in time: a local model may still be loading, so run it again"],
];

function failure(failed: string): { failed: string; hint?: string } {
  const hint = HINTS.find(([cause]) => cause.test(failed))?.[1];
  return { failed, ...(hint ? { hint } : {}) };
}

/**
 * How well this deployment's System One (Jev, or a server that speaks
 * TypeSafe's API) does librocat's jobs: librocat's own labeled questions
 * (judgeCases.ts), scored at the product's thresholds, family by family.
 * Nine requests on made-up text.
 */
export const judge = internalAction({
  args: {},
  handler: async () => {
    const role = inUse("eval");
    if ("off" in role) return role;
    const started = Date.now();
    let failed: string | undefined;
    const scores = await judgeAll(async (state, questions) => {
      const r = await tryEvaluate(state, questions);
      if ("failed" in r) {
        failed ??= r.failed;
        return null;
      }
      return r;
    });
    return {
      ...role,
      ms: Date.now() - started,
      ...tally(scores),
      ...(failed ? failure(failed) : {}),
    };
  },
});
