# Architecture

One TypeScript monorepo (pnpm workspaces + Turborepo + Biome). One service,
run two ways, like Supabase: librocat at librocat.com, or self-hosted
with Docker (`self-host/`, SELF_HOSTING.md). One tool surface.

```text
packages/mcp/src/tools.ts               ← ONE tool table (MCP SDK v2)
packages/core/src/format.ts             ← ONE pure core: OKF text, ids, links,
            │                              snippets, statuses, weeding, stats, graph
Service: apps/web/src/app/mcp/route.ts (Vercel or self-host/, mcp-handler, Streamable HTTP, OAuth)
          → apps/web/convex/mcp.ts (functions authenticated by the agent's OAuth token)
          → apps/web/convex/model.ts (storage glue over @librocat/core/format + /library)
          → Convex tables (concepts, links, revisions, proposals)
          → convex/indexation.ts (Libro's cataloger: Jev selects) + convex/libro.ts (Libro's weekly review shelf and Jev's screens, crons.ts)
        source of truth: the workspace (export gives the OKF files back)
            ▲
            │
apps/web (Next.js dashboard: control plane, read-only browsing, Export and Import)
plugin/ (the Agent Plugin: the MCP entry and the skills)
```

## Principles

- **The rules live once, in the core.** Everything that is not storage lives
  in `packages/core`: `format.ts` (pure: the OKF text format, ids and
  their canonical form, link extraction and retargeting, snippets, statuses,
  frontmatter construction, the weeding rules, the status counts, the graph
  walk) and `library.ts` (pure: thesaurus, query expansion, finding aids,
  shelves), with `sources.ts` for kept sources and `stem.ts` for word stems.
  All are free of `node:*` imports, so the Convex runtime imports them as
  `@librocat/core/format`, `@librocat/core/library`, and
  `@librocat/core/sources`, and wraps them around Convex rows
  (`apps/web/convex/model.ts`); the dashboard's Export and Import write and
  read OKF files with them. `packages/core/tests/format.test.ts`
  is the contract. A new pure rule goes into `format.ts`, never into
  `model.ts`.
- **OKF is the format; the index is derived and rebuildable.** The source of
  truth is the workspace, exported as OKF files; Export gives them as a zip
  (unzip it into a Git repo), and Import reads one into any librocat.
- **The agent writes; librocat catalogs and proposes.** librocat does what
  an agent can't do well alone: memory shared across sessions, agents,
  machines, and people; search at library scale; a controlled vocabulary,
  links, and revisions; unattended checks of the whole library. Its server
  runs one model, Jev, which selects and judges and composes no text: it
  fills in a description an agent left out with one of the concept's own
  sentences, and tags from the library's vocabulary, and Libro proposes
  everything else. Concepts, their descriptions and tags, and merges are the
  person's agent's, with the model it already uses, and so is the
  searching; it works Libro's review shelf through `review_shelf`,
  `propose`, and `decide`.
- **The MCP is the only full read/write interface.** The dashboard manages the
  system (billing, connected agents, the team, export/delete) and browses
  read-only.
- **Stateless remote MCP, OAuth 2.1.** Every request carries the agent's
  access token (Better Auth on Convex is the authorization server,
  `apps/web/convex/auth.ts`); the route verifies it (mcp-handler
  `withMcpAuth`), Convex verifies it again, and every Convex function
  resolves the workspace from the user it names. No session state, no API
  tokens.

## Packages

| Path | What it is |
|------|------------|
| `packages/core` | The OKF format (`format.ts`), the library rules (`library.ts`: thesaurus, tag normalization, finding aids), kept sources (`sources.ts`), and word stems (`stem.ts`); `./format`, `./library`, and `./sources` are runtime-neutral and shared with the Convex backend ([its README](../packages/core/README.md)) |
| `packages/mcp` | `@librocat/server`: only the MCP tool table (`src/tools.ts`, `@librocat/server/tools`) and `version.ts`, which `apps/web` serves at `/mcp` |
| `apps/web` | Next.js dashboard + landing (shadcn/ui), the remote MCP route (`src/app/mcp`), Convex backend in `convex/` |
| `plugin/` | The Agent Plugin ([agent-plugins.org](https://agent-plugins.org)): the remote MCP entry and `skills/`, the Agent Skills ([agentskills.io](https://agentskills.io)); the root `skills` links there |

## Search

Search goes by words, and the agent drives it, the way an LLM wiki is read:
it writes keyword searches, reads the hits, and searches again with other
words when the first ones miss. librocat's part is a catalog worth
searching. There is no search by meaning: no embedding model and no vectors
(since 2026-10-20).

- Two Convex search indexes over stemmed text, fused by reciprocal rank
  (`model.ts search`):
  - One is on each concept's catalog record (title, description, tags,
    `concepts.catalogStem`); a match there weighs twice, so a concept
    cataloged under the words comes before one that only mentions them.
  - The other is on all its text (`bodies.searchStem`). Body and search
    text live apart from the catalog record, so the metadata paths stay
    small.
  - Both are filtered by `workspaceId`, `type`, and `status`.
- Convex doesn't stem, so librocat stores stems (the Porter stemmer,
  `@librocat/core` `stemText`) and stems each query the same way: "rotated
  keys" finds "key rotation". `migrations:backfillStems` fills the stems of
  rows written before them.
- The tag thesaurus expands the query first (`@librocat/core/library`,
  which, like every core module Convex imports, stays free of `node:*`): a
  preferred tag brings its narrower terms, and a synonym (`use_for`) its
  preferred tag, so a question in other words still reaches the concepts
  filed under the library's own tags. A `tag` facet maps through it too.
- Deprecated hits sink below live ones unless `status` is filtered. Every
  hit carries a bracketed `[match]` snippet on the reader's own words.
- Kept sources come after the concepts (`type: "Source"` hits): first
  those whose title matches (`sources.titleStem`, stemmed the same way),
  then those whose text does (`sourceParts`, `sources.ts sourceHits`). So a
  picture or a scanned PDF, which has no text, is found by its title, and
  by the concepts written about it. `migrations:indexSourceTitles` indexes
  the titles of sources kept before.
- A question asked again with the same content words gets its earlier
  answer first (the ready-reference file, docs/cloud.md).

**Measured, as history.** From 2026-09-27 to 2026-10-20, search also ranked
by meaning, with embeddings (Gemini Embedding on librocat.com). On 2026-09-28 an
agent's own searches were measured (Gemini 3.8 Flash played the agent, with
up to two retries; librocat's docs as 137 concepts, 69 questions):

- with its retries, the agent found the right concept in the top three 93%
  of the time by words alone, against 95% with meaning (before stemming);
- its first search put the right concept first 75% of the time by words
  alone, after stemming and the catalog record's weight shipped (61%
  before), against 84% with meaning.

Agents writing keyword searches and trying again close most of the gap,
and the catalog record and the thesaurus do the rest, so librocat searches
by words alone: no embedding model to run or pay for, no per-model cutoffs,
and no query sent to a second provider.
