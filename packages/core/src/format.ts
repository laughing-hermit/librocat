/**
 * The pure half of the core: OKF text, concept ids, links, snippets,
 * statuses, and the library-science algorithms that touch no storage.
 *
 * No `node:*` import here. The Convex runtime imports this module as
 * `@librocat/core/format`, so the hosted library, its export, and its
 * import share one implementation.
 */

import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { shelfPrefix, THESAURUS_ID } from "./library.ts";

export { stem, stemQuery, stemText } from "./stem.ts";

// ---- OKF text ----------------------------------------------------------------

// Files that OKF reserves for directory listings and update logs. They are not
// concepts and the index skips them.
export const RESERVED_NAMES = new Set(["index.md", "log.md"]);

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;
// Markdown inline links: [text](target). Reference and footnote links are
// ignored on purpose; only inline links point at other concepts in practice.
const LINK_RE = /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

// ---- No secrets --------------------------------------------------------------

// Credential formats that must never be stored in a library. A knowledge base
// records where a secret lives ("STRIPE_SECRET_KEY, in Doppler at
// prod/stripe"), never the secret: a library is read by agents, exported,
// committed to Git, and shared with a team.
const SECRET_PATTERNS: [string, RegExp][] = [
  ["a private key", /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/],
  // AWS's documentation key (AKIAIOSFODNN7EXAMPLE) is a placeholder, not a credential.
  ["an AWS access key", /\b(?:AKIA|ASIA)(?![0-9A-Z]*EXAMPLE\b)[0-9A-Z]{16}\b/],
  ["a GitHub token", /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36}\b|\bgithub_pat_[A-Za-z0-9_]{60,}/],
  ["a Stripe secret key", /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}/],
  ["a Stripe webhook secret", /\bwhsec_[A-Za-z0-9+/=]{24,}/],
  ["an Anthropic API key", /\bsk-ant-[A-Za-z0-9_-]{20,}/],
  ["an OpenAI API key", /\bsk-(?:proj-)?[A-Za-z0-9_-]{40,}/],
  ["a Slack token", /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ["a Google API key", /\bAIza[0-9A-Za-z_-]{35}\b/],
  ["an npm token", /\bnpm_[A-Za-z0-9]{36}\b/],
];

/** The kind of credential found in `text` ("a GitHub token"), or null. */
export function findSecret(text: string): string | null {
  for (const [label, re] of SECRET_PATTERNS) if (re.test(text)) return label;
  return null;
}

/** Refuse a write that carries a credential, saying what to store instead. */
export function assertNoSecrets(...texts: (string | null | undefined)[]): void {
  for (const text of texts) {
    const label = text ? findSecret(text) : null;
    if (label) {
      throw new Error(
        `this looks like ${label}: librocat never stores secrets. Record where it lives ` +
          'instead, for example "STRIPE_SECRET_KEY, in Doppler at prod/stripe".',
      );
    }
  }
}

/** Thrown when a file is not a valid OKF concept. */
export class OKFError extends Error {}

/** One OKF concept, parsed from a Markdown file. */
export interface Concept {
  id: string;
  type: string;
  body: string;
  frontmatter: Record<string, unknown>;
  path?: string;
  links: string[];
}

// Recommended fields, read out of frontmatter for convenient indexing.
export function titleOf(c: Concept): string | null {
  const t = c.frontmatter.title;
  return t == null ? null : String(t);
}

export function descriptionOf(c: Concept): string | null {
  const d = c.frontmatter.description;
  return d == null ? null : String(d);
}

export function resourceOf(c: Concept): string | null {
  const r = c.frontmatter.resource;
  return r == null ? null : String(r);
}

export function tagsOf(c: Concept): string[] {
  const raw = c.frontmatter.tags;
  if (raw == null) return [];
  return Array.isArray(raw) ? raw.map(String) : [String(raw)];
}

export function statusOf(c: Concept): string {
  const s = c.frontmatter.status;
  return s ? String(s) : "stable";
}

/** The OKF lifecycle statuses. A concept with none is `stable`. */
export const STATUSES = ["draft", "stable", "deprecated"] as const;
export type Status = (typeof STATUSES)[number];

/** Return `status` if it is a valid lifecycle status; throw otherwise. */
export function checkStatus(status: string): Status {
  if ((STATUSES as readonly string[]).includes(status)) return status as Status;
  throw new OKFError(`invalid status '${status}': expected one of ${STATUSES.join(", ")}`);
}

/** Parse OKF text into a Concept. Throws OKFError if invalid. */
export function parse(text: string, opts: { conceptId: string; path?: string }): Concept {
  const { conceptId, path: filePath } = opts;
  const match = FRONTMATTER_RE.exec(text.replace(/^\uFEFF/, ""));
  if (!match) throw new OKFError(`${conceptId}: missing YAML frontmatter block`);
  let fm: unknown;
  try {
    fm = parseYaml(match[1] as string) ?? {};
  } catch (exc) {
    throw new OKFError(`${conceptId}: invalid YAML frontmatter: ${exc}`);
  }
  if (typeof fm !== "object" || fm === null || Array.isArray(fm)) {
    throw new OKFError(`${conceptId}: frontmatter must be a mapping`);
  }
  const frontmatter = fm as Record<string, unknown>;
  const ctype = frontmatter.type;
  if (ctype == null || String(ctype).trim() === "") {
    throw new OKFError(`${conceptId}: frontmatter is missing a non-empty 'type'`);
  }
  const body = match[2] as string;
  return {
    id: conceptId,
    type: String(ctype),
    body,
    frontmatter,
    path: filePath,
    links: extractLinks(body, conceptId),
  };
}

/** Serialize a Concept back to OKF text (frontmatter + body). */
export function dump(concept: Concept): string {
  const fm: Record<string, unknown> = { ...concept.frontmatter };
  if (!("type" in fm)) fm.type = concept.type;
  const yamlText = stringifyYaml(fm).trimEnd();
  // One newline after the closing `---`, which parse() consumes exactly, so
  // dump(parse(x)) is body-stable (no drifting blank line on re-save).
  return `---\n${yamlText}\n---\n${concept.body}`;
}

/** The frontmatter keys every write rebuilds; any other key survives a write. */
export const STANDARD_KEYS = new Set(["type", "title", "description", "tags", "status"]);

/**
 * The frontmatter of a concept after a write: the standard keys rebuilt from
 * `args`, the unknown keys of `existing` kept, `extra` keys set (a null value
 * deletes the key). `stable` is the default status and is not written.
 */
export function buildFrontmatter(
  existing: Record<string, unknown> | null | undefined,
  args: {
    type: string;
    title?: string | null;
    description?: string | null;
    tags?: string[] | null;
    status?: string | null;
    extra?: Record<string, unknown>;
  },
): Record<string, unknown> {
  const kept = Object.fromEntries(
    Object.entries(existing ?? {}).filter(([k]) => !STANDARD_KEYS.has(k)),
  );
  const fm: Record<string, unknown> = { ...kept, type: args.type };
  if (args.title) fm.title = args.title;
  if (args.description) fm.description = args.description;
  if (args.tags && args.tags.length > 0) fm.tags = [...args.tags];
  const status = args.status ? checkStatus(args.status) : "stable";
  if (status !== "stable") fm.status = status;
  for (const [k, v] of Object.entries(args.extra ?? {})) {
    if (v === undefined || v === null) delete fm[k];
    else fm[k] = v;
  }
  keepCatalogedHonest(fm, existing, args);
  return fm;
}

/**
 * `cataloged` records which catalog fields the hosted cataloger filled in,
 * and how: "transcribed" (a sentence copied from the concept) or "selected"
 * (tags from the library's vocabulary; older records may say "generated"),
 * in the spirit of Cutter's rule to bracket what the cataloger supplied. A writer who changes one of those
 * fields owns it from then on, so its entry goes.
 */
export function keepCatalogedHonest(
  fm: Record<string, unknown>,
  existing: Record<string, unknown> | null | undefined,
  args: { description?: string | null; tags?: string[] | null },
): void {
  const c = fm.cataloged;
  if (typeof c !== "object" || c === null || Array.isArray(c)) return;
  const next = { ...(c as Record<string, unknown>) };
  if ((args.description ?? "") !== ((existing?.description as string | undefined) ?? "")) {
    delete next.description;
  }
  const before = Array.isArray(existing?.tags) ? (existing.tags as unknown[]).map(String) : [];
  const after = args.tags ?? [];
  if (before.length !== after.length || before.some((t, i) => t !== after[i])) delete next.tags;
  if (next.description === undefined && next.tags === undefined) delete fm.cataloged;
  else fm.cataloged = next;
}

// ---- ids ------------------------------------------------------------------------

/** The last path segment of a concept id. */
export function lastSegment(id: string): string {
  return id.slice(id.lastIndexOf("/") + 1);
}

/** True when the id's file name is one OKF reserves (`index.md`, `log.md`). */
export function isReservedId(id: string): boolean {
  return RESERVED_NAMES.has(`${lastSegment(id)}.md`);
}

/**
 * Collapse `.`/`..` segments in a relative posix path lexically. Lenient: a
 * `..` above the root is dropped. For link targets, never for ids.
 */
export function normalizeSegments(p: string): string {
  const parts: string[] = [];
  for (const part of p.split("/")) {
    if (part === "." || part === "") continue;
    if (part === "..") {
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  return parts.join("/");
}

/**
 * The canonical form of a concept id that arrived from a tool: `a/../b` is
 * `b`, a leading `/` is bundle-relative. An id that escapes the bundle or is
 * empty raises OKFError, so untrusted ids cannot reach outside it.
 */
export function canonicalId(id: string): string {
  const parts: string[] = [];
  for (const part of id.split("/")) {
    if (part === "." || part === "") continue;
    if (part === "..") {
      if (parts.length === 0) throw new OKFError(`concept id escapes the bundle: ${id}`);
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  if (parts.length === 0) throw new OKFError("concept id must not be empty");
  return parts.join("/");
}

export function slugify(text: string): string {
  const s = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s || "concept";
}

type Maybe<T> = T | Promise<T>;

/**
 * The id a new concept gets: the explicit id (canonical; `thesaurus` and the
 * reserved names are refused), or a slug of the title (else the body, else
 * the type) bumped with `-2`, `-3`, ... while `exists` says it is taken. A
 * reserved auto id is bumped too, so a concept can never land on a file the
 * loader skips.
 */
export async function deriveConceptId(
  opts: { id?: string | null; title?: string | null; body?: string | null; type: string },
  exists: (id: string) => Maybe<boolean>,
): Promise<string> {
  const body = opts.body ?? "";
  let cid = canonicalId(opts.id ?? slugify(opts.title ?? (body ? body.slice(0, 40) : opts.type)));
  if (opts.id) {
    if (cid === THESAURUS_ID) {
      throw new Error("'thesaurus' is the tag vocabulary; edit it with the `set_term` tool");
    }
    if (isReservedId(cid)) {
      throw new Error(
        `concept id '${cid}' maps to the OKF-reserved filename '${lastSegment(cid)}.md'`,
      );
    }
    return cid;
  }
  if (isReservedId(cid) || cid === THESAURUS_ID || (await exists(cid))) {
    let n = 2;
    while (await exists(`${cid}-${n}`)) n += 1;
    cid = `${cid}-${n}`;
  }
  return cid;
}

// ---- links ----------------------------------------------------------------------

/** Resolve one inline link target to a concept id, or null when it is not a concept link. */
function linkTarget(target: string, srcDir: string): string | null {
  const t = (target.split("#", 1)[0] as string).trim();
  if (!t || t.includes("://") || t.startsWith("mailto:") || !t.endsWith(".md")) return null;
  const raw = t.startsWith("/") ? t.replace(/^\/+/, "") : srcDir ? `${srcDir}/${t}` : t;
  return normalizeSegments(raw).replace(/\.md$/, "") || null;
}

/**
 * The concept id one link in `sourceId`'s body points to, or null when it is
 * not a concept link: the rule `extractLinks` follows, for a page that shows
 * the body.
 */
export function conceptLink(target: string, sourceId: string): string | null {
  const slash = sourceId.lastIndexOf("/");
  return linkTarget(target, slash === -1 ? "" : sourceId.slice(0, slash));
}

/**
 * Return the concept ids that `body` links to, in order, de-duplicated.
 *
 * A link target counts as a concept link when it resolves to a `.md` file.
 * A leading `/` means bundle-relative; otherwise the target resolves relative
 * to the source concept's directory. External URLs and anchors are ignored.
 */
export function extractLinks(body: string, sourceId: string): string[] {
  const slash = sourceId.lastIndexOf("/");
  const srcDir = slash === -1 ? "" : sourceId.slice(0, slash);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of body.matchAll(LINK_RE)) {
    const cid = linkTarget(m[1] as string, srcDir);
    if (cid && !seen.has(cid)) {
      seen.add(cid);
      out.push(cid);
    }
  }
  return out;
}

/**
 * Rewrite inline links whose resolved concept id is a key of `map` to a
 * bundle-absolute `/newId.md` target. Anchors are preserved. Returns the new
 * body and the number of links changed. Used by a move (`update` with
 * `new_id`; authority control: a move must never orphan an inbound link).
 */
export function retargetLinks(
  body: string,
  sourceId: string,
  map: Map<string, string>,
): { body: string; changed: number } {
  const slash = sourceId.lastIndexOf("/");
  const srcDir = slash === -1 ? "" : sourceId.slice(0, slash);
  let changed = 0;
  const out = body.replace(LINK_RE, (full, target: string) => {
    const cid = linkTarget(target, srcDir);
    const next = cid ? map.get(cid) : undefined;
    if (!next) return full;
    changed += 1;
    const hashAt = target.indexOf("#");
    const anchor = hashAt === -1 ? "" : target.slice(hashAt);
    return full.replace(target, `/${next}.md${anchor}`);
  });
  return { body: out, changed };
}

// ---- shapes both tiers return -----------------------------------------------------

/** Concept metadata, the shape `search` and `list` return. */
export interface ConceptSummary {
  id: string;
  type: string;
  title: string | null;
  description: string | null;
  resource: string | null;
  tags: string[];
  status: string;
  /** "See" reference: the concept that replaced this one (deprecated concepts). */
  superseded_by: string | null;
  /** OKF `stale_after`: when this concept is due to be checked again. */
  stale_after: string | null;
  /** True once `stale_after` has passed: read it with care, and check it still holds. */
  stale: boolean;
  /** A file path, when the concept came from a file; null in a hosted library. */
  path: string | null;
}

export interface ConceptRecord extends ConceptSummary {
  frontmatter: Record<string, unknown>;
  body: string;
}

export interface SearchHit extends ConceptSummary {
  snippet: string;
  /** A ranking score, when the backend reports one. */
  score?: number;
}

export interface Neighbor {
  id: string;
  title: string | null;
  exists: boolean;
}

export interface SearchFilters {
  type?: string | null;
  tag?: string | null;
  /**
   * The tag filter as the engine applies it: the preferred tag and its
   * narrower terms (`tagFacet` in library.ts). A row matches when it carries
   * any of them. Set by the engines from `tag`; callers pass `tag`.
   */
  tags?: string[] | null;
  status?: string | null;
  /**
   * A shelf: the leading directory of the concept id ("acme" or "acme/").
   * One library, many shelves: a project scopes its reads to its own shelf
   * and falls back to the whole library when the shelf is empty.
   */
  shelf?: string | null;
  /**
   * Author entry (Cutter's object D): only concepts this writer wrote. An
   * agent's name, a person (a member's email, or a Git author's
   * name or email), or "me". The engines resolve it to `ids`.
   */
  author?: string | null;
  /** The author filter as the engine applies it: the ids that writer wrote. */
  ids?: ReadonlySet<string> | null;
  limit?: number;
}

export interface GraphNode {
  id: string;
  title: string | null;
  exists: boolean;
}

export interface GraphEdge {
  src: string;
  dst: string;
}

export interface WeedReport {
  days: number;
  /** Totals before `limit` truncates the lists. */
  counts: {
    deprecated: number;
    broken_links: number;
    orphans: number;
    no_description: number;
    no_tags: number;
    stale: number;
    never_retrieved: number | null;
  };
  deprecated: string[];
  broken_links: { id: string; missing: string[] }[];
  orphans: string[];
  no_description: string[];
  no_tags: string[];
  /** Live concepts past their OKF `stale_after` instant: check they still hold. */
  stale: string[];
  /** Circulation: concepts never retrieved, or not in `days` days. Null where not tracked. */
  never_retrieved: string[] | null;
  /** Top concepts by retrievals. Null where not tracked. */
  most_retrieved: { id: string; retrievals: number }[] | null;
  note?: string;
}

// ---- algorithms both tiers run ------------------------------------------------------

/** The fields `matchesFilters` reads: a concept summary or a Convex row. */
export interface FilterRow {
  id: string;
  type: string;
  status: string;
  tags: string[];
}

/** The `list` and `search` filter predicate (type, status, tag, shelf). */
export function matchesFilters(row: FilterRow, f: SearchFilters): boolean {
  if (f.type && row.type !== f.type) return false;
  if (f.status && row.status !== f.status) return false;
  if (f.tags?.length) {
    const any = f.tags;
    if (!row.tags.some((t) => any.includes(t))) return false;
  } else if (f.tag && !row.tags.includes(f.tag)) return false;
  if (f.shelf) {
    const p = shelfPrefix(f.shelf);
    if (p && !row.id.startsWith(p)) return false;
  }
  if (f.ids && !f.ids.has(row.id)) return false;
  return true;
}

/**
 * A short body excerpt around the first query match, with matched words in
 * `[brackets]` and ` … ` at truncated edges. One snippet format in both tiers.
 */
export function makeSnippet(text: string, query: string, width = 12): string {
  const tokens = query
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 0);
  const words = text.split(/\s+/).filter((w) => w.length > 0);
  const isMatch = (word: string): boolean => {
    const lower = word.toLowerCase();
    return tokens.some((t) => lower.includes(t));
  };
  let at = words.findIndex(isMatch);
  if (at === -1) at = 0;
  const start = Math.max(0, at - Math.floor(width / 2));
  const end = Math.min(words.length, start + width);
  const window = words.slice(start, end).map((w) => (isMatch(w) ? `[${w}]` : w));
  const head = start > 0 ? " … " : "";
  const tail = end < words.length ? " … " : "";
  return `${head}${window.join(" ")}${tail}`.trim();
}

/** Stable partition: non-deprecated hits first, deprecated after, order kept. */
export function demoteDeprecated<T extends { status: string }>(hits: T[]): T[] {
  return [
    ...hits.filter((h) => h.status !== "deprecated"),
    ...hits.filter((h) => h.status === "deprecated"),
  ];
}

/** The fields the weeding rules read. */
export interface WeedRow {
  id: string;
  status: string;
  links: string[];
  description: string | null;
  tags: string[];
  /** OKF `stale_after` (frontmatter): the concept is stale from this instant on. */
  stale_after?: unknown;
}

/** True when an OKF `stale_after` instant has passed (unparseable values never are). */
export function isStale(staleAfter: unknown, now = Date.now()): boolean {
  if (staleAfter === undefined || staleAfter === null || staleAfter === "") return false;
  const t =
    staleAfter instanceof Date ? staleAfter.getTime() : new Date(String(staleAfter)).getTime();
  return Number.isFinite(t) && now >= t;
}

// ---- review dates and verification (OKF lifecycle and trust families) --------

/** Days to the next review when someone confirms a concept still holds: one library review cycle. */
export const REVIEW_DAYS = 90;

/** An OKF `stale_after` as frontmatter holds it: the string, or a date YAML parsed. */
export function staleAfterOf(fm: Record<string, unknown> | null | undefined): string | null {
  const v = fm?.stale_after;
  if (v === undefined || v === null || v === "") return null;
  return v instanceof Date ? v.toISOString() : String(v);
}

/**
 * Check a `stale_after` from a writer: an ISO date (2026-12-31) or datetime,
 * kept as written. "" means clear it (null).
 */
export function checkStaleAfter(value: string): string | null {
  const s = value.trim();
  if (s === "") return null;
  if (!/^\d{4}-\d{2}-\d{2}/.test(s) || !Number.isFinite(Date.parse(s))) {
    throw new Error(
      `stale_after must be an ISO date or datetime such as 2026-12-31 (got "${value}")`,
    );
  }
  return s;
}

/** The ISO date `days` after `now`. */
export function reviewDate(now = Date.now(), days = REVIEW_DAYS): string {
  return new Date(now + days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Record that `by` checked the concept still holds: an OKF `verified` event
 * (trust family, §5.2; the last ten are kept). A review date that has
 * already passed moves `REVIEW_DAYS` ahead, unless the writer set one.
 */
export function markVerified(
  fm: Record<string, unknown>,
  by: string,
  opts: { staleAfterGiven?: boolean; now?: number } = {},
): void {
  const now = opts.now ?? Date.now();
  const prev = fm.verified;
  const list = Array.isArray(prev) ? prev : prev && typeof prev === "object" ? [prev] : [];
  fm.verified = [...list, { by, at: new Date(now).toISOString() }].slice(-10);
  if (!opts.staleAfterGiven && isStale(fm.stale_after, now)) fm.stale_after = reviewDate(now);
}

/**
 * The mechanical CREW/MUSTIE rules: deprecated, broken links, orphans (no
 * inbound link), no description, no tags. The thesaurus is skipped, ids are
 * sorted, counts are taken before `limit` cuts each list. Circulation (never
 * retrieved, most retrieved) is librocat.com's alone and added by the caller.
 */
export function weedRules(rows: WeedRow[], limit = 50, now = Date.now()) {
  const ids = new Set(rows.map((r) => r.id));
  const inbound = new Set<string>();
  for (const r of rows) for (const l of r.links) inbound.add(l);
  const deprecated: string[] = [];
  const broken: { id: string; missing: string[] }[] = [];
  const orphans: string[] = [];
  const noDesc: string[] = [];
  const noTags: string[] = [];
  const stale: string[] = [];
  for (const r of [...rows].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    if (r.id === THESAURUS_ID) continue;
    if (r.status === "deprecated") deprecated.push(r.id);
    // MUSTIE's "misleading": a live concept past its own OKF stale_after.
    else if (isStale(r.stale_after, now)) stale.push(r.id);
    const missing = r.links.filter((l) => !ids.has(l));
    if (missing.length) broken.push({ id: r.id, missing });
    if (!inbound.has(r.id)) orphans.push(r.id);
    if (!r.description?.trim()) noDesc.push(r.id);
    if (r.tags.length === 0) noTags.push(r.id);
  }
  return {
    counts: {
      deprecated: deprecated.length,
      broken_links: broken.length,
      orphans: orphans.length,
      no_description: noDesc.length,
      no_tags: noTags.length,
      stale: stale.length,
    },
    deprecated: deprecated.slice(0, limit),
    broken_links: broken.slice(0, limit),
    orphans: orphans.slice(0, limit),
    no_description: noDesc.slice(0, limit),
    no_tags: noTags.slice(0, limit),
    stale: stale.slice(0, limit),
  };
}

/** The fields `libraryStats` reads. */
export interface StatsRow {
  id: string;
  type: string;
  tags: string[];
  links: string[];
}

/**
 * The `status` counts: concepts, the live type and tag vocabulary (top 100
 * each, so agents reuse existing types and tags instead of guessing), links,
 * and broken links.
 */
export function libraryStats(rows: StatsRow[]) {
  const ids = new Set(rows.map((r) => r.id));
  const byType = new Map<string, number>();
  const byTag = new Map<string, number>();
  let links = 0;
  let broken = 0;
  for (const r of rows) {
    byType.set(r.type, (byType.get(r.type) ?? 0) + 1);
    for (const t of r.tags) byTag.set(t, (byTag.get(t) ?? 0) + 1);
    links += r.links.length;
    for (const dst of r.links) if (!ids.has(dst)) broken += 1;
  }
  const desc = (m: Map<string, number>) =>
    Object.fromEntries([...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 100));
  return {
    concepts: rows.length,
    by_type: desc(byType),
    by_tag: desc(byTag),
    links,
    broken_links: broken,
  };
}

/**
 * Breadth-first subgraph around `root`, out to `depth` hops and at most
 * `maxNodes` nodes. Edges to nodes that were not admitted are dropped, so
 * every edge endpoint resolves to a node in the result.
 */
export async function bfsGraph(
  root: string,
  opts: { depth?: number; maxNodes?: number },
  neighborsOf: (id: string) => Maybe<{ outbound: { id: string }[]; inbound: { id: string }[] }>,
  nodeFor: (id: string) => Maybe<GraphNode>,
): Promise<{ root: string; nodes: GraphNode[]; edges: GraphEdge[] }> {
  const depth = opts.depth ?? 1;
  const maxNodes = opts.maxNodes ?? 50;
  const seen = new Set([root]);
  let frontier = [root];
  const nodes = new Map<string, GraphNode>();
  const edges = new Map<string, GraphEdge>();
  for (let hop = 0; hop < Math.max(depth, 1); hop++) {
    const next: string[] = [];
    for (const nid of frontier) {
      nodes.set(nid, await nodeFor(nid));
      const nb = await neighborsOf(nid);
      for (const o of nb.outbound) {
        edges.set(`${nid}→${o.id}`, { src: nid, dst: o.id });
        if (!seen.has(o.id) && seen.size < maxNodes) {
          seen.add(o.id);
          next.push(o.id);
        }
      }
      for (const i of nb.inbound) {
        edges.set(`${i.id}→${nid}`, { src: i.id, dst: nid });
        if (!seen.has(i.id) && seen.size < maxNodes) {
          seen.add(i.id);
          next.push(i.id);
        }
      }
    }
    frontier = next;
    if (frontier.length === 0) break;
  }
  for (const nid of seen) if (!nodes.has(nid)) nodes.set(nid, await nodeFor(nid));
  const kept = [...edges.values()].filter((e) => nodes.has(e.src) && nodes.has(e.dst));
  return { root, nodes: [...nodes.values()], edges: kept };
}

// ---- code links: concepts that describe code go stale when it changes -----------

/**
 * OKF `sources` (§5.1): the materials a concept derives from. librocat uses
 * them to link a concept to the code it describes: `resource` is a path in
 * the repository (`src/auth/login.ts`; a directory ends in `/`) or a URL (a
 * GitHub or GitLab blob or tree link). `last_modified` is when that source
 * last changed, as `files_changed` heard it.
 */
export interface Source {
  resource: string;
  last_modified?: string;
  [key: string]: unknown;
}

const sourceResource = (s: unknown): string | null => {
  const r = typeof s === "string" ? s : (s as { resource?: unknown } | null)?.resource;
  return typeof r === "string" && r.trim() ? r.trim() : null;
};

/** What a concept names as its code: its OKF `resource` and each `sources[].resource`. */
export function sourcesOf(fm: Record<string, unknown> | null | undefined): string[] {
  const out: string[] = [];
  const resource = sourceResource(fm?.resource);
  if (resource) out.push(resource);
  const list = Array.isArray(fm?.sources) ? fm.sources : [];
  for (const s of list) {
    const r = sourceResource(s);
    if (r && !out.includes(r)) out.push(r);
  }
  return out;
}

/**
 * A new `sources` list for these resources, keeping what an existing entry
 * for the same resource already says (its `last_modified`, an `id`). Null
 * when there are none, so the key goes.
 */
export function withSources(prev: unknown, resources: string[]): Source[] | null {
  const old = new Map<string, Source>();
  for (const s of Array.isArray(prev) ? prev : []) {
    const r = sourceResource(s);
    if (r) old.set(r, typeof s === "object" && s !== null ? (s as Source) : { resource: r });
  }
  const seen = new Set<string>();
  const out: Source[] = [];
  for (const raw of resources) {
    const r = raw.trim();
    if (!r || seen.has(r)) continue;
    seen.add(r);
    out.push(old.get(r) ?? { resource: r });
  }
  return out.length > 0 ? out : null;
}

const repoRelative = (p: string) => p.trim().replace(/^\.\//, "").replace(/^\/+/, "");

/** A source as a repository path: plain paths as given, and the path in a blob or tree URL. */
function sourcePath(resource: string): { path: string; dir: boolean } | null {
  const r = resource.trim();
  if (/^[a-z][a-z0-9+.-]*:/i.test(r)) {
    const m = /\/(?:-\/)?(blob|tree)\/[^/]+\/([^?#]+)/.exec(r);
    if (!m) return null;
    const p = decodeURIComponent(m[2] as string);
    return { path: repoRelative(p), dir: m[1] === "tree" || p.endsWith("/") };
  }
  return { path: repoRelative(r), dir: r.endsWith("/") };
}

/** Does a concept's source cover a file that changed (a path from the repository root)? */
export function coversPath(resource: string, changed: string): boolean {
  const s = sourcePath(resource);
  if (!s?.path) return false;
  const c = repoRelative(changed);
  if (s.dir) return c.startsWith(`${s.path.replace(/\/+$/, "")}/`);
  return c === s.path;
}

/**
 * The `path` facet a source files its concept under in a catalog index, so
 * `files_changed` finds it by lookup: its repository path, a directory ending in
 * `/`. Null for a source that isn't code (a web page). Pure.
 */
export function pathFacetOf(resource: string): string | null {
  const s = sourcePath(resource);
  if (!s?.path) return null;
  return s.dir ? `${s.path.replace(/\/+$/, "")}/` : s.path;
}

/**
 * The `path` facets a changed file falls under (`coversPath`'s cases): the
 * file itself, and each directory above it. Pure.
 */
export function pathsAbove(changed: string): string[] {
  const c = repoRelative(changed);
  if (!c) return [];
  const parts = c.replace(/\/+$/, "").split("/");
  const out = new Set([c]);
  for (let i = 1; i < parts.length; i++) out.add(`${parts.slice(0, i).join("/")}/`);
  return [...out];
}

/**
 * Mark a concept whose code changed: its review date becomes now (unless it
 * is already past), and each matching source records when it changed.
 * Mutates `fm`; returns the sources that matched (none: `fm` is untouched).
 */
export function markChanged(
  fm: Record<string, unknown>,
  paths: string[],
  now = Date.now(),
): string[] {
  return markSources(fm, (r) => paths.some((p) => coversPath(r, p)), now);
}

/**
 * Mark a concept whose sources changed, for any test of a source: code a
 * commit touched (`markChanged`), or a kept source copy whose text changed.
 */
export function markSources(
  fm: Record<string, unknown>,
  matches: (resource: string) => boolean,
  now = Date.now(),
): string[] {
  const hit = sourcesOf(fm).filter(matches);
  if (hit.length === 0) return [];
  const at = new Date(now).toISOString();
  if (Array.isArray(fm.sources)) {
    fm.sources = fm.sources.map((s) => {
      const r = sourceResource(s);
      if (!r || !hit.includes(r)) return s;
      return { ...(typeof s === "object" && s !== null ? s : { resource: r }), last_modified: at };
    });
  }
  if (!isStale(fm.stale_after, now)) fm.stale_after = at;
  return hit;
}
