/**
 * Library-science helpers (pure functions, no I/O), which the Convex
 * backend imports:
 * the tag thesaurus (a controlled vocabulary in the shape of ANSI/NISO
 * Z39.19: broader, narrower, related, and use-for relations plus a scope
 * note per term), query expansion over it, Cutter's rule of specific entry,
 * and finding aids (the shelf list an `index.md` holds). The thesaurus is
 * stored as one OKF concept with id `thesaurus` (type
 * `Thesaurus`, `terms` in the frontmatter), so it exports, imports, and
 * versions like any other concept.
 */

import { stemText } from "./stem.ts";

export const THESAURUS_ID = "thesaurus";
export const THESAURUS_TYPE = "Thesaurus";

/** A concept's two types: a Decision (what was chosen and why), else a Note. */
export const CONCEPT_TYPES = ["Note", "Decision"] as const;

/**
 * The type a concept is filed under: "Decision" for a decision, the
 * thesaurus's own type for it, and "Note" for anything else an agent sends
 * (a Runbook, a Reference, a Concept), so the list stays two types.
 */
export function normalType(type: string | undefined): string {
  const t = (type ?? "").trim().toLowerCase();
  if (t === "decision" || t === "adr") return "Decision";
  if (t === THESAURUS_TYPE.toLowerCase()) return THESAURUS_TYPE;
  return "Note";
}

/** The catalog record of the thesaurus concept. */
export const THESAURUS_CONCEPT = {
  type: THESAURUS_TYPE,
  title: "Tag thesaurus",
  description:
    "The controlled vocabulary of this library: preferred tags with broader, narrower, related, and use-for relations, and scope notes.",
  body:
    "Edit with the `set_term` tool. Writes map use-for synonyms onto the preferred tag; " +
    "`search` expands a preferred tag with its narrower terms, and a tag filter includes them.\n",
} as const;

/** The longest scope note kept: a sentence or two, not an essay. */
export const MAX_SCOPE_NOTE = 500;

/** One preferred tag: its relations and scope note (ANSI/NISO Z39.19, SKOS-shaped). */
export interface Term {
  /** Broader terms (BT): the classes this tag falls under. */
  broader?: string[];
  /** Narrower terms (NT): more specific tags under this one. */
  narrower?: string[];
  /** Related terms (RT): "see also", associated but neither broader nor narrower. */
  related?: string[];
  /** Non-preferred synonyms that map onto this tag ("use for", UF). */
  use_for?: string[];
  /** Scope note (SN): what the tag covers, and what belongs elsewhere. */
  scope_note?: string;
}

export type Thesaurus = Record<string, Term>;

const clean = (xs: unknown): string[] =>
  Array.isArray(xs)
    ? [...new Set(xs.map((x) => String(x).trim().toLowerCase()).filter((x) => x.length > 0))]
    : [];

const note = (x: unknown): string =>
  typeof x === "string" ? x.trim().replace(/\s+/g, " ").slice(0, MAX_SCOPE_NOTE) : "";

/** Read the thesaurus out of the concept's frontmatter (lenient: unknown shapes are ignored). */
export function thesaurusFrom(frontmatter: Record<string, unknown> | null | undefined): Thesaurus {
  const raw = frontmatter?.terms;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
  const out: Thesaurus = {};
  for (const [tag, rel] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof rel !== "object" || rel === null) continue;
    const r = rel as Record<string, unknown>;
    const term: Term = {};
    const key = tag.trim().toLowerCase();
    const b = clean(r.broader);
    const n = clean(r.narrower);
    const rt = clean(r.related).filter((x) => x !== key);
    const u = clean(r.use_for);
    const sn = note(r.scope_note);
    if (b.length) term.broader = b;
    if (n.length) term.narrower = n;
    if (rt.length) term.related = rt;
    if (u.length) term.use_for = u;
    if (sn) term.scope_note = sn;
    out[key] = term;
  }
  return out;
}

/**
 * Return a copy of `th` with `tag` set (or removed when `term` is null). An
 * omitted relation or scope note keeps its current value; `[]` or `""`
 * clears it. Authority control: a term is either preferred or a synonym of
 * exactly one preferred term, never both.
 */
export function withTerm(th: Thesaurus, tag: string, term: Term | null): Thesaurus {
  const key = tag.trim().toLowerCase();
  if (!key) throw new Error("tag must not be empty");
  const next: Thesaurus = { ...th };
  if (term === null) {
    delete next[key];
    return next;
  }
  const prev = th[key] ?? {};
  const t: Term = {};
  const b = clean(term.broader ?? prev.broader);
  const n = clean(term.narrower ?? prev.narrower);
  const rt = clean(term.related ?? prev.related).filter((x) => x !== key);
  const u = clean(term.use_for ?? prev.use_for).filter((x) => x !== key);
  const sn = term.scope_note !== undefined ? note(term.scope_note) : (prev.scope_note ?? "");
  for (const [other, rel] of Object.entries(th)) {
    if (other === key) continue;
    if ((rel.use_for ?? []).includes(key)) {
      throw new Error(`'${key}' is a use_for synonym of '${other}'; remove it there first`);
    }
    const clash = u.find((x) => x === other || (rel.use_for ?? []).includes(x));
    if (clash) throw new Error(`'${clash}' is already a preferred tag or a use_for of '${other}'`);
  }
  if (b.length) t.broader = b;
  if (n.length) t.narrower = n;
  if (rt.length) t.related = rt;
  if (u.length) t.use_for = u;
  if (sn) t.scope_note = sn;
  next[key] = t;
  return next;
}

/** The terms directly below `tag`: its own narrower terms, and every term that names it as broader. */
function childrenOf(tag: string, th: Thesaurus): string[] {
  const out = new Set(th[tag]?.narrower ?? []);
  for (const [other, rel] of Object.entries(th))
    if ((rel.broader ?? []).includes(tag)) out.add(other);
  out.delete(tag);
  return [...out];
}

/** The terms directly above `tag`: its own broader terms, and every term that names it as narrower. */
function parentsOf(tag: string, th: Thesaurus): string[] {
  const out = new Set(th[tag]?.broader ?? []);
  for (const [other, rel] of Object.entries(th))
    if ((rel.narrower ?? []).includes(tag)) out.add(other);
  out.delete(tag);
  return [...out];
}

/** Walk one direction of the hierarchy from `tag`, cycle-safe and depth-capped; `tag` excluded. */
function walk(tag: string, th: Thesaurus, next: (t: string, th: Thesaurus) => string[]): string[] {
  const seen = new Set([tag]);
  let frontier = [tag];
  for (let depth = 0; depth < 8 && frontier.length > 0; depth++) {
    const step: string[] = [];
    for (const t of frontier) {
      for (const c of next(t, th)) {
        if (seen.has(c)) continue;
        seen.add(c);
        step.push(c);
      }
    }
    frontier = step;
  }
  seen.delete(tag);
  return [...seen];
}

/**
 * A tag filter, the way a syndetic catalog answers it: the preferred form of
 * `tag` (a synonym lands on its preferred tag) and every narrower term below
 * it, so asking for «auth» also finds what is filed under «oauth» (Cutter's
 * references from a subject to the subjects under it).
 */
export function tagFacet(tag: string, th: Thesaurus): string[] {
  const preferred = normalizeTags([tag], th)[0];
  if (!preferred) return [];
  return [preferred, ...walk(preferred.toLowerCase(), th, childrenOf)];
}

/**
 * Cutter's rule of specific entry (Rules for a Dictionary Catalogue, §93):
 * file a concept under its most specific subject, not also under the class
 * that includes it. Drops every tag that is a broader term (at any depth) of
 * another tag in the list; order is kept.
 */
export function specificEntry(tags: string[], th: Thesaurus): string[] {
  const keys = tags.map((t) => t.toLowerCase());
  const implied = new Set<string>();
  for (const k of keys) for (const a of walk(k, th, parentsOf)) implied.add(a);
  return tags.filter((_, i) => !implied.has(keys[i] as string));
}

/** Map non-preferred synonyms onto their preferred tag; drop duplicates, keep order. */
export function normalizeTags(tags: string[], th: Thesaurus): string[] {
  const preferred = new Map<string, string>();
  for (const [tag, term] of Object.entries(th))
    for (const u of term.use_for ?? []) preferred.set(u, tag);
  const out: string[] = [];
  for (const raw of tags) {
    const t = raw.trim();
    if (!t) continue;
    const key = t.toLowerCase();
    // A preferred tag in any case lands on its thesaurus spelling; a synonym
    // lands on its preferred tag; anything else passes through as written.
    const mapped = Object.hasOwn(th, key) ? key : (preferred.get(key) ?? t);
    if (!out.includes(mapped)) out.push(mapped);
  }
  return out;
}

/**
 * Expand a query with the thesaurus: a synonym adds its preferred tag, a
 * preferred tag adds its narrower terms (one level). Returns the original
 * query when nothing applies, so ranking is unchanged for ordinary queries.
 */
export function expandQuery(query: string, th: Thesaurus): string {
  if (Object.keys(th).length === 0) return query;
  const tokens = query.split(/\s+/).filter((t) => t.length > 0);
  const extra: string[] = [];
  const add = (w: string) => {
    if (!tokens.some((t) => t.toLowerCase() === w) && !extra.includes(w)) extra.push(w);
  };
  for (const raw of tokens) {
    const t = raw.toLowerCase();
    const term = th[t];
    if (term) for (const n of term.narrower ?? []) add(n);
    for (const [tag, rel] of Object.entries(th)) if ((rel.use_for ?? []).includes(t)) add(tag);
  }
  // Prepend: Convex prefix-matches only the last term, so the reader's last
  // (possibly partial) word must stay last.
  return extra.length ? `${extra.join(" ")} ${query}` : query;
}

/** Words too common to tell two concepts apart, dropped from a neighbor query. */
const COMMON_WORDS = new Set(
  "the and for with how what when why who that this from are our its into you your not but can use".split(
    " ",
  ),
);

/**
 * The query that asks the word index for a concept's neighbors: the stemmed
 * words of its title, then of its description, each through the thesaurus
 * (so "k8s" also asks for "kubernetes"), once each, short and common words
 * left out, and at most 16 (Convex's limit per query). The title's words
 * come first because they name the subject; a long description would push
 * them out otherwise. Empty when nothing is left to ask.
 */
export function neighborQuery(text: { title?: string; description?: string }, th: Thesaurus) {
  const words = new Set<string>();
  for (const part of [text.title ?? "", text.description ?? ""]) {
    // Punctuation off first, so "k8s," still finds its thesaurus entry.
    const plain = part.replace(/[,.;:!?()[\]"`]+/g, " ");
    for (const w of expandQuery(plain, th)
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)) {
      if (w.length > 2 && !COMMON_WORDS.has(w)) words.add(stemText(w));
    }
  }
  return [...words].slice(0, 16).join(" ");
}

/** One catalog line for a finding aid. */
export interface AidEntry {
  id: string;
  title: string | null;
  description: string | null;
  type: string;
  status: string;
  /** When the concept was added to the library (ms), for the list of additions. */
  added?: number | null;
}

/** Days the root finding aid's list of additions covers. */
export const ADDITIONS_DAYS = 7;
const MAX_ADDITIONS = 25;

/**
 * Finding aids: one Markdown listing per directory of the bundle (the shelf
 * list OKF's reserved `index.md` is for). Root entries land in the "" aid.
 * With `additions`, the root aid opens with a list of additions (Dana, ch.
 * XXV, "print lists of additions"): what arrived since `since`, newest
 * first, so readers and agents see what is new before anything else.
 */
export function renderFindingAids(
  entries: AidEntry[],
  opts: { additions?: { since: number } } = {},
): { dir: string; markdown: string }[] {
  const byDir = new Map<string, AidEntry[]>();
  const dirs = new Set<string>([""]);
  for (const e of entries) {
    if (e.id === THESAURUS_ID) continue;
    const slash = e.id.lastIndexOf("/");
    const dir = slash === -1 ? "" : e.id.slice(0, slash);
    const list = byDir.get(dir) ?? [];
    list.push(e);
    byDir.set(dir, list);
    // Every ancestor gets an aid too, so each directory is reachable from the root.
    const parts = dir.split("/").filter((p) => p.length > 0);
    for (let i = 1; i <= parts.length; i++) dirs.add(parts.slice(0, i).join("/"));
  }
  if (entries.filter((e) => e.id !== THESAURUS_ID).length === 0) return [];
  const all = [...dirs].sort();
  const parentOf = (d: string) => (d.includes("/") ? d.slice(0, d.lastIndexOf("/")) : "");
  return all.map((dir) => {
    const items = (byDir.get(dir) ?? []).sort((a, b) => (a.id < b.id ? -1 : 1));
    const subdirs = all.filter((d) => d !== "" && parentOf(d) === dir);
    const lines = [
      `# ${dir || "Collection"}`,
      "",
      `${items.length} concept${items.length === 1 ? "" : "s"} here` +
        (subdirs.length
          ? `, ${subdirs.length} shelf${subdirs.length === 1 ? "" : "s"} below.`
          : "."),
      "",
    ];
    const since = opts.additions?.since;
    const added =
      dir === "" && since !== undefined
        ? entries
            .filter((e) => e.id !== THESAURUS_ID && (e.added ?? 0) >= since)
            .sort((a, b) => (b.added ?? 0) - (a.added ?? 0) || (a.id < b.id ? -1 : 1))
        : [];
    if (added.length > 0) {
      lines.push(`## New in the last ${ADDITIONS_DAYS} days`, "");
      for (const e of added.slice(0, MAX_ADDITIONS)) {
        const day = new Date(e.added as number).toISOString().slice(0, 10);
        lines.push(`${aidLine(e)} _(added ${day})_`);
      }
      if (added.length > MAX_ADDITIONS) lines.push(`- …and ${added.length - MAX_ADDITIONS} more`);
      lines.push("", "## Everything here", "");
    }
    for (const sub of subdirs)
      lines.push(`- [${sub.slice(dir ? dir.length + 1 : 0)}/](/${sub}/index.md)`);
    if (subdirs.length) lines.push("");
    for (const e of items) lines.push(aidLine(e));
    return { dir, markdown: `${lines.join("\n")}\n` };
  });
}

/** One concept as a finding aid lists it: title, type, status, and its one line. */
function aidLine(e: AidEntry): string {
  const name = e.title?.trim() || e.id.slice(e.id.lastIndexOf("/") + 1);
  const flag = e.status === "stable" ? "" : ` _(${e.status})_`;
  const desc = e.description?.trim() ? ` — ${e.description.trim()}` : "";
  return `- [${name}](/${e.id}.md) \`${e.type}\`${flag}${desc}`;
}

/**
 * A shelf is the leading directory of a concept id: one library, many
 * shelves, and a project scopes its reads to its own shelf ("acme" or
 * "acme/") and falls back to the whole library when the shelf is empty.
 * "acme", "acme/", "/acme/" all mean the shelf "acme/".
 */
export function shelfPrefix(shelf: string): string {
  const s = shelf.replace(/^\/+/, "").replace(/\/+$/, "");
  return s ? `${s}/` : "";
}

// ---- accessions: an id is never reused (Dana, A Library Primer, ch. XIX) -----

/**
 * A retired accession number: the id of a concept that was deleted, or that
 * a rename moved. Links and agents that remembered the id would otherwise
 * reach whatever takes it next, so a new concept never gets it by default,
 * and reading it says what happened. A library keeps them in a table and
 * exports them as the bundle's `log.md` (OKF §9, the update log).
 */
export interface Tombstone {
  id: string;
  /** The day it happened, YYYY-MM-DD (UTC). */
  at: string;
  /** The title it had, to recognize it by. */
  title?: string;
  /** Set when a rename moved it: where the concept went. */
  moved_to?: string;
}

/** The UTC day of `now`, the date an update log files an entry under. */
export function logDay(now = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10);
}

/** What happened to a retired id, for messages: "deleted on …" or "renamed to … on …". */
export function goneNote(t: Tombstone): string {
  return t.moved_to
    ? `renamed to ${t.moved_to} on ${t.at}`
    : `deleted on ${t.at}${t.title ? ` ("${t.title}")` : ""}`;
}

/** The not-found message for an id, saying what became of it when it is retired. */
export function notFoundMessage(id: string, t?: Tombstone | null): string {
  return `concept not found: ${id}${t ? ` (${goneNote(t)})` : ""}`;
}

/** What a write that takes a retired id says about it. */
export function reusedNote(t: Tombstone): string {
  return (
    `this id was ${goneNote(t)}; links and agents that remembered that concept ` +
    "now reach this one"
  );
}

const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

/** One `log.md` line for a retired id. */
export function logEntry(t: Tombstone): string {
  if (t.moved_to) return `* **Rename**: \`${t.id}\` → \`${t.moved_to}\``;
  const title = t.title ? oneLine(t.title) : "";
  return `* **Deletion**: \`${t.id}\`${title ? ` — ${title}` : ""}`;
}

const LOG_TITLE = "# Update log";
const DAY = /^##\s+(\d{4}-\d{2}-\d{2})\s*$/;
const DELETION = /^[*-]\s+\*\*Deletion\*\*:\s+`([^`]+)`(?:\s+—\s+(.*?))?\s*$/;
const RENAME = /^[*-]\s+\*\*Rename\*\*:\s+`([^`]+)`\s+→\s+`([^`]+)`/;

/**
 * The retired ids in an update log (OKF §9: date headings, newest first).
 * An id's newest entry wins. Other entries, and prose, are left alone.
 */
export function parseLog(text: string): Map<string, Tombstone> {
  const out = new Map<string, Tombstone>();
  let day = "";
  for (const line of text.split(/\r?\n/)) {
    const d = DAY.exec(line);
    if (d) {
      day = d[1] as string;
      continue;
    }
    if (!day) continue;
    const del = DELETION.exec(line);
    const ren = del ? null : RENAME.exec(line);
    const id = (del ?? ren)?.[1];
    if (!id || out.has(id)) continue;
    if (del) out.set(id, { id, at: day, ...(del[2] ? { title: del[2] } : {}) });
    else if (ren) out.set(id, { id, at: day, moved_to: ren[2] as string });
  }
  return out;
}

/**
 * Add one entry to an update log (null: none yet), newest first: under its
 * day's heading when that is the newest day, else under a new heading above
 * the rest. Whatever else the log holds stays as it is.
 */
export function addToLog(text: string | null, t: Tombstone): string {
  const entry = logEntry(t);
  if (!text?.trim()) return `${LOG_TITLE}\n\n## ${t.at}\n\n${entry}\n`;
  const lines = text.replace(/\n*$/, "").split("\n");
  const first = lines.findIndex((l) => DAY.test(l));
  if (first === -1) return `${lines.join("\n")}\n\n## ${t.at}\n\n${entry}\n`;
  if (DAY.exec(lines[first] as string)?.[1] === t.at) {
    // Right under the heading (and its blank line, if any): newest first.
    const at = lines[first + 1]?.trim() === "" ? first + 2 : first + 1;
    lines.splice(at, 0, entry);
  } else {
    lines.splice(first, 0, `## ${t.at}`, "", entry, "");
  }
  return `${lines.join("\n")}\n`;
}

/** A whole update log from retired ids (hosted export): newest day first. */
export function renderLog(tombstones: Tombstone[]): string {
  const sorted = [...tombstones].sort((a, b) =>
    a.at === b.at ? (a.id < b.id ? -1 : 1) : a.at < b.at ? 1 : -1,
  );
  const lines = [LOG_TITLE];
  let day = "";
  for (const t of sorted) {
    if (t.at !== day) {
      day = t.at;
      lines.push("", `## ${day}`, "");
    }
    lines.push(logEntry(t));
  }
  return `${lines.join("\n")}\n`;
}
