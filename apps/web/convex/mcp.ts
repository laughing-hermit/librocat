/**
 * The remote MCP's data functions. The MCP endpoint itself is a Next.js route
 * on Vercel (apps/web/src/app/mcp/route.ts, mcp-handler); it verifies the
 * agent's OAuth access token, then calls these functions with that same
 * token as the Convex identity (convex/auth.config.ts checks it again).
 *
 * Every function resolves the library from the identity: the one `library`
 * names (the `?library=` of the MCP URL), else the one the agent's person
 * picked when they approved it (convex/agents.ts choose), else their default
 * library, and only when the user belongs to it. A caller can never reach a
 * library that is not theirs (no IDOR by construction).
 */

import { accepted, mimeOf } from "@librocat/core/sources";
import { ConvexError, v } from "convex/values";
import { api } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { action, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { agentAllowed, noteUse, pickOf } from "./agents";
import { questionsOf, waitingOf } from "./dashboard";
import { surfaced } from "./errors";
import * as files from "./files";
import { decideProposal, openShelf, proposeOnShelf } from "./libro";
import { limitCalls, monthlyLeft } from "./limits";
import {
  belongsTo,
  bySlug,
  canWrite,
  defaultPaused,
  librariesOf,
  libraryBySlug,
  PAUSED,
  pausedMember,
  requireWriter,
  roleIn,
} from "./membership";
import { metered } from "./metered";
import * as model from "./model";
import {
  type Asker,
  foldQuestion,
  linkAnswer,
  logQuestion,
  promote,
  readyReference,
} from "./reference";
import * as sources from "./sources";
import { ensureWorkspace, workspaceForUserId } from "./workspaces";

const NOT_SIGNED_IN =
  "not signed in: connect your agent to https://librocat.com/mcp and approve it in the browser";

/** Which library: the `?library=` slug of the MCP URL; absent, the agent's pick, else the default. */
const library = v.optional(v.string());

/**
 * The caller's identity. An MCP access token names its agent (`azp`, the OAuth
 * client); that agent must still hold the user's grant — a revoke on the
 * dashboard (convex/agents.ts) takes effect on the next call, not when the
 * token expires. The dashboard's own session carries no `azp`.
 */
async function requireIdentity(ctx: QueryCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError(NOT_SIGNED_IN);
  const clientId = typeof identity.azp === "string" ? identity.azp : undefined;
  if (clientId && !(await agentAllowed(ctx, identity.subject, clientId))) {
    throw new ConvexError(
      "this agent was disconnected from librocat: reconnect it and approve it again",
    );
  }
  return { userId: identity.subject, clientId };
}

/** What an agent in a library its person is paused in (membership.ts pausedIn) is told. */
const AGENT_PAUSED =
  `${PAUSED} Meanwhile, to use another library, disconnect this agent on the dashboard's ` +
  "Connect page, then sign in again to pick one.";

/** The library a slug names, if the user belongs to it; the error says what to check. */
async function namedLibrary(ctx: QueryCtx, userId: string, slug: string) {
  const ws = await libraryBySlug(ctx, userId, slug);
  if (!ws) {
    const named = await bySlug(ctx, slug);
    if (named && (await pausedMember(ctx, userId, named))) throw new ConvexError(AGENT_PAUSED);
    throw new ConvexError(
      `no library "${slug}" that you belong to: check ?library= in this agent's MCP URL, ` +
        "or drop it and pick the library when the agent signs in",
    );
  }
  return ws;
}

/**
 * The library the agent's person picked for it on /consent, if any. A pick
 * that no longer holds (the library deleted, they left it, or they're paused
 * in it) stops the agent rather than moving it: an agent never changes
 * library by itself.
 */
async function pickedLibrary(ctx: QueryCtx, userId: string, clientId?: string) {
  const pick = clientId ? await pickOf(ctx, userId, clientId) : null;
  if (!pick) return null;
  const ws = (await belongsTo(ctx, userId, pick.workspaceId))
    ? await ctx.db.get(pick.workspaceId)
    : null;
  if (!ws) {
    const picked = await ctx.db.get(pick.workspaceId);
    if (picked && (await pausedMember(ctx, userId, picked))) throw new ConvexError(AGENT_PAUSED);
    throw new ConvexError(
      "this agent's library is gone, or you're no longer in it: disconnect the agent on " +
        "the dashboard's Connect page, then sign in again to pick a library",
    );
  }
  return ws;
}

/**
 * An agent with no pick reaches its person's default library (`find`), unless
 * the first library they joined is paused for them: then it stops, saying
 * why (membership.ts defaultPaused).
 */
async function unpicked<T>(ctx: QueryCtx, userId: string, find: () => Promise<T>): Promise<T> {
  if (await defaultPaused(ctx, userId)) throw new ConvexError(AGENT_PAUSED);
  return await find();
}

/** Who is calling: the person, and their agent (OAuth client) when it's an agent. */
type Caller = Awaited<ReturnType<typeof requireIdentity>>;

async function requireMember(
  ctx: QueryCtx,
  slug?: string,
): Promise<{ ws: Doc<"workspaces">; caller: Caller }> {
  const caller = await requireIdentity(ctx);
  const { userId, clientId } = caller;
  if (slug) return { ws: await namedLibrary(ctx, userId, slug), caller };
  const ws =
    (await pickedLibrary(ctx, userId, clientId)) ??
    (await unpicked(ctx, userId, () => workspaceForUserId(ctx, userId)));
  // A consent on /consent creates the workspace; this covers a user whose
  // workspace was deleted after the agent was approved.
  if (!ws) throw new ConvexError("no workspace yet: open https://librocat.com/dashboard once");
  return { ws, caller };
}

/**
 * A call that reached a library, recorded as its agent's use (Connect's list,
 * convex/agents.ts noteUse), with the name the agent registered with.
 */
async function reached(ctx: MutationCtx, slug?: string) {
  const { ws, caller } = await requireMember(ctx, slug);
  const client = caller.clientId
    ? await noteUse(ctx, caller.userId, caller.clientId, ws._id)
    : undefined;
  return { ws, caller, client };
}

/**
 * For the reference desk (convex/reference.ts): the workspace, and who is
 * asking, so a question can be matched to the concept its asker opens next.
 */
async function askerOf(
  ctx: MutationCtx,
  slug?: string,
): Promise<{ ws: Doc<"workspaces">; asker: Asker }> {
  const { ws, caller, client } = await reached(ctx, slug);
  return { ws, asker: { userId: caller.userId, ...(client ? { client } : {}) } };
}

/**
 * A read, counted by what it reads (metered.ts): every tool that reads a
 * library is a mutation, so a token calling Convex directly counts too.
 */
async function asReader<T>(
  ctx: MutationCtx,
  slug: string | undefined,
  run: (ctx: MutationCtx, ws: Doc<"workspaces">, caller: Caller) => Promise<T>,
): Promise<T> {
  const { ws, caller } = await reached(ctx, slug);
  return await metered(ctx, ws, (c) => surfaced(() => run(c, ws, caller)));
}

/**
 * A write: the workspace (the default one is created on first use), and who
 * is writing, for the revision (convex/model.ts Writer). The agent is the
 * OAuth client the token was issued to (`azp`), by its registered name when
 * it has one. It counts a call and a write, the minute's limit, and what it
 * read past the first 256 KB (metered.ts).
 */
async function asWriter<T>(
  ctx: MutationCtx,
  slug: string | undefined,
  run: (ctx: MutationCtx, ws: Doc<"workspaces">, writer: model.Writer) => Promise<T>,
): Promise<T> {
  const { ws, writer } = await writerOf(ctx, slug);
  return await metered(ctx, ws, (c) => surfaced(() => run(c, ws, writer)), {
    burst: true,
    writes: 1,
  });
}

/** The library and the writer, counting nothing: for a write already counted (`meter`). */
async function writerOf(ctx: MutationCtx, slug?: string) {
  const { userId, clientId } = await requireIdentity(ctx);
  const ws = slug
    ? await namedLibrary(ctx, userId, slug)
    : ((await pickedLibrary(ctx, userId, clientId)) ??
      (await unpicked(ctx, userId, () => ensureWorkspace(ctx, userId))));
  // A Reader's agent reads; every change goes through here.
  await requireWriter(ctx, ws, userId);
  const client = clientId ? await noteUse(ctx, userId, clientId, ws._id) : undefined;
  const writer: model.Writer = { by: "agent", userId, client };
  return { ws, writer };
}

/** Who is this? The endpoint's own check and the `whoami`-style probes. */
export const whoami = query({
  args: { library },
  handler: async (ctx, { library: slug }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const clientId = typeof identity.azp === "string" ? identity.azp : undefined;
    const ws = slug
      ? await libraryBySlug(ctx, identity.subject, slug)
      : ((await pickedLibrary(ctx, identity.subject, clientId)) ??
        (await unpicked(ctx, identity.subject, () => workspaceForUserId(ctx, identity.subject))));
    return ws ? { workspaceId: ws._id, name: ws.name, slug: ws.slug ?? null, plan: ws.plan } : null;
  },
});

const searchArgs = {
  library,
  query: v.string(),
  type: v.optional(v.string()),
  tag: v.optional(v.string()),
  status: v.optional(v.string()),
  shelf: v.optional(v.string()),
  author: v.optional(v.string()),
  limit: v.optional(v.number()),
  /** false: concepts only, without the kept sources after them. */
  sources: v.optional(v.boolean()),
};

/** A search's hit: a concept's catalog record and snippet, and whether it answered this before. */
type Hit = Awaited<ReturnType<typeof model.search>>[number] & { ready_reference?: true };
/** Kept sources' hits, after the concepts (convex/sources.ts sourceHits). */
const SOURCE_HITS = 5;

/** The library a call reads, and its plan: fetching.ts checks it before it fetches a page. */
export const searchScope = internalQuery({
  args: { library },
  handler: async (
    ctx,
    { library: slug },
  ): Promise<{
    workspaceId: Id<"workspaces">;
    plan: Doc<"workspaces">["plan"];
    canWrite: boolean;
  }> => {
    const { ws, caller } = await requireMember(ctx, slug);
    return { workspaceId: ws._id, plan: ws.plan, canWrite: await canWrite(ctx, ws, caller.userId) };
  },
});

/**
 * A search is a question put to the library, answered by words (model.ts
 * search: stemmed, through the thesaurus, the catalog record weighed twice)
 * in one mutation, with no model call. The question goes in the
 * ready-reference file (convex/reference.ts), and a question asked before
 * gets the concept that answered it first (`ready_reference`). Kept
 * sources' parts and titles follow the concepts.
 */
export const searchWords = mutation({
  args: searchArgs,
  handler: async (
    ctx,
    { library: slug, sources: withSources, ...args },
  ): Promise<(Hit | sources.SourceHit)[]> => {
    const { ws, asker } = await askerOf(ctx, slug);
    return await metered(
      ctx,
      ws,
      (c) =>
        surfaced(async () => {
          const hits = await model.search(c, ws._id, { ...args, me: asker.userId });
          const answer = await readyReference(c, ws._id, foldQuestion(args.query));
          const out: Hit[] = answer ? promote(hits, answer) : hits;
          await logQuestion(
            c,
            ws._id,
            args.query,
            out.map((h) => h.id),
            asker,
          );
          // Kept sources after the concepts: what no one has written a concept about
          // yet. A library that keeps none skips the two searches.
          const filtered = args.type || args.tag || args.status || args.shelf || args.author;
          if (withSources === false || filtered || ws.sourceCount === 0) return out;
          return [...out, ...(await sources.sourceHits(c, ws._id, args.query, SOURCE_HITS))];
        }),
      { burst: true },
    );
  },
});

/**
 * Search as an action, the way it ran while it embedded the query: an
 * older Next.js calls it during a deploy or a rollback. It runs the same
 * search (`searchWords`).
 */
export const search = action({
  args: searchArgs,
  handler: async (ctx, args): Promise<(Hit | sources.SourceHit)[]> =>
    await ctx.runMutation(api.mcp.searchWords, args),
});

/**
 * Read one concept and record the retrieval (circulation) in the same
 * transaction; if the asker just searched and this was a result, it is that
 * question's answer. The concept comes with its `links` both ways, and with
 * `history` its revisions (one revision is `history` with `revision`).
 */
export const get = mutation({
  args: { library, id: v.string(), history: v.optional(v.boolean()) },
  handler: async (ctx, { library: slug, id, history }) => {
    const { ws, asker } = await askerOf(ctx, slug);
    return await metered(
      ctx,
      ws,
      async (c) => {
        await model.touchAccess(c, ws._id, id);
        // A retired id says what became of it (deleted, or renamed away).
        const concept = await surfaced(
          async () =>
            (await model.getConcept(c, ws._id, id)) ?? (await model.explainMissing(c, ws._id, id)),
        );
        if (!concept) return null;
        await linkAnswer(c, ws._id, concept.id, asker);
        const { outbound, inbound } = await model.neighbors(c, ws._id, concept.id);
        const revisions = history
          ? (await model.history(c, ws._id, concept.id, {})).revisions
          : undefined;
        return {
          ...concept,
          links: { outbound, inbound },
          ...(revisions ? { history: revisions } : {}),
        };
      },
      { burst: true },
    );
  },
});

/** The most concepts one `get_concept` reads with `ids`. */
const GET_MAX = 20;

/**
 * `get_concept` with `ids`: up to GET_MAX concepts as they are (`librocat
 * pull`). Not a person's reads, so circulation doesn't count them.
 */
export const getMany = mutation({
  args: { library, ids: v.array(v.string()) },
  handler: async (ctx, { library: slug, ids }) => {
    if (ids.length > GET_MAX) {
      throw new ConvexError(`get_concept reads at most ${GET_MAX} ids at a time`);
    }
    return await asReader(ctx, slug, async (c, ws) => {
      const concepts = [];
      const missing: string[] = [];
      for (const id of ids) {
        const concept = await model.getConcept(c, ws._id, id);
        if (concept) concepts.push(concept);
        else missing.push(id);
      }
      return { concepts, ...(missing.length > 0 ? { missing } : {}) };
    });
  },
});

export const list = mutation({
  args: {
    library,
    type: v.optional(v.string()),
    tag: v.optional(v.string()),
    status: v.optional(v.string()),
    shelf: v.optional(v.string()),
    author: v.optional(v.string()),
    limit: v.optional(v.number()),
    offset: v.optional(v.number()),
  },
  handler: async (ctx, { library: slug, ...args }) => {
    return await asReader(ctx, slug, (c, ws, caller) =>
      model.list(c, ws._id, { ...args, me: args.author ? caller.userId : undefined }),
    );
  },
});

/** `list` by cursor: null for the first page, then the one each page returns. */
export const listPage = mutation({
  args: {
    library,
    type: v.optional(v.string()),
    tag: v.optional(v.string()),
    status: v.optional(v.string()),
    shelf: v.optional(v.string()),
    author: v.optional(v.string()),
    limit: v.optional(v.number()),
    cursor: v.union(v.string(), v.null()),
  },
  handler: async (ctx, { library: slug, ...args }) => {
    return await asReader(ctx, slug, (c, ws, caller) =>
      model.listPage(c, ws._id, { ...args, me: args.author ? caller.userId : undefined }),
    );
  },
});

export const graph = mutation({
  args: { library, id: v.string(), depth: v.optional(v.number()) },
  handler: async (ctx, { library: slug, id, depth }) =>
    await asReader(ctx, slug, (c, ws) => model.graphOf(c, ws._id, id, depth ?? 1)),
});

/**
 * Count a call that only reads (a query, which can't count itself) against
 * the library's calls a month; with `writes`, a write too, and the per-minute
 * limit (fetching.ts, before it fetches a page).
 */
export const meter = mutation({
  args: { library, writes: v.optional(v.number()) },
  handler: async (ctx, { library: slug, writes = 0 }) => {
    const { ws, caller } = await reached(ctx, slug);
    if (writes > 0) await requireWriter(ctx, ws, caller.userId);
    await limitCalls(ctx, ws, { burst: writes > 0, writes });
    return null;
  },
});

/**
 * The library's state, which library this is, and the others the user can
 * reach, so an agent can tell its person which `?library=` a repo wants.
 */
export const status = mutation({
  args: { library },
  handler: async (ctx, { library: slug }) => {
    return await asReader(ctx, slug, async (c, ws, caller) => statusFor(c, ws, caller.userId));
  },
});

/** `status`'s answer, after this call is counted (so `monthly` includes it). */
async function statusFor(ctx: MutationCtx, ws: Doc<"workspaces">, userId: string) {
  const all = await librariesOf(ctx, userId);
  const monthly = await monthlyLeft(ctx, ws);
  return {
    ...(await model.statusOf(ctx, ws)),
    // Calls, writes, and file links in 30 days, refilled day by day, and left now.
    ...(monthly === null ? {} : { monthly }),
    // A reader's agent only reads (membership.ts canWrite).
    library: { name: ws.name, slug: ws.slug ?? null, role: await roleIn(ctx, ws, userId) },
    libraries: all.map(({ ws: l, member, default: first }) => ({
      name: l.name,
      slug: l.slug ?? null,
      role: member.role,
      ...(first ? { default: true } : {}),
    })),
  };
}

export const ingest = mutation({
  args: {
    library,
    type: v.string(),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    body: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    id: v.optional(v.string()),
    status: v.optional(v.string()),
    stale_after: v.optional(v.string()),
    sources: v.optional(v.array(v.string())),
    /**
     * Return `possible_duplicates` for a new concept (the default). The
     * `ingest` tool turns it off past the first concepts of a batch, so one
     * request's lookups stay bounded.
     */
    duplicates: v.optional(v.boolean()),
  },
  handler: async (ctx, { library: slug, duplicates, ...args }) =>
    await asWriter(ctx, slug, (c, ws, writer) =>
      model.ingest(c, ws, args, writer, { duplicates: duplicates ?? true }),
    ),
});

export const update = mutation({
  args: {
    library,
    id: v.string(),
    /** Move the concept here first, rewriting the links to it (model.rename). */
    new_id: v.optional(v.string()),
    body: v.optional(v.string()),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    type: v.optional(v.string()),
    status: v.optional(v.string()),
    superseded_by: v.optional(v.string()),
    stale_after: v.optional(v.string()),
    verify: v.optional(v.boolean()),
    sources: v.optional(v.array(v.string())),
  },
  handler: async (ctx, { library: slug, id, new_id, ...args }) =>
    await asWriter(ctx, slug, async (c, ws, writer) => {
      if (new_id === undefined || new_id === id) return await model.update(c, ws, id, args, writer);
      // The move first, then the fields at the new id, in one transaction.
      const moved = await model.rename(c, ws, id, new_id, writer);
      if (Object.keys(args).length === 0) return moved;
      return { ...moved, ...(await model.update(c, ws, moved.id, args, writer)) };
    }),
});

/** `files_changed`: the concepts that describe the changed files come up for review (model.changed). */
export const changed = mutation({
  args: {
    library,
    paths: v.array(v.string()),
    commit: v.optional(v.string()),
    shelf: v.optional(v.string()),
  },
  handler: async (ctx, { library: slug, paths, ...opts }) =>
    await asWriter(ctx, slug, (c, ws, writer) => model.changed(c, ws, paths, opts, writer)),
});

export const thesaurus = mutation({
  args: { library },
  handler: async (ctx, { library: slug }) =>
    await asReader(ctx, slug, (c, ws) => model.thesaurusOf(c, ws._id)),
});

export const setTerm = mutation({
  args: {
    library,
    tag: v.string(),
    term: v.union(
      v.null(),
      v.object({
        broader: v.optional(v.array(v.string())),
        narrower: v.optional(v.array(v.string())),
        related: v.optional(v.array(v.string())),
        use_for: v.optional(v.array(v.string())),
        scope_note: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, { library: slug, tag, term }) =>
    await asWriter(ctx, slug, (c, ws, writer) => model.setTerm(c, ws, tag, term, writer)),
});

export const findingAid = mutation({
  args: { library, dir: v.optional(v.string()) },
  handler: async (ctx, { library: slug, dir }) =>
    await asReader(ctx, slug, (c, ws) => model.findingAids(c, ws, dir)),
});

export const remove = mutation({
  args: { library, id: v.string() },
  handler: async (ctx, { library: slug, id }) =>
    await asWriter(ctx, slug, (c, ws) =>
      // `source:<id>` deletes a kept source copy (convex/sources.ts).
      id.trim().startsWith("source:")
        ? sources.removeSource(c, ws, id.trim())
        : model.deleteConcept(c, ws, id),
    ),
});

/** A concept's revisions, newest first; with `revision`, that revision's snapshot (`get_concept`). */
export const history = mutation({
  args: {
    library,
    id: v.string(),
    limit: v.optional(v.number()),
    revision: v.optional(v.string()),
  },
  handler: async (ctx, { library: slug, id, ...opts }) =>
    await asReader(ctx, slug, (c, ws) => model.history(c, ws._id, id, opts)),
});

// ---- the 0.1 tools' functions -------------------------------------------
//
// `neighbors`, `rename`, and `weedReport` are what the tools of 0.1 called,
// and an older Next.js still calls them during a deploy or a rollback:
// `get_concept`, `update`, and `review_shelf` do their work now.

export const neighbors = mutation({
  args: { library, id: v.string() },
  handler: async (ctx, { library: slug, id }) =>
    await asReader(ctx, slug, (c, ws) => model.neighbors(c, ws._id, id)),
});

export const rename = mutation({
  args: { library, id: v.string(), new_id: v.string() },
  handler: async (ctx, { library: slug, id, new_id }) =>
    await asWriter(ctx, slug, (c, ws, writer) => model.rename(c, ws, id, new_id, writer)),
});

export const weedReport = mutation({
  args: { library, days: v.optional(v.number()), limit: v.optional(v.number()) },
  handler: async (ctx, { library: slug, ...opts }) =>
    await asReader(ctx, slug, (c, ws) => model.keptWeedReport(c, ws, opts)),
});

/**
 * Keep a source (convex/sources.ts): the text of a document, page, or
 * transcript an agent read; or a file (a document or a picture). For a
 * file: `file` (its name, type, and size) returns an upload URL; then
 * `storage_id` (what the upload returned) attaches it, with the text the
 * uploader read, if any.
 */
export const addSource = mutation({
  args: {
    library,
    title: v.optional(v.string()),
    text: v.optional(v.string()),
    location: v.optional(v.string()),
    kind: v.optional(v.string()),
    id: v.optional(v.string()),
    file: v.optional(
      v.object({ name: v.string(), type: v.optional(v.string()), size: v.number() }),
    ),
    storage_id: v.optional(v.string()),
    filename: v.optional(v.string()),
  },
  handler: async (ctx, { library: slug, file, storage_id, filename, ...args }) =>
    await asWriter(
      ctx,
      slug,
      async (c, ws, writer): Promise<{ error: string } | Record<string, unknown>> => {
        if (file) {
          // Refused and counted, returned rather than thrown (a throw would undo
          // the count): the agent reads the same `error` either way.
          if (!accepted(mimeOf(file.name, file.type))) {
            return { error: await sources.refuseFile(c, file, "agent") };
          }
          return await sources.requestUpload(c, ws, file);
        }
        if (storage_id) {
          return await sources.attachFile(
            c,
            ws,
            {
              storageId: storage_id,
              filename: filename ?? args.title,
              title: args.title,
              text: args.text,
              location: args.location,
            },
            writer,
          );
        }
        const { title, text } = args;
        if (!title || !text) {
          throw new ConvexError(
            "a source needs a title and its text, or a file (`file`, then `storage_id`)",
          );
        }
        return await sources.addSource(c, ws, { ...args, title, text }, writer);
      },
    ),
});

/**
 * Keep a page librocat fetched for `add_source` with only a URL
 * (fetching.ts): counted by `meter` before the fetch, so not again here.
 */
export const addFetched = internalMutation({
  args: {
    library,
    title: v.string(),
    /** A page's text; or, for a linked file librocat stored, `storageId` and `filename`. */
    text: v.optional(v.string()),
    location: v.string(),
    kind: v.optional(v.string()),
    id: v.optional(v.string()),
    storageId: v.optional(v.string()),
    filename: v.optional(v.string()),
  },
  handler: async (ctx, { library: slug, storageId, filename, text, ...args }) => {
    const { ws, writer } = await writerOf(ctx, slug);
    return await surfaced(() =>
      storageId
        ? sources.attachFile(
            ctx,
            ws,
            {
              storageId,
              filename: filename ?? args.title,
              title: args.title,
              location: args.location,
              ...(args.id ? { id: args.id } : {}),
            },
            writer,
          )
        : sources.addSource(ctx, ws, { ...args, text: text ?? "" }, writer),
    );
  },
});

/**
 * Read kept sources: the list, passages for a query, or one source's parts.
 * A mutation, because the file links it hands out expire (files.ts), and a
 * link's expiry needs the clock.
 */
export const getSource = mutation({
  args: {
    library,
    ref: v.optional(v.string()),
    query: v.optional(v.string()),
    part: v.optional(v.number()),
    parts: v.optional(v.number()),
    limit: v.optional(v.number()),
    cursor: v.optional(v.string()),
  },
  handler: async (ctx, { library: slug, ...args }) =>
    await asReader(ctx, slug, async (c, ws) => {
      const link = files.linker(c, ws);
      const out = await sources.getSource(c, ws, args, link);
      return link.capped() ? { ...out, file_transfer: files.transferUsed(ws) } : out;
    }),
});

// ---- Libro's review shelf (convex/libro.ts) -------------------------------
//
// Libro files proposals and never writes; the person's agent works the shelf
// with them: it reads both concepts of a duplicate and writes the merge, and
// decides only on the person's say-so.

/**
 * The open proposals, oldest first (all of them, or one kind), and the
 * weeding report: what Libro proposes and what the mechanical review found,
 * worked in one pass. With no `kind`, also what's missing (Needs you's
 * Missing): this week's questions no concept answered, and the files no
 * concept cites yet, for the agent to fill. A question leaves once a search
 * for it finds something; a file, once a concept cites it.
 */
export const shelf = mutation({
  args: {
    library,
    kind: v.optional(v.string()),
    limit: v.optional(v.number()),
    days: v.optional(v.number()),
  },
  handler: async (ctx, { library: slug, kind, limit, days }) =>
    await asReader(ctx, slug, async (c, ws) => {
      const open = await openShelf(c, ws._id);
      const rows = kind ? open.filter((p) => p.kind === kind) : open;
      const n = Math.min(Math.max(Math.floor(limit ?? 50), 1), 200);
      const weeding = await model.keptWeedReport(c, ws, { days, limit: n });
      if (kind) return { total: rows.length, proposals: rows.slice(0, n), weeding };
      const now = Date.now();
      const { gaps } = await questionsOf(c, ws, now);
      const files = await waitingOf(c, ws, now);
      return {
        total: rows.length,
        proposals: rows.slice(0, n),
        weeding,
        missing: {
          questions: gaps.map((g) => ({ text: g.text, asked: g.count, last_asked: g.at })),
          // Its `cite`: what `get_source` reads, and what a concept's `sources` name.
          files: files.map((f) => ({ cite: `source:${f.id}`, title: f.title, added: f.at })),
        },
      };
    }),
});

/** File a proposal for a person to decide; a merge carries the agent's draft, which Jev checks. */
export const propose = mutation({
  args: {
    library,
    kind: v.union(
      v.literal("merge"),
      v.literal("supersede"),
      v.literal("deprecate"),
      v.literal("synonym"),
    ),
    subject: v.string(),
    target: v.optional(v.string()),
    reason: v.string(),
    draft: v.optional(
      v.object({
        title: v.optional(v.string()),
        description: v.optional(v.string()),
        tags: v.optional(v.array(v.string())),
        body: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, { library: slug, ...p }) =>
    await asWriter(ctx, slug, async (c, ws, writer) => {
      const id = await proposeOnShelf(c, ws, p, writer);
      return id
        ? { filed: true, id }
        : { filed: false, already: "the same proposal is on the shelf" };
    }),
});

/** Approve, dismiss, or verify a proposal: the person's decision, which their agent passes on. */
export const decide = mutation({
  args: {
    library,
    id: v.string(),
    decision: v.union(v.literal("approve"), v.literal("dismiss"), v.literal("verify")),
    date: v.optional(v.string()),
  },
  handler: async (ctx, { library: slug, id, decision, date }) =>
    await asWriter(ctx, slug, async (c, ws, writer) => {
      const proposal = c.db.normalizeId("proposals", id);
      if (!proposal) throw new ConvexError(`no proposal ${id} on the shelf: see review_shelf`);
      const userId = typeof writer === "string" ? undefined : writer.userId;
      return await decideProposal(c, ws, proposal, decision, { userId, writer }, date);
    }),
});
