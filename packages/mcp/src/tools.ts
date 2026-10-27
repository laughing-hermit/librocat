/**
 * The librocat tool surface: the table the MCP endpoint serves
 * (`apps/web/src/app/mcp/route.ts`, over a Convex-backed Backend, with
 * mcp-handler), on librocat.com and on a self-hosted instance alike.
 *
 * Every description is read by the agent on every session, so each says
 * what the agent needs to call the tool well and nothing more; the docs
 * (docs/mcp-tools.md) and the skills carry the rest.
 *
 * Built on the official MCP TypeScript SDK v2. This file imports only the
 * pure core (`@librocat/core/format`), so the web app imports it as
 * `@librocat/server/tools`.
 */

import { STATUSES, type Status } from "@librocat/core/format";
import type { McpServer, ServerContext } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

type Maybe<T> = T | Promise<T>;

export interface ConceptFilters {
  type?: string;
  tag?: string;
  status?: string;
  /** Scope to one shelf: the leading directory of the concept id, e.g. "acme". */
  shelf?: string;
  /** Only concepts this writer wrote: an agent's name, a person, or "me". */
  author?: string;
  limit?: number;
}

export interface ConceptWrite {
  type: string;
  title?: string;
  description?: string;
  body?: string;
  tags?: string[];
  id?: string;
  status?: Status;
  /** OKF `stale_after`: when to check this concept again (ISO date). */
  stale_after?: string;
  /** What the concept describes (OKF `sources`): repository paths or URLs. */
  sources?: string[];
}

export interface ConceptPatch {
  body?: string;
  title?: string;
  description?: string;
  tags?: string[];
  type?: string;
  status?: Status;
  /** Retire this concept in favor of another ("see" reference); implies deprecated. */
  superseded_by?: string;
  /** OKF `stale_after`: when to check this concept again; "" clears it. */
  stale_after?: string;
  /** Record that the writer checked the concept still holds (OKF `verified`). */
  verify?: boolean;
  /** What the concept describes (OKF `sources`), replacing the list; [] clears it. */
  sources?: string[];
  /** Move the concept to this id and rewrite every link to it (authority control). */
  new_id?: string;
}

/** What `get_concept` adds to a concept: its revisions, or one revision in place of it. */
export interface ConceptRead {
  history?: boolean;
  revision?: string;
}

/**
 * A source to keep, for `add_source`: its text (a document, page, or
 * transcript); or a URL `location` alone, which librocat fetches (the reading
 * list, on paid plans); or a file, in two steps: `file` asks for an upload
 * URL, and `storage_id` attaches what was uploaded there.
 */
export interface SourceWrite {
  title?: string;
  text?: string;
  /** Where the original lives: its URL, or a path. */
  location?: string;
  kind?: string;
  /** Replace the kept source with this id, or give a new one this id. */
  id?: string;
  /** A file to upload: its name, type, and size in bytes. The reply has the upload URL. */
  file?: { name: string; type?: string; size: number };
  /** The storageId an upload returned: attach that file. */
  storage_id?: string;
  /** The uploaded file's name, when attaching it. */
  filename?: string;
}

/** A proposal a person's agent files on Libro's review shelf, for `propose`. */
export interface ProposalWrite {
  kind: "merge" | "supersede" | "deprecate" | "synonym";
  subject: string;
  target?: string;
  reason: string;
  /** merge: `target` as it reads after the merge. */
  draft?: { title?: string; description?: string; tags?: string[]; body?: string };
}

export type Decision = "approve" | "dismiss" | "verify";

/** One preferred tag's thesaurus entry, Z39.19-shaped (see @librocat/core library.ts). */
export interface TermPatch {
  broader?: string[];
  narrower?: string[];
  related?: string[];
  use_for?: string[];
  scope_note?: string;
}

/**
 * What a library provides to the tools: the web app implements it over
 * Convex (apps/web/src/lib/mcp-backend.ts). A method returns a
 * JSON-serializable value, or throws an Error whose message becomes the
 * `{"error": ...}` tool result.
 */
export interface Backend {
  search(query: string, filters: ConceptFilters & { sources?: boolean }): Maybe<unknown>;
  /**
   * One concept with its `links` (outbound and inbound), and its revisions
   * with `history`; with `revision`, that revision instead. Null when the
   * concept does not exist.
   */
  getConcept(id: string, opts?: ConceptRead): Maybe<unknown>;
  /** Up to 20 concepts as they are, `{ concepts, missing? }` (a library copied a page at a time). */
  getConcepts(ids: string[]): Maybe<unknown>;
  /** By `cursor` (null for the first page), `{ concepts, cursor }`; else by `offset`, an array. */
  list(filters: ConceptFilters & { offset?: number; cursor?: string | null }): Maybe<unknown>;
  graph(id: string, opts: { depth?: number }): Maybe<unknown>;
  /**
   * Write one concept. A new one's result carries `possible_duplicates`
   * unless `duplicates` is false (the batch form sets it past its first
   * BATCH_DUPLICATE_LOOKUPS concepts).
   */
  ingestText(opts: ConceptWrite, lookup?: { duplicates?: boolean }): Maybe<unknown>;
  /** Change some fields; with `new_id`, move the concept first and rewrite the links to it. */
  update(id: string, opts: ConceptPatch): Maybe<unknown>;
  /**
   * Delete one concept (weeding); inbound links from other concepts become
   * broken links. `source:<id>` deletes a kept source copy instead.
   */
  deleteConcept(id: string): Maybe<unknown>;
  /**
   * Files changed (paths from the repository root): the live concepts whose
   * OKF `resource` or `sources` name one are marked for review.
   */
  filesChanged(paths: string[], opts: { commit?: string; shelf?: string }): Maybe<unknown>;
  /** The tag thesaurus (controlled vocabulary). */
  thesaurus(): Maybe<unknown>;
  /** Set (or remove with null) one preferred tag's relations. */
  setTerm(tag: string, term: TermPatch | null): Maybe<unknown>;
  /** Finding aids: one Markdown shelf list per directory (`list` with `format: "markdown"`). */
  findingAid(opts: { dir?: string }): Maybe<unknown>;
  status(): Maybe<unknown>;
  /** Keep a source's text, so it can be quoted exactly later. */
  addSource(source: SourceWrite): Maybe<unknown>;
  /** Kept sources: the list, passages for a query, or one source's parts. */
  getSource(opts: {
    ref?: string;
    query?: string;
    part?: number;
    parts?: number;
    limit?: number;
    cursor?: string;
  }): Maybe<unknown>;
  /**
   * Libro's review shelf: the open proposals, oldest first, and `weeding`,
   * the CREW/MUSTIE report (deprecated, broken links, orphans, blank
   * records, past their review date, and circulation over `days`).
   */
  reviewShelf(opts: { kind?: string; limit?: number; days?: number }): Maybe<unknown>;
  /** File a proposal on the shelf, for a person to decide. */
  propose(p: ProposalWrite): Maybe<unknown>;
  /** A person's decision on a proposal. */
  decide(id: string, decision: Decision, date?: string): Maybe<unknown>;
}

/** The web app resolves its backend per request, from the bearer token in `ctx.http.authInfo`. */
export type BackendFactory = (ctx: ServerContext) => Backend;

function json(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

/**
 * Run a tool body; a thrown Error becomes an `{"error": ...}` result. A
 * result with an `image` ({data, mimeType}, from a kept source) also comes
 * back as an image, which an agent that reads images sees.
 */
async function run(body: () => Maybe<unknown>) {
  try {
    const out = await body();
    const image = (out as { image?: { data?: unknown; mimeType?: unknown } } | null)?.image;
    if (image && typeof image.data === "string" && typeof image.mimeType === "string") {
      const { image: _, ...rest } = out as Record<string, unknown>;
      return {
        content: [
          ...json(rest).content,
          { type: "image" as const, data: image.data, mimeType: image.mimeType },
        ],
      };
    }
    return json(out);
  } catch (exc) {
    return json({ error: exc instanceof Error ? exc.message : String(exc) });
  }
}

const statusArg = z.enum(STATUSES).optional().describe("draft, stable (default), or deprecated");

const authorArg = z
  .string()
  .optional()
  .describe("Its writer: an agent's name, a member's email, or 'me'");

const shelfArg = z.string().optional().describe("The leading directory of ids, e.g. 'acme'");

const sourcesArg = z
  .array(z.string().max(500))
  .max(50)
  .optional()
  .describe("Repository paths ('src/auth/' for a directory), links, or a kept source's `cite`");

const staleAfterArg = z
  .string()
  .optional()
  .describe("ISO date to check it again, for anything time-bound");

const reads = (title: string) => ({
  title,
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
});
const writes = (
  title: string,
  hints: { destructive?: boolean; idempotent?: boolean; openWorld?: boolean } = {},
) => ({
  title,
  annotations: {
    readOnlyHint: false,
    destructiveHint: hints.destructive ?? false,
    idempotentHint: hints.idempotent ?? false,
    openWorldHint: hints.openWorld ?? false,
  },
});

/**
 * The concepts of one `ingest` batch that are compared with the library for
 * `possible_duplicates`: each is a lookup in the word index, so a batch of
 * 100 stays a bounded read. Later concepts in the batch get none.
 */
export const BATCH_DUPLICATE_LOOKUPS = 20;

/**
 * Each tool's title and behavior hints (MCP tool annotations). Hosts show the
 * title and act on the hints: a host may ask before a call that isn't
 * read-only, and ChatGPT's directory requires all three hints on every tool.
 * Destructive: it can delete or overwrite with no revision to restore from
 * (every concept write keeps one). Open world: it reaches past the library
 * (a page librocat fetches). docs/mcp-tools.md gives each one's reason.
 */
export const TOOLS = {
  search: reads("Search the library"),
  get_concept: reads("Read a concept"),
  list: reads("List concepts"),
  graph: reads("Concept graph"),
  ingest: writes("Write concepts"),
  update: writes("Update a concept"),
  delete: writes("Delete a concept or source", { destructive: true, idempotent: true }),
  files_changed: writes("Mark changed files' concepts for review", { idempotent: true }),
  thesaurus: reads("Read the thesaurus"),
  set_term: writes("Set a thesaurus entry", { destructive: true, idempotent: true }),
  status: reads("Library status"),
  add_source: writes("Keep a source", { destructive: true, openWorld: true }),
  get_source: reads("Read a kept source"),
  review_shelf: reads("Libro's review shelf"),
  propose: writes("Propose a change to the shelf"),
  decide: writes("Decide a shelf proposal"),
} as const;

/** Register the librocat tools on an MCP server over the given backend. */
export function registerTools(server: McpServer, backend: Backend | BackendFactory): void {
  const be = (ctx: ServerContext): Backend =>
    typeof backend === "function" ? backend(ctx) : backend;

  server.registerTool(
    "search",
    {
      ...TOOLS.search,
      description:
        "Search by words, in any of their forms and through the thesaurus; title, " +
        "description, and tag matches rank first. Returns concepts with snippets, then " +
        'matching kept sources (`type: "Source"`). Nothing found? Try the words a concept ' +
        "about it would use.",
      inputSchema: z.object({
        query: z.string().describe("Words to find"),
        type: z.string().optional().describe("Only this concept type"),
        tag: z.string().optional().describe("Only this tag and its narrower tags"),
        status: z.string().optional(),
        shelf: shelfArg,
        author: authorArg,
        limit: z.number().int().min(1).max(100).default(20).describe("At most 50 come back"),
        sources: z.boolean().default(true).describe("false: concepts only"),
      }),
    },
    ({ query, type, tag, status, shelf, author, limit, sources }, ctx) =>
      run(() => be(ctx).search(query, { type, tag, status, shelf, author, limit, sources })),
  );

  server.registerTool(
    "get_concept",
    {
      ...TOOLS.get_concept,
      description:
        "Read one concept in full, with its `links` (outbound and inbound). `history: true` " +
        "adds its revisions, newest first; `revision` reads one revision instead. With " +
        "`ids`, up to 20 concepts as they are (for copying a library).",
      inputSchema: z.object({
        id: z.string().optional().describe("Concept id, e.g. 'code/auth/login'"),
        ids: z.array(z.string()).min(1).max(20).optional(),
        history: z.boolean().optional().describe("Add the revision list"),
        revision: z.string().optional().describe("A revision from the list"),
      }),
    },
    ({ id, ids, history, revision }, ctx) =>
      run(async () => {
        if (ids) return await be(ctx).getConcepts(ids);
        if (!id) return { error: "get_concept needs an `id`, or `ids`" };
        return (
          (await be(ctx).getConcept(id, { history, revision })) ?? {
            error: `concept not found: ${id}`,
          }
        );
      }),
  );

  server.registerTool(
    "list",
    {
      ...TOOLS.list,
      description:
        "List concepts' catalog records, by type, tag, status, shelf, or author. Page a " +
        "whole library with `cursor`: null, then each page's `cursor` until it's null. " +
        '`format: "markdown"` returns the finding aids instead: a Markdown shelf list per ' +
        "directory.",
      inputSchema: z.object({
        type: z.string().optional(),
        tag: z.string().optional(),
        status: z.string().optional(),
        shelf: shelfArg,
        author: authorArg,
        limit: z.number().int().min(1).max(500).default(100).describe("At most 100 come back"),
        offset: z.number().int().min(0).default(0).describe("Through the first 500"),
        cursor: z.string().nullable().optional(),
        format: z.enum(["json", "markdown"]).default("json"),
        dir: z.string().optional().describe("markdown: only this directory and below"),
      }),
    },
    ({ type, tag, status, shelf, author, limit, offset, cursor, format, dir }, ctx) =>
      run(() =>
        format === "markdown"
          ? be(ctx).findingAid({ dir })
          : be(ctx).list({
              type,
              tag,
              status,
              shelf,
              author,
              limit,
              ...(cursor !== undefined ? { cursor } : { offset }),
            }),
      ),
  );

  server.registerTool(
    "graph",
    {
      ...TOOLS.graph,
      description: "The concepts around `id`, breadth first, as nodes and edges.",
      inputSchema: z.object({
        id: z.string(),
        depth: z.number().int().min(1).max(4).default(1),
      }),
    },
    ({ id, depth }, ctx) => run(() => be(ctx).graph(id, { depth })),
  );

  // A batch item has the same fields as a single write, described once (on the single form).
  const conceptWrite = z.object({
    type: z.string(),
    title: z.string().optional(),
    description: z.string().optional(),
    body: z.string().default(""),
    tags: z.array(z.string()).optional(),
    id: z.string().optional(),
    status: z.enum(STATUSES).optional(),
    stale_after: z.string().optional(),
    sources: z.array(z.string().max(500)).max(50).optional(),
  });

  server.registerTool(
    "ingest",
    {
      ...TOOLS.ingest,
      description:
        "Write an OKF concept and index it; returns its id. An existing `id` is overwritten " +
        "in full (`update` changes some fields). A new concept may come back with " +
        "`possible_duplicates`, concepts that share its words: if one is the same subject, " +
        "`update` it and `delete` the new one, or `propose` a merge. `concepts` writes up to " +
        `100, with a result per item (the first ${BATCH_DUPLICATE_LOOKUPS} get duplicates).`,
      inputSchema: conceptWrite.extend({
        type: z
          .string()
          .optional()
          .describe("'Note' or 'Decision'; any other type is filed as 'Note'"),
        description: z.string().optional().describe("One sentence"),
        id: z.string().optional().describe("Path without .md; omit to derive one"),
        status: statusArg,
        stale_after: staleAfterArg,
        sources: sourcesArg,
        concepts: z.array(conceptWrite).min(1).max(100).optional(),
      }),
    },
    async ({ concepts, ...single }, ctx) => {
      if (concepts) {
        const b = be(ctx);
        const results = [];
        for (const [i, c] of concepts.entries()) {
          try {
            const duplicates = i < BATCH_DUPLICATE_LOOKUPS;
            results.push({ ok: true, result: await b.ingestText(c, { duplicates }) });
          } catch (exc) {
            results.push({ ok: false, error: exc instanceof Error ? exc.message : String(exc) });
          }
        }
        return json({ written: results.filter((r) => r.ok).length, results });
      }
      if (!single.type) return json({ error: "`type` is required (or pass `concepts`)" });
      return run(() => be(ctx).ingestText({ ...single, type: single.type as string }));
    },
  );

  server.registerTool(
    "update",
    {
      ...TOOLS.update,
      description:
        "Change some of a concept's fields; the rest stay. `new_id` moves it and rewrites " +
        "every link to it.",
      inputSchema: z.object({
        id: z.string(),
        new_id: z.string().optional(),
        body: z.string().optional(),
        title: z.string().optional(),
        description: z.string().optional(),
        tags: z.array(z.string()).optional(),
        type: z.string().optional(),
        status: statusArg,
        superseded_by: z.string().optional().describe("Its replacement; sets status deprecated"),
        stale_after: staleAfterArg.describe('Review date, ISO; "" clears it'),
        verify: z
          .boolean()
          .optional()
          .describe("You checked it holds; a passed review date moves 90 days on"),
        sources: sourcesArg.describe("Replaces the list; [] clears it"),
      }),
    },
    ({ id, ...patch }, ctx) => run(() => be(ctx).update(id, patch)),
  );

  server.registerTool(
    "delete",
    {
      ...TOOLS.delete,
      description:
        "Delete a concept (weeding): links to it break until fixed, and its id is never " +
        "given out again. `source:<id>` deletes a kept source.",
      inputSchema: z.object({ id: z.string() }),
    },
    ({ id }, ctx) => run(() => be(ctx).deleteConcept(id)),
  );

  server.registerTool(
    "files_changed",
    {
      ...TOOLS.files_changed,
      description:
        "After a commit, merge, or pull request: every live concept whose `sources` name a " +
        "changed file comes up for review (`stale: true`, and on Libro's shelf) until it is " +
        "`update`d with `verify: true` or retired. Returns the concepts marked.",
      inputSchema: z.object({
        paths: z
          .array(z.string().max(500))
          .min(1)
          .max(1000)
          .describe("As `git diff --name-only` prints them"),
        commit: z.string().max(200).optional(),
        shelf: shelfArg,
      }),
    },
    ({ paths, commit, shelf }, ctx) => run(() => be(ctx).filesChanged(paths, { commit, shelf })),
  );

  server.registerTool(
    "thesaurus",
    {
      ...TOOLS.thesaurus,
      description:
        "Read the tag vocabulary: each preferred tag's broader, narrower, and related " +
        "tags, `use_for` synonyms, and scope note. Reuse its tags before coining one.",
    },
    (ctx) => run(() => be(ctx).thesaurus()),
  );

  server.registerTool(
    "set_term",
    {
      ...TOOLS.set_term,
      description:
        "Set one preferred tag's thesaurus entry. Writes map `use_for` synonyms onto the " +
        "tag, and a tag filter includes its `narrower` tags. Omitted fields are kept, `[]` " +
        'or `""` clears one, and `remove: true` drops the entry.',
      inputSchema: z.object({
        tag: z.string().describe("The preferred tag, lowercase"),
        broader: z.array(z.string()).optional(),
        narrower: z.array(z.string()).optional(),
        related: z.array(z.string()).optional(),
        use_for: z.array(z.string()).optional(),
        scope_note: z.string().max(500).optional().describe("What the tag covers"),
        remove: z.boolean().default(false),
      }),
    },
    ({ tag, broader, narrower, related, use_for, scope_note, remove }, ctx) =>
      run(() =>
        be(ctx).setTerm(tag, remove ? null : { broader, narrower, related, use_for, scope_note }),
      ),
  );

  server.registerTool(
    "status",
    {
      ...TOOLS.status,
      description:
        "The library: counts, the type and tag vocabulary, links, plan, quota, index " +
        "credits, kept sources, your role in it (a reader only reads), and the other " +
        "libraries you can reach.",
    },
    (ctx) => run(() => be(ctx).status()),
  );

  server.registerTool(
    "add_source",
    {
      ...TOOLS.add_source,
      description:
        "Keep a document or picture (PDF, Office, text, code, an image) or text you read, " +
        "so any agent can find and quote it; a recording, as its transcript. A file: " +
        "`file` returns an upload URL and a `curl` line; POST the bytes, then pass " +
        "`storage_id`. No shell: ask the person to attach it on the dashboard's Library (Attach files). " +
        "Text: `title` and `text`. A URL alone keeps the page, or the PDF, Office file, or picture it points to (paid plans). Put the " +
        "returned `cite` in each concept's `sources`. Title a picture by what it shows. New " +
        "text for a kept URL or `id` replaces it and puts its concepts up for review.",
      inputSchema: z.object({
        title: z.string().min(1).max(200).optional(),
        text: z.string().min(1).optional().describe("Markdown or plain text"),
        location: z.string().max(500).optional().describe("Its URL or path"),
        kind: z
          .enum([
            "md",
            "txt",
            "html",
            "pdf",
            "docx",
            "document",
            "sheet",
            "slides",
            "transcript",
            "other",
          ])
          .optional(),
        id: z.string().optional().describe("Replace this kept source, or name a new one"),
        file: z
          .object({
            name: z.string().min(1).max(200),
            type: z.string().optional(),
            size: z.number().int().min(1),
          })
          .optional()
          .describe("Step 1: name, MIME type, size in bytes"),
        storage_id: z.string().optional().describe("Step 2: what the upload returned"),
        filename: z.string().max(200).optional(),
      }),
    },
    (args, ctx) =>
      run(() => {
        if (!args.file && !args.storage_id) {
          if (!args.text && !args.location)
            throw new Error(
              "pass `text`, a URL as `location`, or a file (`file`, then `storage_id`)",
            );
          if (args.text && !args.title) throw new Error("a source with `text` needs a `title`");
        }
        return be(ctx).addSource(args);
      }),
  );

  server.registerTool(
    "get_source",
    {
      ...TOOLS.get_source,
      description:
        "Read kept sources, for the exact words a concept summarizes. No `ref`: the list, " +
        "unread first, or with `query` passages from all. With `ref` (a `sources` entry): " +
        "who cites it and its first part (about a page); `part` reads on, `query` finds " +
        "passages. A file has a `download_url` for an hour or two (past 16 MB, " +
        "`download_parts`); a picture comes back as an image too.",
      inputSchema: z.object({
        ref: z.string().optional().describe("`source:<id>` or its URL"),
        query: z.string().optional(),
        part: z.number().int().min(1).optional(),
        parts: z.number().int().min(1).max(50).optional().describe("Parts to read from `part`"),
        limit: z.number().int().min(1).max(200).optional(),
        cursor: z.string().optional().describe("'' lists every source in id order"),
      }),
    },
    ({ ref, query, part, parts, limit, cursor }, ctx) =>
      run(() => be(ctx).getSource({ ref, query, part, parts, limit, cursor })),
  );

  server.registerTool(
    "review_shelf",
    {
      ...TOOLS.review_shelf,
      description:
        "Libro's proposals, oldest first, for the person to decide, and `weeding`: " +
        "deprecated, broken links, orphans, blank records, past review dates, not retrieved " +
        "in `days`. Libro fills in a missing description and tags and proposes the rest. " +
        "`supersede`: `target` replaces `subject` (if `subject` says more, `propose` a " +
        "merge). `merge`: `draft` is `target` after it; `support`, Libro's confidence it adds " +
        "nothing. `stale`: check it, then `verify` or retire. `date`: `target` is a review " +
        "date. Also `deprecate`, `synonym` (tags). With no `kind`, `missing`: questions no " +
        "concept answered this week and files no concept cites yet, for you to fill.",
      inputSchema: z.object({
        kind: z.enum(["supersede", "merge", "deprecate", "synonym", "stale", "date"]).optional(),
        limit: z.number().int().min(1).max(200).default(50),
        days: z.number().int().min(1).max(3650).default(90),
      }),
    },
    ({ kind, limit, days }, ctx) => run(() => be(ctx).reviewShelf({ kind, limit, days })),
  );

  server.registerTool(
    "propose",
    {
      ...TOOLS.propose,
      description:
        "File a proposal for the person to decide. A duplicate: read both, then `merge` with " +
        "a `draft` of `target` after it, every fact and link from both and nothing invented " +
        "(Libro scores it). Or `supersede`, `deprecate`, `synonym` (tags). Nothing changes " +
        "until `decide`.",
      inputSchema: z.object({
        kind: z.enum(["merge", "supersede", "deprecate", "synonym"]),
        subject: z.string().describe("The concept, or tag, that goes"),
        target: z.string().optional().describe("The one that stays"),
        reason: z.string().min(1).max(1000).describe("Why, in a sentence"),
        draft: z
          .object({
            title: z.string().optional(),
            description: z.string().optional(),
            tags: z.array(z.string()).optional(),
            body: z.string().optional(),
          })
          .optional(),
      }),
    },
    (p, ctx) => run(() => be(ctx).propose(p)),
  );

  server.registerTool(
    "decide",
    {
      ...TOOLS.decide,
      description:
        "Carry out the person's decision on a proposal: `approve` applies it as a revision, " +
        "`dismiss` drops it, `verify` (a `stale` one) records that it holds. Approving a " +
        "`date` proposal sets `target`, or `date` if the person picked another. Only once the " +
        "person said yes to it; never on your own.",
      inputSchema: z.object({
        id: z.string(),
        decision: z.enum(["approve", "dismiss", "verify"]),
        date: z
          .string()
          .optional()
          .describe(
            "Approving a `date` proposal only: the review date the person picked instead, " +
              "YYYY-MM-DD, after today",
          ),
      }),
    },
    ({ id, decision, date }, ctx) => run(() => be(ctx).decide(id, decision, date)),
  );
}
