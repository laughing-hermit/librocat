# MCP tools

The agent-facing interface, defined once in `packages/mcp/src/tools.ts` and
served by the MCP endpoint: `https://librocat.com/mcp` on librocat.com, or
`/mcp` on a self-hosted librocat. It resolves the library from the bearer
token (OAuth 2.1) and is stateless. Sixteen tools.

| Tool | Purpose | Key arguments |
|------|---------|---------------|
| `search` | Search by words, expanded through the thesaurus, with matches in the catalog record (title, description, tags) counting twice, and snippets; then the kept sources that match by their words or their title (`type: "Source"`) | `query`, `type?`, `tag?`, `status?`, `limit?`, `shelf?`, `author?`, `sources?` |
| `get_concept` | Read one concept in full, with its `links` (outbound and inbound, each `{ id, title, exists }`); `history: true` adds its revisions, newest first (one per write that changed something; librocat.com keeps each concept's last 100); `revision` returns that one revision's snapshot instead. With `ids`, up to 20 as they are (for copying a library; not counted as people's reads) | `id`, `history?`, `revision?`, or `ids` |
| `list` | List concept metadata, 100 a page at most: by `cursor` (null first, then the one each page returns, until null) through a whole library, or by `offset` through the first 500. `format: "markdown"` returns the finding aids instead: one shelf list per directory (the export writes them as `index.md`) | `type?`, `tag?`, `status?`, `limit?`, `cursor?`, `offset?`, `shelf?`, `author?`, `format?`, `dir?` |
| `graph` | Breadth-first subgraph (nodes + edges) | `id`, `depth?` (1–4) |
| `ingest` | Create a concept, index it (an existing `id` is overwritten in full). A new concept's result may carry `possible_duplicates`: up to 3 existing concepts that share its words, each `{ id, title, description }`, for the agent to `update` or `propose` a merge with when one is the same subject. Batch form: `concepts: [...]` writes up to 100 in one call and reports, per item, the id or the error (and the first 20 items' `possible_duplicates`) | `type`, `title?`, `description?`, `body?`, `tags?`, `id?`, `status?`, `stale_after?`, `sources?` or `concepts?` |
| `update` | Change a concept's body/metadata; `verify: true` records that you checked it still holds; `new_id` moves it to a new id and rewrites every inbound link | `id`, and any field to change (incl. `new_id`, `status`, `superseded_by`, `stale_after`, `verify`, `sources`) |
| `delete` | Remove one concept (weeding), or a kept source (`source:<id>`) | `id` |
| `files_changed` | Files changed (after a commit or PR): the concepts whose `sources` name one come up for review | `paths`, `commit?`, `shelf?` |
| `thesaurus` | Read the tag thesaurus | — |
| `set_term` | Set one preferred tag's `broader`/`narrower`/`related`/`use_for` and `scope_note`, or drop its entry (`remove: true`) | `tag`, `broader?`, `narrower?`, `related?`, `use_for?`, `scope_note?`, `remove?` |
| `status` | Counts, the type/tag vocabulary, links, plan, quota, `library.role` (`admin`, `editor`, or `reader`: a reader's agent only reads), and Libro's credits this month (`index_credits`, librocat.com) or `models` (self-hosted: what runs Libro's model, or why it's off), `review_shelf` (Libro's open proposals), and `sources` (what's kept, and how much of it is text). Broken links are in `review_shelf`'s `weeding`, unread sources in `get_source` | — |
| `add_source` | Keep a source: a file (two steps: `file` returns an upload URL, then `storage_id` attaches the upload), or the exact text of a document, page, or transcript; the same file or text again returns the kept copy, and new text for a kept URL (or `id`) replaces it and puts the concepts citing it up for review | `title?`, `text?`, `location?`, `kind?`, `id?`, `file?`, `storage_id?`, `filename?` |
| `get_source` | Read a kept source: the list (unread first), passages for a `query`, or one source's parts; a file comes with a link that lasts an hour or two (`download_url`, or `download_parts` past 16 MB), its parts say what they are, and a picture comes back as an image | `ref?`, `query?`, `part?`, `parts?`, `limit?`, `cursor?` |
| `review_shelf` | Libro's review shelf: the open proposals, oldest first, with each one's reason, author, and a merge's draft and Libro's `support`; and `weeding`, the CREW/MUSTIE report: deprecated, broken links, orphans, blank records, `stale` (past `stale_after`), and circulation (never retrieved in `days` days, most retrieved). With no `kind`, also `missing`: this week's questions no concept answered and the files no concept cites yet, for the agent to fill (a question leaves once a search for it finds something; a file, once a concept cites it) | `kind?`, `limit?`, `days?` |
| `propose` | File a proposal for the person to decide: a `merge` with the agent's draft of the target (Libro checks it), `supersede`, `deprecate`, or `synonym` | `kind`, `subject`, `target?`, `reason`, `draft?` |
| `decide` | Carry out the person's decision on a proposal: `approve` (applied as a revision), `dismiss`, or `verify` (a concept past its review date still holds). Approving a `date` proposal may carry the review date the person picked instead | `id`, `decision`, `date?` |

The descriptions an agent reads are short on purpose: the tool list is in
every session's context. The server's instructions add the workflow (search
before you write, act on `possible_duplicates`, cite kept sources, call
`files_changed` after a commit, and `decide` only on the person's yes), and
the skills carry the craft.

## Behavior hints

Each tool has a title and the MCP behavior hints (`TOOLS` in
`packages/mcp/src/tools.ts`). Hosts act on them: a host may ask before a call
that isn't read-only, and ChatGPT's plugin directory requires all three on
every tool. A tool is destructive when it can delete or overwrite something
with no revision to restore it from; every concept write keeps a revision.

| Tools | Read-only | Destructive | Open world | Why |
|-------|-----------|-------------|------------|-----|
| `search`, `get_concept`, `list`, `graph`, `thesaurus`, `status`, `get_source`, `review_shelf` | yes | no | no | They read the library. `search` also files the question for the reference desk, which changes nothing the agent reads |
| `ingest`, `update` | no | no | no | They write concepts, and each write is a revision that `get_concept` with `history: true` reads back |
| `files_changed` | no | no | no | It moves the review date of the concepts that cite the changed files to now; nothing is deleted |
| `propose` | no | no | no | It files a proposal on the review shelf; proposing changes no concept |
| `decide` | no | no | no | It applies the person's decision as a revision, or closes the proposal |
| `delete` | no | yes | no | It deletes a concept or a kept source |
| `set_term` | no | yes | no | It sets a tag's thesaurus entry; `remove: true` deletes the entry |
| `add_source` | no | yes | yes | New text for a kept copy replaces the old text, and a URL alone makes librocat fetch that page |

## Your agent works Libro's shelf

Libro, librocat's librarian, checks the whole library. It fills in a
description and tags an agent left out (automatic indexation, below), and
proposes everything else: the mechanical review (same titles, retired
concepts still marked stable, two spellings of a tag) and, with its model, its
screens (pairs that say the same thing, review dates). What it finds goes on
the review shelf, and nothing there changes until the person approves it.
The writing is the person's agent's, with the model it already uses:

- `review_shelf` lists what is open. A `supersede` Libro found says so in its
  `reason`: read both concepts with `get_concept`, and when the older one
  says something the newer one lacks, `propose` a `merge` instead, with a
  `draft` of the target that keeps every fact and link from both and
  invents nothing.
- Libro checks every merge draft against its two concepts; `support` is its
  probability that the draft says only what they say (under 0.8: read both
  again).
- `decide` only on the person's say-so: show them what it changes first.
  Approving a merge rewrites the target with the draft, supersedes the
  subject, and closes a screen's supersede of the same pair. Each approval
  is a revision by the proposal's author: `libro`, or the agent that filed
  it, for the person it was filed for.
- With nobody there to decide, `propose` leaves it on the shelf for the
  dashboard (the Library's Needs you tab).

The `knowledge-review` skill walks an agent through it.

## Sources: attach documents and pictures, then catalog them

A kept source is what the library holds besides its concepts: a file someone
attached (a PDF, a document, a spreadsheet, slides, a picture), or the text of
what an agent read (a document, a web page, a transcript). librocat keeps text
and pictures, the things agents read: audio, video, and other files are
refused at upload, and a recording's transcript is kept as text instead. Concepts are the
knowledge agents wrote; sources are what they quote when a concept's summary
isn't enough, and what a teammate's agent reads when the original is on
someone else's laptop.

- **Attaching a file.** On the dashboard's Library › Sources, "Attach files" (drag
  and drop documents and pictures). From an agent with a shell, two steps:
  `add_source` with `file` (name, type, size) returns an `upload_url`; POST the
  bytes there (`curl -X POST -H 'Content-Type: <type>' --data-binary @<file>
  '<upload_url>'`, which answers `{"storageId": …}`), then `add_source` with
  that `storage_id`, the `filename`, and a `title`. librocat reads the text
  of PDFs and Office files itself. The file goes straight to storage,
  never through the MCP route. A web page the agent can fetch, it keeps as
  text with `location` (on paid plans librocat fetches a URL itself); a PDF
  at a URL, it downloads, then uploads. An agent
  that can't send a file's bytes (no shell to POST them) asks the person to
  drop it on Library › Sources, then finds it with `get_source` (files no
  concept cites come first).
- **What librocat does with it** (convex/attachments.ts), with no model: it
  reads the text where code can (text and code, HTML, PDF, Word, Excel and
  OpenDocument spreadsheets as CSV, PowerPoint and OpenDocument slides with
  their notes, OpenDocument text, RTF, EPUB) and splits it into parts of
  about a page. A picture is kept as a part of its own; a HEIC, WebP, GIF,
  AVIF, TIFF, or SVG picture gets a JPEG copy, so `get_source` and the
  dashboard can show it. A source reads `status: processing`, then `ready`;
  what it couldn't read it says (`note`). An agent's attaching doesn't count toward
  descriptions and tags; a file a person adds on the dashboard costs one a read when Libro
  reads it, about three pages a read, end to end (its `description` and `tags`, and the
  concepts it changes, convex/fileCatalog.ts).
- **Keeping text.** `add_source` with `title` and `text` keeps text an agent
  already has; it is split the same way.
- **Found by its title and its words.** `search` returns the matching
  sources after the concepts, as `type: "Source"` hits with their `part`:
  first the sources whose title matches (stemmed, like a concept's), then
  those whose text does; `sources: false` leaves them out. A picture or a
  scanned PDF has no words to match: give it a title that says what it
  shows, and the concepts written from it lead to it (`stored_sources`).
- **Citing it.** Put the returned `cite` in `sources` of each concept
  written from it: the page's URL, or `source:<id>`. `get_concept` lists a
  concept's kept sources in `stored_sources`.
- **Reading it.** `get_source` with `ref` returns the source, the concepts
  citing it, its `download_url`, and its first part (about a page); `part`
  reads on, and `query` finds passages (in one source, or in all without
  `ref`). A file's own part says what it is (`media`: a picture, or on an
  older source a run of PDF pages); a picture up to 1 MB also comes back as
  an image.
- **Its file.** A file's link is librocat's own (`/files/…` on the Convex
  deployment's site), signed, and lasts an hour or two: reading the source
  again gives a new one. A file over 16 MB comes as `download_parts`, links
  to fetch in order and join. On librocat.com
  each fetch counts its bytes against the library's file transfer a month.
- **When it changes.** Adding new text for a kept URL, or for an `id`,
  replaces the text (a file's own parts stay: add a picture's description
  this way) and puts the concepts citing it up for review, as `files_changed` does
  for code.
- **Room.** Files and text count together: 100 MB a library on Free, 5 GB on
  Individual, 25 GB on Team, and one file up to 50 MB on Free and 200 MB on
  paid plans (a self-hosted librocat has no cap). One source's text holds up
  to 2 MB, about 1,000 pages. Deleting a source deletes its file.
- **The reading list** (paid plans). `add_source` with only a URL as
  `location`, or "Save a link" on the dashboard's Library › Sources: librocat
  fetches the page and keeps its text. A source no concept cites yet is
  unread: `get_source` lists those first, and Libro's report names them.
- **Source watch** (paid plans). Libro's weekly review fetches again the kept
  pages concepts cite (up to 50 a review, each at most once a week). A page
  whose text changed replaces its copy, and Libro reads what changed against
  each citing concept's title and description: the ones it judges affected
  come up for review, with a proposal on the shelf naming the page. When Libro's model
  can't be asked, every citing concept comes up.
- **What librocat fetches.** Only those two, and only public http(s) pages
  (`convex/fetchGuard.ts`): never a private or link-local address, checked
  again at connect time and on every redirect, at most 10 s and 5 MB a page,
  HTML or text. A self-hosted librocat can allow private addresses with
  `LIBROCAT_FETCH_PRIVATE=1`.

## Notes

- **Shelves.** `search` and `list` take `shelf` (the leading directory of
  concept ids, `"acme"` for `acme/...`): one library, many shelves. A project
  reads its own shelf first and the whole library second. Split a library
  only when access must differ (docs/okf.md §Shelves).
- **Several libraries.** An agent works in one: the library its person
  picked when they approved it (else their default library), or the one
  `/mcp?library=<slug>` names, which wins. `status` says which library this
  is (`library`) and lists the others (`libraries`). See docs/cloud.md
  §Several libraries.

- **Author entry** (Cutter's object D). `search` and `list` take `author`:
  only concepts that writer wrote: everyone who wrote a revision (the
  cataloger aside), a member by email (or `human:<email>`), `me`, an agent
  by its name (`Claude Code`), or `process:libro`. `get_concept` lists them
  as `authors`, people by email.
- **Writes** (`ingest`, `update`, `delete`) edit Convex rows and
  update the index in the same call. Every write also appends a revision.
- **`possible_duplicates`.** When `ingest` creates a concept (not when it
  overwrites one, and never on `update`), it first asks the catalog index
  for the existing concepts nearest to the new one's title and description:
  stemmed, through the thesaurus, the title's words first. Up to 3 come
  back, not deprecated and never the thesaurus, as `{ id, title,
  description }`; with none, the field is left out. librocat calls no model
  for it: the agent that wrote the concept judges whether one is the same
  subject, and `update`s it (deleting the new one) or `propose`s a merge.
  A batch compares its first 20 concepts, so one request reads a bounded
  part of the index.
- **Revisions.** `get_concept` with `history: true` reads the revisions
  table: `history[]`, newest first, each with its `revision` (the sequence
  number), `kind`, and who wrote it. `get_concept` with `revision` returns
  `{ id, revision }`, that revision's `frontmatter` and `body`.
- **`delete`** removes one concept. Links from other concepts to it become
  broken links (`review_shelf`'s `weeding` lists them) until you fix or remove them.
- **Ids are never reused by default** (a library's accession numbers,
  Dana, ch. XIX). A deleted id, and the old id of a renamed concept, are
  retired: `ingest` never derives one again (it bumps to `-2`), and reading
  one says what became of it (`concept not found: x (deleted on 2026-09-20
  ("Title"))`, or `(renamed to y on …)`). An explicit `id` may still take a
  retired id; the result says so in `reused`. The library keeps them per
  workspace and writes them into the export as `log.md` (OKF's update log).
- **Supersession.** `update` with `superseded_by` retires a concept in favor
  of another (a "see" reference): status becomes `deprecated` unless given,
  `get_concept` and `search` return `superseded_by`, and `search` sinks
  deprecated hits below live ones unless you filter on `status`.
- **Thesaurus.** The controlled vocabulary lives in one concept (`thesaurus`,
  type `Thesaurus`, `terms` in frontmatter), shaped like a library thesaurus
  (ANSI/NISO Z39.19): broader (BT), narrower (NT), related (RT, "see also"),
  and use-for (UF) terms, plus a scope note (SN) per tag. Writes map
  `use_for` synonyms onto the preferred tag; `search` expands a preferred
  tag with its narrower terms and a synonym with its preferred tag; a `tag`
  filter on `search` or `list` includes every narrower term below the tag.
  Cataloging reads scope notes when it picks tags, and files under
  the most specific tag (a broader tag goes when a narrower one applies).
- **The ready-reference file.** Every `search` is filed as a
  question, with what it found and the concept the agent opens next (its
  answer). Asked again, the question gets that answer as its first hit,
  marked `ready_reference: true`. What found no answer is in Libro's report
  (every week on paid plans, once a month on Free). Questions are kept 90
  days; one that looks like it carries a secret is never kept.
- **Review dates.** `stale_after` (OKF's lifecycle field) is when a concept
  should be checked again: an ISO date such as `2026-12-31`, set on anything
  time-bound (a plan, a price, a version, an owner). Every summary in
  `search`, `list`, and `get_concept` carries `stale_after` and `stale`
  (true once the date has passed), so an agent can tell a concept that may
  be outdated. `review_shelf`'s `weeding` lists them under `stale`, and Libro puts each
  on the review shelf. The library also suggests dates: after each review, Libro
  reads what changed and proposes a review date, the day after a date a
  concept writes out, or as Libro finds it states a schedule, a price, a
  version, or an owner. `decide` may set another date. `update` with `verify: true`
  records an OKF `verified` event (who checked, when) and moves a date that
  has passed 90 days ahead, unless you give a new `stale_after`.
- **Lists of additions.** The root finding aid (`list` in Markdown, the
  bundle's front-page `index.md`) opens with "New in the last 7 days":
  what arrived, newest first, from each concept's creation.
- **Code links** (#24's stale detection). `ingest` and `update` take
  `sources`: the code or documents a concept describes, as paths from the
  repository root (`src/auth/login.ts`; a directory ends in `/`) or GitHub
  and GitLab links, stored as OKF `sources` (§5.1). To catalog a repository,
  the agent reads it and `ingest`s a concept per module or component, naming
  its files in `sources`. After a commit, merge,
  or pull request, `files_changed` with the touched `paths` puts every live
  concept whose `resource` or `sources` cover one up for review: its review
  date becomes now (so `stale: true` everywhere), the matching sources get
  `last_modified`, and the library files it on Libro's review shelf
  with the file and commit (once, however often it is reported). `shelf`
  limits it to one project's concepts. The agent calls it after a commit,
  with the changed paths; there is no Git hook.
- **Catalog provenance.** When cataloging fills a blank
  description or tags, the concept's frontmatter says how in `cataloged`:
  `description: transcribed` (a sentence copied from the body) and `tags:
  selected` (from the library's vocabulary), with the model in `by`. Older
  concepts may say `generated`, from before cataloging stopped writing. The
  entry goes when a writer changes that field.
- **Body cap.** A concept body is at most 16 KB on librocat.com (64 KB
  self-hosted); the error says "summarize, split, and link". Its catalog
  record (title, description, tags, sources) holds at most 4 KB, and it
  links to at most 200 concepts (16 KB and 1,000 self-hosted); the
  thesaurus holds at most 64 KB.
- **Lifecycle `status`** is `draft`, `stable` (default), or `deprecated`.
  `ingest` and `update` take it; anything else is refused before the tool
  runs. `search` and `list` filter on it.
- **`status`** (the tool) reports `links`, `plan`, `max_concepts`,
  and `index_credits`, and on librocat.com `monthly` (what's left of the
  library's calls, writes, and file transfer a month).
- **Rate limits.** Writes and searches are limited per library, per minute
  (Free 60, Individual 300, Team 600). Over the limit, the call says when to
  try again. On librocat.com every call also counts against the library's
  calls a month by what it reads: once, and once more per 256 KB past the
  first (docs/cloud.md).
- **Bounded reads.** `search` returns at most 50 hits; a concept's `links`
  and `graph` read at most 100 links each way; `review_shelf` lists the oldest
  100 open proposals, and `status` counts them up to 100; `weeding` lists
  at most 200 of each kind. A pass over a big library (`weeding`, `list` in
  Markdown, `files_changed`) covers 5,000 concepts or about 4 MB and says
  what it covered.
- **A move** (`update` with `new_id`) is authority control from library science: it moves the concept
  and rewrites every inbound link (and pins the moved body's relative links),
  so a rename never orphans a link. A concept more than 500 concepts link to
  isn't moved (each linker is rewritten in one transaction): write the new
  one and supersede the old.
- **`status`** also returns `by_type` and `by_tag` counts — the live
  vocabulary. Agents check it before coining a new type or tag.
- **Circulation.** `get_concept` records `last_accessed_at` and
  `access_count` per concept — the usage signal behind "never retrieved"
  weeding — and reports `indexed_at` when automatic indexation filled the
  record.
- **Automatic indexation.** An `ingest`/`update` that leaves a concept
  without a description or tags schedules the cataloger (Libro), which spends
  one of Libro's credits on librocat.com (see [pricing](https://librocat.com/#pricing))
  when it fills something, and gives it back when it can pick nothing: that
  field stays blank for the agent to write.
- **Errors** come back as a JSON `{"error": "..."}` tool result, never a crash.
- **Ids are confined.** An id that escapes the bundle (`../x`) is refused, and
  ids that map to OKF-reserved filenames (`index.md`, `log.md`) are refused or
  bumped.
