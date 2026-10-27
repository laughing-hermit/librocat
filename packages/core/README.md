# @librocat/core

The rules librocat runs on (Apache-2.0, TypeScript): the Open Knowledge Format
(OKF), the library science, and kept sources. It is pure: no I/O and no
`node:*` imports, so the Convex backend (`apps/web/convex`), the dashboard,
and the MCP tool table (`packages/mcp`) all import it as it is. Storage lives
in Convex; OKF files come and go through the dashboard's Export and Import,
which use this package to write and read them.

- `src/format.ts` (`@librocat/core/format`): the OKF text format (parse and
  dump a concept: YAML frontmatter and a Markdown body), concept ids (their
  canonical form, derived ids, reserved names), links (extracted, and
  retargeted on a rename), snippets, lifecycle statuses, the record of what
  cataloging filled in (`cataloged`), review dates (`stale_after`,
  `verified`), the code a concept describes (`sources`, and which concepts a
  changed file covers), the weeding rules, the status counts, the graph
  walk, and the check that refuses secrets. It re-exports the stemmer.
- `src/library.ts` (`@librocat/core/library`): the library science: the tag
  thesaurus (broader, narrower, related, and use-for terms with scope notes,
  after ANSI/NISO Z39.19), query expansion over it, tag normalization and
  Cutter's rule of specific entry, finding aids (each directory's `index.md`,
  with what arrived in the last seven days), shelves, and the update log of
  retired ids (`log.md`).
- `src/sources.ts` (`@librocat/core/sources`): kept sources: text cleaned
  and split into parts of about a page, content hashes, cites (`source:<id>`
  or a URL) and source ids, the secret check by line, a web page's readable
  text, and which files librocat keeps (text and pictures) or refuses (audio,
  video, anything else), with what to attach instead.
- `src/stem.ts`: the Porter stemmer behind word search (`stem`, `stemText`,
  `stemQuery`), exported through `format.ts`.
- `src/index.ts` (`@librocat/core`): all of the above in one import.

A new format or library-science rule goes here, never in the Convex model
(docs/architecture.md). `tests/format.test.ts` is the contract; `core`,
`sources`, and `stem` have their own suites.

```bash
pnpm test          # the test suite
```
