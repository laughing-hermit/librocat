import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

// librocat's store: one row per OKF concept, per workspace. The workspace
// is the hosted library's source of truth (docs/architecture.md); export gives
// the same OKF files back. Git is optional and there is no repo sync
// (a decision): commit the exported zip to keep it in Git.
// Users, sessions, and OAuth grants live in the Better Auth component
// (convex/betterAuth/schema.ts); a user id here is Better Auth's (the `sub`
// of every token, convex/auth.config.ts).
export default defineSchema({
  // A library. A person can belong to several (convex/membership.ts); the
  // slug names it in `/mcp?library=<slug>` and never changes.
  workspaces: defineTable({
    name: v.string(),
    slug: v.optional(v.string()),
    ownerId: v.string(),
    plan: v.union(v.literal("free"), v.literal("individual"), v.literal("team")),
    conceptCount: v.number(),
    stripeCustomerId: v.optional(v.string()),
    stripeSubscriptionId: v.optional(v.string()),
    // Team: the seats its subscription pays for (the webhook keeps it in step).
    seats: v.optional(v.number()),
    subscriptionStatus: v.optional(v.string()),
    // When a cancelled subscription ends (ms), set until then; unset while it renews.
    cancelAt: v.optional(v.number()),
    // The library whose Team subscription covers this one (convex/teamCover.ts):
    // its plan, seats, and bill are the home's.
    coveredBy: v.optional(v.id("workspaces")),
    // Index credits (cataloging by Jev), per calendar month (UTC,
    // "YYYY-MM"). `indexUsed` counts included credits spent this period;
    // `indexOverage` counts pay-as-you-go credits beyond them. See
    // INDEX_CREDITS in model.ts.
    indexPeriod: v.optional(v.string()),
    indexUsed: v.optional(v.number()),
    indexOverage: v.optional(v.number()),
    // Opt-in: keep indexing past the included credits, billed per credit.
    payAsYouGo: v.optional(v.boolean()),
    // Pay-as-you-go's monthly cap, in cents (PAY_AS_YOU_GO_CAP_CENTS in
    // model.ts); unset reads as the default. `capNotice` is the highest cap
    // email sent this period (80 or 100, percent of the cap), so each goes
    // out once; a new cap clears it.
    payAsYouGoCapCents: v.optional(v.number()),
    capNotice: v.optional(v.object({ period: v.string(), level: v.number() })),
    // Last time Libro started a review for this workspace (cron or "Review
    // now"), the cooldown clock the dashboard button is checked against
    // (convex/libro.ts RUN_COOLDOWN_MS).
    libroRunAt: v.optional(v.number()),
    // Unused: Libro's model sessions and their credits, removed in 3.0.0
    // (Libro now writes nothing). Kept optional because stored rows may
    // still carry them.
    libroReviewedAt: v.optional(v.number()),
    libroPeriod: v.optional(v.string()),
    libroUsed: v.optional(v.number()),
    libroOverage: v.optional(v.number()),
    // Written only before 2026-10-20, when librocat dropped its embedding
    // model (when an embedding was scheduled, and when the duplicate screen
    // by meaning last ran): kept optional so a database from before still
    // validates. Nothing reads them.
    embedAt: v.optional(v.number()),
    duplicatesScreenedAt: v.optional(v.number()),
    // The text of the library's source copies, in bytes (convex/sources.ts),
    // against SOURCE_BYTES in model.ts.
    sourceBytes: v.optional(v.number()),
    // Of sourceBytes, the text (kept, and read from files): model.ts TEXT_BYTES.
    textBytes: v.optional(v.number()),
    sourceCount: v.optional(v.number()),
    // Revisions the library keeps (convex/model.ts recordRevision), against
    // REVISIONS_KEPT; unset on a library from before the count.
    revisionCount: v.optional(v.number()),
  })
    .index("by_owner", ["ownerId"])
    .index("by_covered", ["coveredBy"])
    .index("by_slug", ["slug"])
    .index("by_stripe_customer", ["stripeCustomerId"])
    // The largest libraries, for the weekly funnel email (convex/funnel.ts largest).
    .index("by_concepts", ["conceptCount"])
    .index("by_source_bytes", ["sourceBytes"])
    .index("by_text_bytes", ["textBytes"]),

  // The library the dashboard shows each person: the one they last switched
  // to. Agents are unaffected: they use their own (agentLibraries).
  currentLibrary: defineTable({
    userId: v.string(),
    workspaceId: v.id("workspaces"),
  })
    .index("by_user", ["userId"])
    .index("by_workspace", ["workspaceId"]),

  // The library each agent works in, picked by its person on /consent when
  // they approved it (convex/agents.ts choose): one row per person and agent
  // (OAuth client). Without one, the agent uses the default library, and
  // `?library=` on its MCP URL beats both (convex/mcp.ts).
  agentLibraries: defineTable({
    userId: v.string(),
    clientId: v.string(),
    workspaceId: v.id("workspaces"),
  }).index("by_user_client", ["userId", "clientId"]),

  // Each connected agent, for Connect's list (convex/agents.ts): one row per
  // person and agent, made when they approve it (the oauthConsent trigger,
  // convex/auth.ts) and gone when it's disconnected. `workspaceId` is the
  // library its calls last reached, `usedAt` when, written at most hourly.
  agents: defineTable({
    userId: v.string(),
    clientId: v.string(),
    workspaceId: v.id("workspaces"),
    // The name its OAuth client registered with (apps.ts appLabel shows it).
    name: v.string(),
    connectedAt: v.number(),
    usedAt: v.optional(v.number()),
  })
    .index("by_user_client", ["userId", "clientId"])
    .index("by_user", ["userId"])
    .index("by_workspace", ["workspaceId"]),

  // Each library's last weeding report for review_shelf (model.ts
  // keptWeedReport): one row, replaced when the library or the question
  // changes, or after a day.
  weedings: defineTable({
    workspaceId: v.id("workspaces"),
    key: v.string(),
    at: v.number(),
    report: v.any(),
  }).index("by_workspace", ["workspaceId"]),

  members: defineTable({
    workspaceId: v.id("workspaces"),
    userId: v.string(),
    // An admin runs the library (team, billing); a member (an Editor, as
    // people see it) and their agents change it; a reader and their agents
    // only read it (membership.ts canWrite).
    role: v.union(v.literal("admin"), v.literal("member"), v.literal("reader")),
    // Libro's weekly report by email (convex/report.ts). Unset: on for
    // admins, off for members.
    reportEmail: v.optional(v.boolean()),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_user", ["userId"]),

  // Team invites: one share link per workspace (convex/team.ts). Anyone with
  // the link who signs in joins the workspace, up to the plan's seats; an
  // admin regenerates the link to revoke it.
  invites: defineTable({
    workspaceId: v.id("workspaces"),
    code: v.string(),
    createdBy: v.string(),
    // Who joins through it: Editors (members) unless it says readers.
    role: v.optional(v.union(v.literal("member"), v.literal("reader"))),
  })
    .index("by_code", ["code"])
    .index("by_workspace", ["workspaceId"]),

  concepts: defineTable({
    workspaceId: v.id("workspaces"),
    cid: v.string(),
    type: v.string(),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    tags: v.array(v.string()),
    status: v.string(),
    frontmatter: v.any(),
    links: v.array(v.string()),
    // The body and the search text live in `bodies`: a Convex transaction
    // reads at most 16 MiB, and the metadata paths (list, status, weeding,
    // finding aids, Libro's review) collect every row of a workspace.
    // Provenance: last write (creation is Convex's built-in _creationTime).
    updatedAt: v.optional(v.number()),
    // Circulation: bumped by MCP get_concept; powers "never retrieved" weeding.
    lastAccessedAt: v.optional(v.number()),
    accessCount: v.optional(v.number()),
    // When automatic indexation last filled this concept's catalog record,
    // and when a job was scheduled and is still in flight (cleared by apply).
    indexedAt: v.optional(v.number()),
    indexingAt: v.optional(v.number()),
    // Libro couldn't catalog it yet (Jev unreachable, or no credit left):
    // the daily job tries again (indexation.ts resumeWaiting). Cleared once
    // it's cataloged, or Jev finds nothing to pick, or its writer fills it.
    catalogWaiting: v.optional(v.boolean()),
    // When Libro last had Jev read this concept for claims tied to a date
    // (convex/libro.ts datesScreen); read again only after it changes.
    datesCheckedAt: v.optional(v.number()),
    // Written only before 2026-10-20 (the concept's vector: when, with which
    // model, and whether it waited for one): kept optional so a database
    // from before still validates. Nothing reads them.
    embeddedAt: v.optional(v.number()),
    embeddedWith: v.optional(v.string()),
    embedDue: v.optional(v.boolean()),
    // Author entry (Cutter's object D): everyone who wrote a revision, as
    // actor keys: `human:<userId>`, the agent's client name, `process:<name>`.
    // Kept on the catalog record so `author` filters never read revisions.
    authors: v.optional(v.array(v.string())),
    // The catalog record's words, stemmed (title, description, tags): search
    // weighs a match here twice one in the body (model.ts search). On this
    // small row, so ranking the catalog never reads bodies.
    catalogStem: v.optional(v.string()),
  })
    .index("by_workspace_cid", ["workspaceId", "cid"])
    // What changed lately (duplicate screening, the capped review passes).
    .index("by_workspace_updated", ["workspaceId", "updatedAt"])
    // What waits for Libro, library by library (indexation.ts resumeWaiting).
    .index("by_catalog_waiting", ["catalogWaiting", "workspaceId"])
    .searchIndex("search_catalog", {
      searchField: "catalogStem",
      filterFields: ["workspaceId", "type", "status"],
    }),

  // One row per concept: the Markdown body and the searchable text (title +
  // description + tags + body, stemmed by @librocat/core stemText; Convex
  // search indexes exactly one field). `type` and `status` are copied here
  // so search can filter on them. Search reads it with the catalog record's
  // own on `concepts` (model.ts search). `searchText`, the same text
  // unstemmed, was never searched: no longer written, and cleared by
  // migrations:dropSearchText before the field goes.
  bodies: defineTable({
    workspaceId: v.id("workspaces"),
    cid: v.string(),
    type: v.string(),
    status: v.string(),
    body: v.string(),
    searchText: v.optional(v.string()),
    searchStem: v.optional(v.string()),
  })
    .index("by_workspace_cid", ["workspaceId", "cid"])
    .searchIndex("search_stem", {
      searchField: "searchStem",
      filterFields: ["workspaceId", "type", "status"],
    }),

  // Source copies (convex/sources.ts): the text of a document, page, or
  // transcript an agent read, kept so an agent can quote it exactly later.
  // The original stays where it lives. A concept cites a copy in its OKF
  // `sources` by the copy's URL, or as `source:<sid>`.
  sources: defineTable({
    workspaceId: v.id("workspaces"),
    sid: v.string(),
    title: v.string(),
    // An attached file (convex/attachments.ts): the original, in Convex file
    // storage, its type and name, and where reading it stands. `bytes` stays
    // the text's size; the library's `sourceBytes` counts both.
    storageId: v.optional(v.id("_storage")),
    mime: v.optional(v.string()),
    filename: v.optional(v.string()),
    fileBytes: v.optional(v.number()),
    status: v.optional(v.union(v.literal("processing"), v.literal("ready"), v.literal("failed"))),
    // Why it failed, or what couldn't be read (a picture that couldn't be converted).
    error: v.optional(v.string()),
    // Written only before 2026-10-20 (parts that waited for index credits
    // to be embedded): kept optional so a database from before still
    // validates. Nothing reads it.
    waiting: v.optional(v.number()),
    // Where the original lives, as given: a URL, or a path.
    location: v.optional(v.string()),
    // md, txt, html, pdf, docx, document, sheet, slides, transcript, or other:
    // how the text was made.
    kind: v.string(),
    bytes: v.number(),
    parts: v.number(),
    // The text's fingerprint (@librocat/core/sources hashText): the same text
    // added again is the same source.
    hash: v.string(),
    userId: v.optional(v.string()),
    client: v.optional(v.string()),
    updatedAt: v.number(),
    // Source watch (convex/fetching.ts): when librocat last fetched the page
    // to compare, and why it couldn't, if it couldn't.
    checkedAt: v.optional(v.number()),
    checkError: v.optional(v.string()),
    // The title, stemmed as a concept's catalog record is (model.ts
    // titleStemOf): search finds a source by it (sources.ts sourceHits), so
    // a picture or a scan with no text is found too. Unset on a source from
    // before it, until migrations:indexSourceTitles. Its tags join it.
    titleStem: v.optional(v.string()),
    // What Jev picked when it read a person's file (convex/fileCatalog.ts):
    // one of its own sentences as its description, and tags from the
    // library's vocabulary; `cataloged` says so, and by which model.
    description: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    cataloged: v.optional(
      v.object({
        description: v.optional(v.literal("transcribed")),
        tags: v.optional(v.literal("selected")),
        by: v.array(v.string()),
        at: v.number(),
      }),
    ),
    // How far Libro has read it, in parts (fileCatalog.ts): all of them
    // once it's done.
    libroRead: v.optional(v.number()),
  })
    .index("by_workspace_sid", ["workspaceId", "sid"])
    .index("by_workspace_location", ["workspaceId", "location"])
    .index("by_workspace_hash", ["workspaceId", "hash"])
    .index("by_storage", ["storageId"])
    // The newest first (get_source's list).
    .index("by_workspace_updated", ["workspaceId", "updatedAt"])
    .searchIndex("search_title", {
      searchField: "titleStem",
      filterFields: ["workspaceId"],
    }),

  // A source's parts, in order: its text a page at a time (about 4,000
  // characters), searched for passages (`get_source` with a query), and a
  // file's own parts (`media`): a picture, or, on a source from before
  // 2026-10-20, a PDF window of pages.
  // A person's file Libro is still reading (convex/fileCatalog.ts), a read
  // at a time: the next part, the concepts already flagged (not asked
  // again), and `waiting` when the month's file credits ran out (a daily
  // job goes on once they renew). Gone once the file is read to its end.
  fileReads: defineTable({
    workspaceId: v.id("workspaces"),
    sourceId: v.id("sources"),
    next: v.number(),
    flagged: v.array(v.string()),
    waiting: v.optional(v.boolean()),
  })
    .index("by_source", ["sourceId"])
    .index("by_workspace", ["workspaceId"])
    .index("by_waiting", ["waiting"]),

  sourceParts: defineTable({
    workspaceId: v.id("workspaces"),
    sourceId: v.id("sources"),
    n: v.number(),
    text: v.string(),
    media: v.optional(
      v.object({
        mime: v.string(),
        // A PDF window, its first and last page: written only before 2026-10-20.
        pages: v.optional(v.array(v.number())),
        // The part's own file: a picture converted to JPEG.
        storageId: v.optional(v.id("_storage")),
      }),
    ),
    // Written only before 2026-10-20 (the model the part's vector was made
    // with): kept optional so a database from before still validates.
    vectorModel: v.optional(v.string()),
  })
    .index("by_source_n", ["sourceId", "n"])
    .index("by_workspace", ["workspaceId"])
    // Which part holds a converted picture (sources.ts pruneUnattached).
    .index("by_media_storage", ["media.storageId"])
    .searchIndex("search_text", {
      searchField: "text",
      filterFields: ["workspaceId", "sourceId"],
    }),

  // Libro's review shelf: what Libro, the library cat, proposes,
  // for a human to approve or dismiss. Libro proposes, the user disposes: nothing here
  // changes a concept until someone clicks approve (which records a revision).
  proposals: defineTable({
    workspaceId: v.id("workspaces"),
    kind: v.union(
      v.literal("supersede"),
      v.literal("deprecate"),
      v.literal("synonym"),
      v.literal("merge"),
      v.literal("stale"),
      v.literal("date"),
      v.literal("gap"),
    ),
    // supersede: `subject` (older) is superseded by `target` (newer).
    // deprecate: `subject` should be retired (never read, or already superseded).
    // synonym: tag `subject` is a spelling of preferred tag `target`.
    // merge: fold `subject` into `target`, rewriting `target` with `draft`
    //        (title, description, tags, body) and superseding `subject`.
    // stale: `subject` is past its review date (OKF stale_after, kept in
    //        `target`, so a new date is a new proposal): verify it, or retire it.
    // date:  `subject` states something tied to a date, a version, a price,
    //        or a person, and has no review date: set `target` (an ISO date)
    //        as its OKF stale_after.
    // gap:   agents asked a question (key `target`, convex/reference.ts) and
    //        found no answer, and `subject` is about it: approve sets its OKF
    //        stale_after to today, so it reads as stale until someone checks it.
    //        Filed only before 2026-10-20 (the screen ran on embeddings); the
    //        rows already on a shelf are still decided as before.
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
    // merge: Jev's probability that everything the draft says is in its two
    // source concepts (libro.ts checkDraft). Unset until checked, or when Jev
    // could not be asked.
    support: v.optional(v.number()),
    // Who filed it: "libro" (the review and Jev's screens), or "agent" (a
    // person's agent, through the MCP `propose`) with the user it was filed
    // for and the OAuth client, as a revision names them. Older rows may say
    // "libro-eve", Libro's former model sessions.
    by: v.optional(v.string()),
    userId: v.optional(v.string()),
    client: v.optional(v.string()),
    status: v.union(
      v.literal("open"),
      v.literal("approved"),
      v.literal("dismissed"),
      v.literal("verified"),
    ),
    decidedAt: v.optional(v.number()),
    decidedBy: v.optional(v.string()),
  })
    .index("by_workspace_status", ["workspaceId", "status"])
    .index("by_workspace_key", ["workspaceId", "kind", "subject", "target"]),

  // The ready-reference file (convex/reference.ts): the questions agents ask
  // the library (MCP `search` queries) and the concept that answered each, so
  // a repeated question gets its answer first, and a question that found
  // nothing shows where the collection has a gap. Kept 90 days.
  questions: defineTable({
    workspaceId: v.id("workspaces"),
    // The query as asked (trimmed, capped) and its folded form for grouping.
    text: v.string(),
    key: v.string(),
    // How many results it found, and the first few ids.
    hits: v.number(),
    results: v.array(v.string()),
    // The first of those results the same asker opened within ten minutes.
    answeredBy: v.optional(v.string()),
    // Written only before 2026-10-20, when search also ran by meaning and Jev
    // judged it (the top hits by words alone, whether the answer was among
    // them, Jev's probability that a result answered, and an earlier
    // question's key it was filed under): kept optional so a question from
    // before still validates until it ages out (90 days). Nothing reads them.
    wordTop: v.optional(v.array(v.string())),
    answerByWords: v.optional(v.boolean()),
    relevance: v.optional(v.number()),
    fold: v.optional(v.string()),
    userId: v.optional(v.string()),
    client: v.optional(v.string()),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_workspace_key", ["workspaceId", "key"]),

  // A library's questions of the last 7 days, added up for the Library's
  // Needs you (convex/dashboard.ts weekOf): how many were asked, how many
  // found nothing, and the most asked of those. A look reads this row
  // instead of the week's questions, until a newer question (`newest`) or
  // an hour (`at`). Goes with the library.
  questionWeeks: defineTable({
    workspaceId: v.id("workspaces"),
    at: v.number(),
    newest: v.number(),
    asked: v.number(),
    found_nothing: v.number(),
    unanswered: v.array(
      v.object({ key: v.string(), text: v.string(), count: v.number(), last_asked: v.number() }),
    ),
  }).index("by_workspace", ["workspaceId"]),

  // What Home's "Needs your review" was told to stop showing
  // (convex/dashboard.ts): a question no search answered, by its key, or a
  // source no concept cites, by its id. It shows again once asked again (or
  // the source changes) after `at`. Goes with the library.
  dismissedGaps: defineTable({
    workspaceId: v.id("workspaces"),
    kind: v.union(v.literal("question"), v.literal("source")),
    key: v.string(),
    at: v.number(),
  }).index("by_workspace_kind_key", ["workspaceId", "kind", "key"]),

  // Files librocat refused (it keeps text and pictures), counted by kind and
  // door alone, never by name or library: the weekly funnel email reports
  // them, to show whether people want recordings kept (sources.ts refuseFile).
  refusals: defineTable({
    kind: v.union(v.literal("audio"), v.literal("video"), v.literal("other")),
    door: v.union(v.literal("dashboard"), v.literal("agent")),
  }),

  // The catalog index (model.ts facetsOf): what each concept is filed under,
  // one row per facet, so a filter, a citation, or a count is a lookup and no
  // call reads the whole library. Kinds: type, status, tag, author, cite (a
  // live concept's sources), superseded_by.
  facets: defineTable({
    workspaceId: v.id("workspaces"),
    kind: v.string(),
    value: v.string(),
    cid: v.string(),
  })
    .index("by_kind_value", ["workspaceId", "kind", "value", "cid"])
    .index("by_cid", ["workspaceId", "cid"]),

  // How many concepts carry each type and tag, and the library's links in
  // all (kind "links"): `status` and cataloging read the top ones by count.
  facetCounts: defineTable({
    workspaceId: v.id("workspaces"),
    kind: v.string(),
    value: v.string(),
    count: v.number(),
  })
    .index("by_kind_value", ["workspaceId", "kind", "value"])
    .index("by_kind_count", ["workspaceId", "kind", "count"]),

  // Retired accession numbers (Dana, ch. XIX): the ids of deleted concepts,
  // and of renamed ones (`movedTo`), so a new concept never takes one by
  // default and reading one says what became of it. The export writes them
  // as OKF's update log, log.md (@librocat/core/library Tombstone).
  tombstones: defineTable({
    workspaceId: v.id("workspaces"),
    cid: v.string(),
    at: v.number(),
    title: v.optional(v.string()),
    movedTo: v.optional(v.string()),
  }).index("by_workspace_cid", ["workspaceId", "cid"]),

  links: defineTable({
    workspaceId: v.id("workspaces"),
    src: v.string(),
    dst: v.string(),
  })
    .index("by_ws_src", ["workspaceId", "src"])
    .index("by_ws_dst", ["workspaceId", "dst"]),

  // Revision history: one snapshot per write, the "commit" of the hosted
  // tier. Keyed by the concept row, so history survives a rename.
  // ponytail: full snapshots, not diffs; a per-concept cap if storage matters.
  revisions: defineTable({
    workspaceId: v.id("workspaces"),
    conceptId: v.id("concepts"),
    cid: v.string(),
    seq: v.number(),
    kind: v.union(
      v.literal("create"),
      v.literal("update"),
      v.literal("rename"),
      v.literal("index"),
    ),
    // Who wrote it: "agent" (the MCP), "indexer", "libro", or "human" (the
    // dashboard); older rows may say "libro-eve".
    by: v.string(),
    // Provenance of an MCP write: the signed-in user it was made for, and
    // the OAuth client (the agent) that made it, e.g. "Claude Code".
    userId: v.optional(v.string()),
    client: v.optional(v.string()),
    frontmatter: v.any(),
    body: v.string(),
  })
    .index("by_concept", ["conceptId", "seq"])
    .index("by_workspace", ["workspaceId"]),
});
