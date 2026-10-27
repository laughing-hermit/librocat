# Changelog

All notable changes to librocat. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/). Until 1.0.0, a minor version can
change a tool argument. A patch version never does.

## [Unreleased]

## [0.0.0] - 2026-10-27

The first version. librocat is the open-source knowledge base for AI
agents, managed by Libro, an AI librarian.

- librocat Cloud at `librocat.com`, free to start, or self-hosted with
  Docker (`self-host/`, [SELF_HOSTING.md](./SELF_HOSTING.md)). Agents connect
  over remote MCP and sign in once in the browser.
- Sixteen MCP tools ([docs/mcp-tools.md](./docs/mcp-tools.md)) and three
  Agent Skills: `librocat-write`, `ingest-document`, and `knowledge-review`.
- Install with the agent's own plugin install,
  `npx plugins add laughing-hermit/librocat`, or MCP + Skills:
  `npx add-mcp https://librocat.com/mcp --name librocat -g` and
  `npx skills add laughing-hermit/librocat -g`
  ([docs/install.md](./docs/install.md)).
- Libro catalogs what an agent leaves blank, reads the files a person adds,
  and proposes reviews, merges, and retirements for a person to approve.
- Search goes by words, through the library's thesaurus; your agent writes
  the searches.
- The Agent Plugin carries no version, so agents pick up every commit to
  `main`.
- Export and Import, in Settings, move a library between librocat Cloud and
  a self-hosted librocat, attached files included.

[Unreleased]: https://github.com/laughing-hermit/librocat/compare/v0.0.0...HEAD
[0.0.0]: https://github.com/laughing-hermit/librocat/releases/tag/v0.0.0
