/**
 * A fake Vercel AI Gateway for the e2e with LIBROCAT_FAKE_GATEWAY=1: the
 * evaluation endpoint (Jev), the one model librocat uses.
 *
 *   node tests/fake-gateway.ts                   # serves http://127.0.0.1:8787/v1
 *   pnpm exec convex env set AI_GATEWAY_API_KEY test
 *   pnpm exec convex env set LIBROCAT_AI_GATEWAY_URL http://127.0.0.1:8787/v1
 *
 * Evaluation is steered by the concept's title: one that mentions "jev" gets
 * Jev's picks (the first candidate sentence, the first two vocabulary tags);
 * any other gets "none of these", so the record stays blank for the agent.
 * Libro's screening pairs are "the same subject" when both titles say
 * "twin"; a merge draft is supported by its sources unless its title says
 * "invented". For Libro's review dates, a concept is time-bound when it names
 * a year, a price, or a version number, and is to be checked in a quarter.
 * Libro's synonym screen: two tags mean the same when both say "twin". The
 * source watch: a change affects a citing concept when the concept's title
 * or description shares a word of four letters or more with what changed.
 * Zero data retention is TypeSafe's own route only, as on the real gateway:
 * an evaluation that demands it while allowing other providers is refused,
 * and `/calls` counts the ones that asked for it (`zdr`). An evaluation
 * whose state says "jev-flaky" fails once
 * with a 503, then answers, as a brief outage would. Any other path, the old
 * `/v1/embeddings` among them, is not found: librocat calls no other model.
 * GET /calls counts the evaluations answered.
 */

import { createServer } from "node:http";

let evaluations = 0;
/** Evaluations that asked for zero data retention, from TypeSafe only. */
let zdr = 0;
/** The "jev-flaky" states that already failed once. */
const flaked = new Set<string>();

const json = (status: number, body: unknown): [number, Record<string, string>, string] => [
  status,
  { "content-type": "application/json" },
  JSON.stringify(body),
];

type Question = { type: "boolean" | "choice" | "score"; criteria?: Record<string, string> };

type Pair = { older: { title: string }; newer: { title: string } };

function evaluateAnswers(
  state: {
    concept?: { title?: string };
    concepts?: { title?: string; description?: string; body?: string }[];
    pairs?: Pair[];
    draft?: { title?: string };
    change?: { removed?: string; added?: string };
  },
  questions: Record<string, Question>,
) {
  const title = (state.concept?.title ?? "").toLowerCase();
  const picks = title.includes("jev");
  const answers: Record<string, unknown> = {};
  for (const [id, q] of Object.entries(questions)) {
    // Libro's review dates: a kind of time-bound claim, by what the text says.
    const kind = /^(price|version|owner|schedule)(\d+)$/.exec(id);
    if (kind) {
      const c = state.concepts?.[Number(kind[2])];
      const text = `${c?.title ?? ""} ${c?.description ?? ""} ${c?.body ?? ""}`;
      const says = {
        price: /\$\d|\bquota\b|\blimit\b/i,
        version: /\bv?\d+\.\d+\b/i,
        owner: /\b(owns|approves|responsible)\b/i,
        schedule: /\b(deadline|sprint|roadmap)\b/i,
      }[kind[1] as "price" | "version" | "owner" | "schedule"];
      answers[id] = { type: "boolean", probability: says.test(text) ? 0.9 : 0.1 };
      continue;
    }
    // Libro's merge drafts: supported by their sources unless "invented".
    if (id === "draft_supported") {
      const invented = (state.draft?.title ?? "").toLowerCase().includes("invented");
      answers[id] = { type: "boolean", probability: invented ? 0.3 : 0.95 };
      continue;
    }
    // Libro's synonym screen: two tags that both say "twin" mean one thing.
    const sameTag = /^sameTag(\d+)$/.exec(id);
    if (sameTag) {
      const pair = (state as { pairs?: { a?: { tag?: string }; b?: { tag?: string } }[] }).pairs?.[
        Number(sameTag[1])
      ];
      const twins = [pair?.a?.tag, pair?.b?.tag].every((t) => (t ?? "").includes("twin"));
      answers[id] = { type: "boolean", probability: twins ? 0.92 : 0.1 };
      continue;
    }
    // The source watch: affected when the concept shares a long word with the change.
    const affects = /^affects(\d+)$/.exec(id);
    if (affects) {
      const c = state.concepts?.[Number(affects[1])];
      const words = (t: string) => new Set(t.toLowerCase().match(/[a-z]{4,}/g) ?? []);
      const changed = words(`${state.change?.removed ?? ""} ${state.change?.added ?? ""}`);
      const touched = [...words(`${c?.title ?? ""} ${c?.description ?? ""}`)].some((w) =>
        changed.has(w),
      );
      answers[id] = { type: "boolean", probability: touched ? 0.8 : 0.1 };
      continue;
    }
    // Libro's screening: two concepts whose titles both say "twin" are one subject.
    const same = /^same(\d+)$/.exec(id);
    if (same) {
      const pair = state.pairs?.[Number(same[1])];
      const twins = [pair?.older.title, pair?.newer.title].every((t) =>
        (t ?? "").toLowerCase().includes("twin"),
      );
      answers[id] = { type: "boolean", probability: twins ? 0.95 : 0.1 };
      continue;
    }
    if (q.type === "choice") {
      const choice = picks ? "c0" : "none";
      const probabilities = Object.fromEntries(
        Object.keys(q.criteria ?? {}).map((k) => [k, k === choice ? 0.9 : 0.1 / 8]),
      );
      answers[id] = { type: "choice", choice, probabilities };
    } else if (q.type === "boolean") {
      const pick = picks && (id === "tag0" || id === "tag1");
      answers[id] = { type: "boolean", probability: pick ? 0.9 : 0.1 };
    }
  }
  return answers;
}

createServer((req, res) => {
  const send = ([status, headers, body]: [number, Record<string, string>, string]) => {
    res.writeHead(status, headers);
    res.end(body);
  };
  if (req.url === "/calls") return send(json(200, { evaluations, zdr }));
  if (req.url !== "/v1/evaluate") return send([404, {}, "not found"]);
  const chunks: Buffer[] = [];
  req.on("data", (c: Buffer) => chunks.push(c));
  req.on("end", () => {
    const body = JSON.parse(Buffer.concat(chunks).toString());
    // /v1/evaluate, Jev. Zero data retention holds on TypeSafe's own route
    // only: demanding it while letting other providers serve is refused.
    const gateway = body.providerOptions?.gateway;
    const typesafeOnly =
      Array.isArray(gateway?.only) &&
      gateway.only.length === 1 &&
      gateway.only[0] === "typesafe-ai";
    if (gateway?.zeroDataRetention && !typesafeOnly) {
      return send(
        json(400, {
          error: `No ZDR (Zero Data Retention) providers available for model: ${body.model}`,
          type: "no_providers_available",
        }),
      );
    }
    const state = JSON.stringify(body.state ?? {});
    if (state.includes("jev-flaky") && !flaked.has(state)) {
      flaked.add(state);
      return send(json(503, { error: "provider unavailable", type: "service_unavailable" }));
    }
    evaluations += 1;
    if (gateway?.zeroDataRetention && typesafeOnly) zdr += 1;
    console.log(`[fake-gateway] evaluation ${evaluations} model=${body.model}`);
    return send(
      json(200, {
        model: body.model,
        answers: evaluateAnswers(body.state ?? {}, body.questions ?? {}),
        usage: { inputTokens: 300, outputTokens: 0 },
        providerMetadata: { gateway: { cost: "0.0000126" } },
      }),
    );
  });
}).listen(8787, "127.0.0.1", () => {
  console.log("fake AI gateway on http://127.0.0.1:8787/v1");
});
