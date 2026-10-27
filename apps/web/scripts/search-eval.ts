/**
 * Search evaluation: how often word search (model.ts search: stemmed, through
 * the thesaurus, the catalog record weighed twice) puts the right concept
 * first, and how long a search takes as agents get it.
 *
 * The library (search-eval.json) is librocat's own public docs split into 137
 * concepts: a fixed snapshot from before launch, kept as it was so scores
 * compare across runs. Its dated details (librocat.dev, a CLI, embeddings)
 * are on purpose; the eval measures search, not the docs. The questions are of three kinds, each with the concepts that
 * answer it:
 * - keyword: it shares its words with the answer;
 * - paraphrase: it asks for the answer in other words;
 * - none: the library has no answer.
 *
 * Each question is ranked two ways:
 * - word search alone (dev.ts searchEvalLexical), for the ranking;
 * - `search` as agents get it (mcp.ts searchWords: the ranking, the
 *   ready-reference file, and the kept sources), timed end to end.
 *
 * For the answerable questions it reports how often an answer comes first,
 * how often it's in the top 3, and the mean reciprocal rank. For "none" it
 * reports how often search finds nothing. It runs against a dev deployment
 * with LIBROCAT_E2E=1, and calls no model:
 *
 *   cd apps/web && CONVEX_URL=https://<dev>.convex.cloud node scripts/search-eval.ts
 *
 * With SAVE=<file>, it also writes every ranking.
 */

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";

type Concept = {
  id: string;
  type: string;
  title: string;
  description: string;
  tags: string[];
  body: string;
};
type Question = { kind: "keyword" | "paraphrase" | "none"; q: string; want: string[] };

const url = process.env.CONVEX_URL;
if (!url) throw new Error("set CONVEX_URL to the dev deployment's URL");
const { concepts, questions } = JSON.parse(
  readFileSync(new URL("./search-eval.json", import.meta.url), "utf8"),
) as { concepts: Concept[]; questions: Question[] };

// biome-ignore lint/suspicious/noExplicitAny: JSON from the CLI
function run(fn: string, args: Record<string, unknown>): any {
  const r = spawnSync("node_modules/.bin/convex", ["run", fn, JSON.stringify(args)], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r.status !== 0) throw new Error(`${fn}: ${r.stderr.slice(-500)}`);
  return JSON.parse(r.stdout);
}

// ---- the library ------------------------------------------------------------

const { token, workspaceId } = run("dev:issueTestAccessToken", {
  email: "search-eval@example.com",
});
const client = new ConvexHttpClient(url);
client.setAuth(token);
const have = new Set<string>(
  (run("dev:searchEvalDocs", { workspaceId }) as { id: string }[]).map((d) => d.id),
);
for (const c of concepts) {
  if (have.has(c.id)) continue;
  await client.mutation(api.mcp.ingest, {
    type: c.type,
    id: c.id,
    title: c.title,
    description: c.description,
    tags: c.tags,
    body: c.body,
  });
}
console.log(`library: ${concepts.length} concepts; questions: ${questions.length}\n`);

// ---- scoring ----------------------------------------------------------------

const unanswerable = questions.filter((q) => q.kind === "none").length;
const rankOf = (ids: string[], want: string[]) => {
  const i = ids.findIndex((id) => want.includes(id));
  return i < 0 ? Number.POSITIVE_INFINITY : i + 1;
};

/** First, top 3, and mean reciprocal rank (top 10) for the questions of one kind. */
function score(rankings: string[][], kind?: Question["kind"]) {
  const rows = questions
    .map((q, i) => ({ q, ids: rankings[i] ?? [] }))
    .filter(({ q }) => q.kind !== "none" && (!kind || q.kind === kind));
  const ranks = rows.map(({ q, ids }) => rankOf(ids.slice(0, 10), q.want));
  const pct = (n: number) => `${Math.round((100 * n) / rows.length)}%`;
  return {
    first: pct(ranks.filter((r) => r === 1).length),
    top3: pct(ranks.filter((r) => r <= 3).length),
    mrr: (ranks.reduce((s, r) => s + (Number.isFinite(r) ? 1 / r : 0), 0) / rows.length).toFixed(2),
  };
}

const pctl = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] ?? 0;
};

const table: string[] = [
  "| Ranking | Keyword: first / top 3 / MRR | Paraphrase: first / top 3 / MRR | All: MRR | None: finds nothing | Query p50 / p90 / max |",
  "| --- | --- | --- | --- | --- | --- |",
];
const row = (name: string, rankings: string[][], time: string) => {
  const k = score(rankings, "keyword");
  const p = score(rankings, "paraphrase");
  const nothing = questions.filter((q, i) => q.kind === "none" && rankings[i]?.length === 0);
  table.push(
    `| ${name} | ${k.first} / ${k.top3} / ${k.mrr} | ${p.first} / ${p.top3} / ${p.mrr} | ${score(rankings).mrr} | ${nothing.length}/${unanswerable} | ${time} |`,
  );
};

// ---- word search alone ----------------------------------------------------------

const lexical: string[][] = run("dev:searchEvalLexical", {
  workspaceId,
  queries: questions.map((q) => q.q),
});
row("word search alone", lexical, "—");

// ---- search, as agents get it (mcp.ts searchWords) --------------------------------

const hosted: string[][] = [];
const hostedMs: number[] = [];
for (const q of questions) {
  const started = Date.now();
  const hits = await client.mutation(api.mcp.searchWords, { query: q.q, limit: 10 });
  hostedMs.push(Date.now() - started);
  // Concepts only: a kept source's hit names its part, and this library keeps none.
  hosted.push(hits.filter((h) => !("part" in h)).map((h) => h.id));
}
row(
  "search, as agents get it",
  hosted,
  `${pctl(hostedMs, 50)} / ${pctl(hostedMs, 90)} / ${Math.max(...hostedMs)} ms, whole search`,
);

console.log(table.join("\n"));
if (process.env.SAVE)
  writeFileSync(process.env.SAVE, JSON.stringify({ questions, lexical, hosted }));
