<div align="center">
  <img src="apps/web/public/logo.svg" alt="Libro, the library cat, sitting on a book" width="128" />
  <h1>librocat</h1>
  <p><strong>The Open-Source Knowledge Base for AI Agents</strong></p>
  <p>
    Tell one agent once. Every agent remembers.<br />
    Claude Code, Codex, Cursor, and Copilot share one library, and so does every
    teammate's agent. Libro, our AI librarian, keeps it organized and current.
  </p>
  <p>
    <a href="https://librocat.com"><strong>librocat.com</strong></a>
    &nbsp;&nbsp;
    <a href="./SELF_HOSTING.md">Self-host</a>
    &nbsp;&nbsp;
    <a href="./docs">Docs</a>
  </p>
  <p>
    <img src="https://github.com/laughing-hermit/librocat/actions/workflows/ci.yml/badge.svg" alt="CI" />
    <img src="https://img.shields.io/badge/license-Apache--2.0-1f744f" alt="Apache-2.0" />
  </p>
</div>

## How it works

1. **Install it.** One or two commands in your coding agent (below). It signs
   in once, in your browser. No API keys to copy.
2. **Tell it once.** Say "remember this": a decision, a runbook, a document.
   Your agent files it in your library.
3. **Every agent knows.** Ask any agent later. It finds the answer, and
   Libro flags what's out of date.

## What you get

- **Every agent, every teammate.** You on Claude Code, a teammate on Cursor,
  another on Codex or Copilot: one library, and each agent sees what the
  others saved.
- **Kept current by Libro.** Libro catalogs what your agents save, then flags
  duplicates and stale answers. You approve or dismiss.
- **Your documents, searchable.** Attach PDFs, Word files, spreadsheets,
  slides, pictures, and web pages. Agents find them by their words and
  titles, and cite them.
- **Yours to keep.** Plain Markdown in Google's
  [Open Knowledge Format](https://github.com/GoogleCloudPlatform/open-knowledge-format)
  that you can export and import anytime. Open source, and free to self-host.

## Install

In your coding agent. The first time it uses librocat, your browser opens to
sign in or make a free account. No API keys.

| Agent | Install |
| --- | --- |
| Claude Code | `/plugin marketplace add laughing-hermit/librocat`, then `/plugin install librocat@librocat` |
| Codex | `codex plugin marketplace add laughing-hermit/librocat`, then `codex plugin add librocat@librocat` |
| Cursor | `/add-plugin https://github.com/laughing-hermit/librocat`, in its chat |
| GitHub Copilot | `copilot plugin install laughing-hermit/librocat:plugin`, with the Copilot CLI |

Or every agent on your computer at once, with
[Agent Plugins](https://agent-plugins.org):

```bash
npx plugins add laughing-hermit/librocat
```

OpenCode, Windsurf, Gemini CLI, the desktop agents (Claude Desktop, ChatGPT),
any other MCP client, and a self-hosted librocat:
[docs/install.md](./docs/install.md), or
[librocat.com/connect](https://librocat.com/connect).

## Self-host

```bash
git clone https://github.com/laughing-hermit/librocat.git
cd librocat/self-host && ./setup.sh
npx add-mcp http://localhost:3000/mcp --name librocat -g
npx skills add laughing-hermit/librocat -g
```

The same site, dashboard, and MCP on your own server, with Docker or Podman.
No limits and no billing. Bring your own models, or none: it also runs
offline. See [SELF_HOSTING.md](./SELF_HOSTING.md). The dashboard's Export and
Import move a library between your server and librocat.com.

## Pricing

- **Free**: 1 library of 1,000 concepts, and 200 of Libro's credits
  a month.
- **Individual**: $12 a month per library ($10 billed yearly): 5,000
  concepts, and 500 credits a month.
- **Team**: $15 a person a month ($12.50 billed yearly), for 3 people or
  more: up to 10 libraries on one bill, 15,000 concepts, and 2,500 credits a
  month.

Self-hosting is free, with no limits. See
[librocat.com](https://librocat.com/#pricing).

## How it's built

librocat is an [LLM wiki](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f),
the pattern Andrej Karpathy described, for all your agents at once:

- **Sources** are what you attach: kept as they are, with their text read
  by code, and searchable by that text and their titles.
- **Concepts** are the wiki your agents write from them: Open Knowledge
  Format Markdown, each one citing its sources.
- **Libro** is the librarian: a controlled vocabulary, links, review dates,
  and a weekly review, run the way a library is
  ([library science](./docs/library-science.md)).

Read more: [the MCP tools](./docs/mcp-tools.md),
[the architecture](./docs/architecture.md), [OKF in librocat](./docs/okf.md),
and [the hosted librocat](./docs/cloud.md).

```text
apps/web          librocat.com: the landing page, the dashboard, the remote MCP,
                  and its Convex backend (apps/web/convex)
packages/core     OKF, the library rules, and sources, used by the backend
packages/mcp      the MCP tool table (src/tools.ts) that /mcp serves
plugin/           the Agent Plugin: the MCP entry and the skills
self-host/        Docker Compose for self-hosting
docs/             how it all works
```

## Develop

```bash
pnpm install
pnpm run build       # the Next.js build
pnpm test            # every unit suite
pnpm run e2e         # every end-to-end suite, on a throwaway local stack
pnpm run lint        # Biome, then the shadcn design rules
pnpm run plugin      # the Agent Plugin's manifests
```

See [DEVELOPERS.md](./DEVELOPERS.md) and [CONTRIBUTING.md](./CONTRIBUTING.md).
Security: [SECURITY.md](./SECURITY.md). Status:
[status.librocat.com](https://status.librocat.com). Changelog:
[GitHub Releases](https://github.com/laughing-hermit/librocat/releases), with
the notes from [CHANGELOG.md](./CHANGELOG.md).

Apache-2.0. © 2026 Laughing Hermit, Inc. librocat is a Laughing Hermit, Inc.
product.
