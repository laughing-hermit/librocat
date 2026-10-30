# Changelog

All notable changes to librocat. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/). Until 1.0.0, a minor version can
change a tool argument. A patch version never does.

## [Unreleased]

- When a Team ends, its libraries are its owner's alone: the other members
  are paused, with their roles kept, until the libraries are on Team again.
  Their agents stop with the reason, and their dashboard says so.
- When a paid plan ends, Individual or Team, Free's limits apply. 30 days
  on, the libraries past Free's one pause: no agent reaches them, and they
  can still be opened, exported, or deleted. A plan brings one back. What's
  still paused or over Free's limits after 12 months is deleted, with
  emails when the plan ends and 30 and 7 days before. Nothing within
  Free's limits is.

## [0.0.0] - 2026-10-27

The first version. librocat is the open-source knowledge base for AI
agents, managed by Libro, an AI librarian.

- librocat at `librocat.com`, free to start, or self-hosted with
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
  proposes reviews and retirements for a person to approve, and checks the
  merges an agent drafts.
- Search goes by words, through the library's thesaurus; your agent writes
  the searches.
- The Agent Plugin carries no version, so agents pick up every commit to
  `main`.
- Export and Import, in Settings, move a library between librocat.com and
  a self-hosted librocat, attached files included.

[Unreleased]: https://github.com/laughing-hermit/librocat/compare/v0.0.0...HEAD
[0.0.0]: https://github.com/laughing-hermit/librocat/releases/tag/v0.0.0
