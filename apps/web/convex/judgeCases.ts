/**
 * librocat's own questions, with their right answers: how well a System One
 * model (Jev, or an open-source server that speaks TypeSafe's API, ai.ts)
 * does librocat's jobs, scored at the thresholds the product uses. `probe:judge`
 * runs them (`./models.sh judge` on a self-hosted librocat).
 *
 * The cases are small, fixed, and made up (no library's data): cataloging
 * (which sentence describes a concept, which tags fit), duplicates, which
 * kinds of time-bound claim a concept makes (for its review date), merge
 * drafts that invent, tags that mean the same thing, and whether a watched
 * page's change affects a concept.
 */

import type { Concept, VocabularyTerm } from "./indexation";
import { descriptionCandidates, jevPicks, jevQuestions } from "./indexation";
import type { Evaluation, Question } from "./jev";
import { yes } from "./jev";
import {
  AFFECTED,
  type Change,
  changeAffectsQuestions,
  type DateKind,
  DRAFT_QUESTION,
  datesQuestions,
  KIND_DAYS,
  KIND_SURE,
  SAME,
  SAME_TAG,
  type ScreenPair,
  sameSubjectQuestions,
  sameTagMeaningQuestions,
  statedDate,
  type TagPair,
  type WatchConcept,
} from "./libro";

/** Ask the model; null when it gave no answers. */
export type Ask = (
  state: unknown,
  questions: Record<string, Question>,
) => Promise<Evaluation | null>;

/** One judgment: its family, which case, whether the model got it right, and what it said. */
export type Score = { family: string; case: string; ok: boolean; missing: boolean };

// ---- cataloging -------------------------------------------------------------------

const VOCAB: VocabularyTerm[] = [
  {
    tag: "stripe",
    scope_note: "Stripe: payments, keys, and webhooks",
    filed: ["Stripe webhooks", "Stripe prices"],
  },
  {
    tag: "secrets",
    scope_note: "API keys, tokens, and credentials: where they live and how to rotate them",
    filed: ["Rotating the Resend key"],
  },
  {
    tag: "frontend",
    scope_note: "the Next.js site and the dashboard's UI",
    filed: ["Dashboard layout"],
  },
  { tag: "hiring", filed: ["Interview loop", "Offer letters"] },
  {
    tag: "database",
    scope_note: "Convex and Postgres: schema, indexes, backups",
    filed: ["Postgres backups"],
  },
  {
    tag: "decisions",
    scope_note: "why we chose one option over another",
    filed: ["Why OAuth, not API tokens"],
  },
];

const CATALOG: { name: string; concept: Concept; summary: string; tags: string[] }[] = [
  {
    name: "stripe-rotation",
    concept: {
      type: "Runbook",
      title: "Rotating the Stripe secret key",
      description: null,
      tags: [],
      body:
        "We rotate the Stripe secret key without downtime by adding the new key before revoking the old one. " +
        "Create a new secret key in the Stripe dashboard under Developers. " +
        "Set it as STRIPE_SECRET_KEY on the Convex deployment and deploy. " +
        "Once the deploy is live, roll the old key in Stripe so it stops working.",
    },
    summary:
      "We rotate the Stripe secret key without downtime by adding the new key before revoking the old one.",
    tags: ["stripe", "secrets"],
  },
  {
    name: "why-convex",
    concept: {
      type: "Decision",
      title: "Why we chose Convex",
      description: null,
      tags: [],
      body:
        "The team met on a Tuesday in March. " +
        "We chose Convex over Postgres with an ORM because reactive queries let us drop our cache layer entirely. " +
        "The trade-off is vendor lock-in, which we accepted since Convex can be self-hosted. " +
        "We will revisit the choice if query costs grow faster than usage.",
    },
    summary:
      "We chose Convex over Postgres with an ORM because reactive queries let us drop our cache layer entirely.",
    tags: ["database", "decisions"],
  },
  {
    name: "offer-letters",
    concept: {
      type: "Process",
      title: "Sending an offer letter",
      description: null,
      tags: [],
      body:
        "An offer letter goes out within two days of the final interview. " +
        "The hiring manager drafts it from the template in the shared drive. " +
        "Finance checks the salary band before anyone signs it.",
    },
    summary: "An offer letter goes out within two days of the final interview.",
    tags: ["hiring"],
  },
];

async function catalogCase(ask: Ask, c: (typeof CATALOG)[number]): Promise<Score[]> {
  const candidates = descriptionCandidates(c.concept.body);
  const e = await ask(
    {
      concept: { type: c.concept.type, title: c.concept.title ?? "", body: c.concept.body },
      tags: VOCAB,
    },
    jevQuestions(c.concept, candidates, VOCAB),
  );
  const picks = e ? jevPicks(e, candidates, VOCAB) : {};
  return [
    {
      family: "catalog: description",
      case: c.name,
      ok: (picks.description ?? null) === c.summary,
      missing: !e?.answers.description,
    },
    ...VOCAB.map(({ tag }, i) => ({
      family: "catalog: tags",
      case: `${c.name}:${tag}`,
      ok: (picks.tags ?? []).includes(tag) === c.tags.includes(tag),
      missing: !e?.answers[`tag${i}`],
    })),
  ];
}

// ---- duplicates --------------------------------------------------------------------

/** One side of a pair, as the pair screen sends it (libro.ts screenCandidates). */
const sc = (id: string, title: string, description: string, tags: string[]) => ({
  id,
  title,
  description,
  tags,
  created: 0,
});

const PAIRS: { name: string; same: boolean; pair: ScreenPair }[] = [
  {
    name: "stripe-rotation-twice",
    same: true,
    pair: {
      older: sc(
        "a",
        "Rotating the Stripe secret key",
        "How we replace the Stripe API secret key without downtime.",
        ["stripe"],
      ),
      newer: sc("b", "Stripe key rotation", "Steps to change our Stripe API key.", [
        "stripe",
        "secrets",
      ]),
    },
  },
  {
    name: "deploy-twice",
    same: true,
    pair: {
      older: sc("c", "Deploying to production", "How a release reaches librocat.dev.", ["deploys"]),
      newer: sc("d", "How to ship a release to prod", "Shipping a new version.", ["deploys"]),
    },
  },
  {
    name: "webhooks-vs-rotation",
    same: false,
    pair: {
      older: sc("e", "Stripe webhooks", "How Stripe events reach us.", ["stripe"]),
      newer: sc("b", "Stripe key rotation", "Steps to change our Stripe API key.", [
        "stripe",
        "secrets",
      ]),
    },
  },
  {
    name: "backups-vs-pooling",
    same: false,
    pair: {
      older: sc("f", "Postgres backups", "Nightly backups of the analytics database.", [
        "database",
      ]),
      newer: sc("g", "Postgres connection pooling", "Why we run PgBouncer.", ["database"]),
    },
  },
];

async function sameCase(ask: Ask): Promise<Score[]> {
  const pairs = PAIRS.map((p) => p.pair);
  const e = await ask({ pairs }, sameSubjectQuestions(pairs.length));
  return PAIRS.map((p, i) => ({
    family: "duplicates",
    case: p.name,
    ok: (e ? yes(e, `same${i}`) >= SAME : false) === p.same,
    missing: !e?.answers[`same${i}`],
  }));
}

// ---- review dates -------------------------------------------------------------------

/**
 * Each case's kinds of time-bound claim (libro.ts KIND_DAYS): the ones the
 * model should say yes to, every other kind no. A date written out is read by
 * code, not the model (`stated`), and an explanation or a decision makes none.
 */
const DATES: {
  id: string;
  title: string;
  description: string;
  body: string;
  kinds: DateKind[];
  stated?: string;
}[] = [
  {
    id: "d1",
    title: "Team plan price",
    description: "What Team costs.",
    body: "Team is $15 per seat per month, or $12.50 billed yearly, with a minimum of three seats.",
    kinds: ["price"],
  },
  {
    id: "d2",
    title: "Launch date",
    description: "When librocat launches.",
    body: "The public launch is on October 15, 2026. The blog post goes out that morning.",
    kinds: [],
    stated: "2026-10-15",
  },
  {
    id: "d3",
    title: "How search ranks results",
    description: "Two word indexes, fused.",
    body:
      "Search ranks by the catalog record and by all the text, then fuses the two lists by " +
      "reciprocal rank.",
    kinds: [],
  },
  {
    id: "d4",
    title: "Why OAuth, not API tokens",
    description: "The reasoning behind sign-in for agents.",
    body:
      "We chose OAuth over dashboard API tokens because tokens get pasted into repos, and OAuth lets people " +
      "revoke one agent without touching the others.",
    kinds: [],
  },
  {
    id: "d5",
    title: "Billing owner",
    description: "Who owns the Stripe account.",
    body: "Maria owns the Stripe account and approves every refund over $100.",
    kinds: ["owner"],
  },
  {
    id: "d6",
    title: "Node version",
    description: "What the build runs on.",
    body: "The build runs on Node 22.11 and pnpm 10.4; upgrade both together.",
    kinds: ["version"],
  },
  {
    id: "d7",
    title: "This sprint",
    description: "What the team ships next.",
    body: "This sprint we finish the import flow, and next sprint the billing page is due.",
    kinds: ["schedule"],
  },
];

async function datesCase(ask: Ask): Promise<Score[]> {
  const now = Date.parse("2026-09-29");
  const text = (d: (typeof DATES)[number]) => `${d.title}\n${d.description}\n${d.body}`;
  const out: Score[] = [];
  // As the screen does (libro.ts datesScreen): code reads the dates written
  // out, and the model is asked only about the rest.
  const asked = DATES.filter((d) => {
    const stated = statedDate(text(d), now);
    if (d.stated !== undefined || stated) {
      out.push({
        family: "review dates: by code",
        case: d.id,
        ok: stated === d.stated,
        missing: false,
      });
    }
    return !stated;
  });
  const concepts = asked.map(({ id, title, description, body }) => ({
    id,
    title,
    description,
    body,
  }));
  const e = await ask({ today: "2026-09-29", concepts }, datesQuestions(concepts.length));
  asked.forEach((d, i) => {
    for (const kind of Object.keys(KIND_DAYS) as DateKind[]) {
      out.push({
        family: "review dates: kinds",
        case: `${d.id}:${kind}`,
        ok: (e ? yes(e, `${kind}${i}`) >= KIND_SURE : false) === d.kinds.includes(kind),
        missing: !e?.answers[`${kind}${i}`],
      });
    }
  });
  return out;
}

// ---- merge drafts ------------------------------------------------------------------------

const SOURCES = [
  {
    title: "Rotating the Stripe secret key",
    body: "Create a new secret key in the Stripe dashboard, set it as STRIPE_SECRET_KEY on Convex, deploy, then roll the old key.",
  },
  {
    title: "Stripe key rotation",
    body: "Make a new secret key in Stripe, put it in the Convex environment, redeploy, and then delete the previous key.",
  },
];

const DRAFTS: { name: string; supported: boolean; draft: unknown }[] = [
  {
    name: "faithful",
    supported: true,
    draft: {
      title: "Rotating the Stripe secret key",
      description: "Replace the Stripe secret key without downtime.",
      tags: ["stripe", "secrets"],
      body:
        "Create a new secret key in the Stripe dashboard. Set it as STRIPE_SECRET_KEY on Convex and redeploy. " +
        "Then roll the old key in Stripe.",
    },
  },
  {
    name: "invents",
    supported: false,
    draft: {
      title: "Rotating the Stripe secret key",
      description: "Rotate the Stripe secret key every 90 days.",
      tags: ["stripe", "secrets"],
      body:
        "Every 90 days, as our SOC 2 audit requires, create a new secret key in Stripe. Set it on Convex, redeploy, " +
        "and email the security team.",
    },
  },
];

/** The draft check's bar (libro.ts checkDraft; the shelf flags a draft under it). */
const SUPPORTED = 0.8;

async function draftCase(ask: Ask, d: (typeof DRAFTS)[number]): Promise<Score[]> {
  const e = await ask({ draft: d.draft, sources: SOURCES }, { draft_supported: DRAFT_QUESTION });
  return [
    {
      family: "merge drafts",
      case: d.name,
      ok: (e ? yes(e, "draft_supported") >= SUPPORTED : false) === d.supported,
      missing: !e?.answers.draft_supported,
    },
  ];
}

// ---- synonyms by meaning ------------------------------------------------------------------

const side = (tag: string, uses: number, examples: string[]) => ({ tag, uses, examples });

const TAGS: { name: string; same: boolean; pair: TagPair }[] = [
  {
    name: "k8s-kubernetes",
    same: true,
    pair: {
      a: side("k8s", 3, ["Draining a node", "Cluster upgrades"]),
      b: side("kubernetes", 9, ["Kubernetes autoscaling", "Helm charts we keep"]),
      together: 2,
    },
  },
  {
    name: "ci-continuous-integration",
    same: true,
    pair: {
      a: side("continuous-integration", 2, ["Why the build is slow"]),
      b: side("ci", 7, ["Flaky tests in CI", "Caching the build in CI"]),
      together: 0,
    },
  },
  {
    name: "deploys-rollbacks",
    same: false,
    pair: {
      a: side("rollbacks", 3, ["Rolling back a bad release"]),
      b: side("deploys", 8, ["Deploying to production", "Preview deploys"]),
      together: 3,
    },
  },
  {
    name: "database-backups",
    same: false,
    pair: {
      a: side("database-backups", 2, ["Postgres backups"]),
      b: side("database", 6, ["Postgres connection pooling", "Schema migrations"]),
      together: 2,
    },
  },
];

async function tagsCase(ask: Ask): Promise<Score[]> {
  const pairs = TAGS.map((t) => t.pair);
  const e = await ask({ pairs }, sameTagMeaningQuestions(pairs.length));
  return TAGS.map((t, i) => ({
    family: "synonyms",
    case: t.name,
    ok: (e ? yes(e, `sameTag${i}`) >= SAME_TAG : false) === t.same,
    missing: !e?.answers[`sameTag${i}`],
  }));
}

// ---- source watch: does the change matter -------------------------------------------------

const PAGE = { title: "Pricing", location: "https://example.com/pricing" };
const CHANGE: Change = {
  removed: "Team costs $15 a person a month, billed monthly.",
  added: "Team costs $18 a person a month, billed monthly.",
};
const WATCHED: { concept: WatchConcept; affected: boolean }[] = [
  {
    concept: {
      id: "w1",
      title: "Team plan price",
      description: "What one Team seat costs a month.",
    },
    affected: true,
  },
  {
    concept: {
      id: "w2",
      title: "Quoting a customer",
      description: "Sales quotes the Team price per seat, from the pricing page.",
    },
    affected: true,
  },
  {
    concept: {
      id: "w3",
      title: "Support hours",
      description: "Support answers within one working day.",
    },
    affected: false,
  },
  {
    concept: {
      id: "w4",
      title: "Refund policy",
      description: "Refunds within 30 days, on request.",
    },
    affected: false,
  },
];

async function watchCase(ask: Ask): Promise<Score[]> {
  const concepts = WATCHED.map((w) => w.concept);
  const e = await ask(
    { page: PAGE, change: CHANGE, concepts },
    changeAffectsQuestions(concepts.length),
  );
  return WATCHED.map((w, i) => ({
    family: "source watch",
    case: w.concept.id,
    ok: (e ? yes(e, `affects${i}`) >= AFFECTED : false) === w.affected,
    missing: !e?.answers[`affects${i}`],
  }));
}

/** Every case once, through `ask`: 43 judgments in 9 requests. */
export async function judgeAll(ask: Ask): Promise<Score[]> {
  const scores: Score[] = [];
  for (const c of CATALOG) scores.push(...(await catalogCase(ask, c)));
  scores.push(...(await sameCase(ask)));
  scores.push(...(await datesCase(ask)));
  for (const d of DRAFTS) scores.push(...(await draftCase(ask, d)));
  scores.push(...(await tagsCase(ask)));
  scores.push(...(await watchCase(ask)));
  return scores;
}

/** Right answers per family, and in all. */
export function tally(scores: Score[]) {
  const families: Record<string, { right: number; of: number; unanswered: number }> = {};
  for (const s of scores) {
    const f = families[s.family] ?? { right: 0, of: 0, unanswered: 0 };
    families[s.family] = f;
    f.of += 1;
    if (s.ok) f.right += 1;
    if (s.missing) f.unanswered += 1;
  }
  const right = scores.filter((s) => s.ok).length;
  return {
    right,
    of: scores.length,
    share: Math.round((100 * right) / Math.max(1, scores.length)),
    families,
  };
}
