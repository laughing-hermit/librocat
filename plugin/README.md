# librocat Agent Plugin

librocat is the open-source knowledge base for AI agents: tell one agent
once, and every agent remembers. This folder is how it's installed,
following the
[Agent Plugins Standard](https://agent-plugins.org). It contains:

- **`mcp.json`**: the librocat MCP server, remote:
  `{ "type": "streamable-http", "url": "https://librocat.com/mcp" }`. There
  is no server to run and no key to paste. The agent signs you in through
  the browser on its first call (OAuth 2.1; the standard leaves that to the
  host) and always talks to the current version.
- **`plugin.json`**: the plugin manifest (`$schema` pins the standard version).
  Its `extensions["com.openai"]` holds the listing ChatGPT's and Codex's
  plugin directory shows.
- **`skills/`**: the three Agent Skills (`SKILL.md`) that teach an agent to
  write, attach, and review well.
- **`assets/`**: the librocat mark, for the directories' listings.
- **`.claude-plugin/plugin.json`**, **`.cursor-plugin/plugin.json`**,
  **`.plugin/plugin.json`**, **`.mcp.json`**: the same manifest in the forms
  Claude Code, Cursor, and the plugins CLI read.
- **`mcp_config.json`**: the server entry in Antigravity's form
  (`serverUrl`). With `plugin.json` and `skills/`, this folder is an
  Antigravity plugin too.

The repository root lists this folder in each host's marketplace
(`.claude-plugin/`, `.cursor-plugin/`, `.plugin/`, and Codex's
`.agents/plugins/`), so installing from the repository installs only this
folder. `pnpm run plugin` checks that every manifest agrees, and that the
listings keep to each directory's rules (`scripts/check-plugin.ts`).

## Install

The same ways as the repository's README, librocat.com/connect, and the
dashboard.

**Coding agents**, the four librocat focuses on, each its own way:

- **Claude Code:** `/plugin marketplace add laughing-hermit/librocat`, then
  `/plugin install librocat@librocat`.
- **Codex:** `codex plugin marketplace add laughing-hermit/librocat`, then
  `codex plugin add librocat@librocat`.
- **Cursor:** in its chat, `/add-plugin https://github.com/laughing-hermit/librocat`.
- **GitHub Copilot**, with the Copilot CLI:
  `copilot plugin install laughing-hermit/librocat:plugin`.

**Every agent at once, with a package manager.** With
[Agent Plugins](https://agent-plugins.org), every agent your terminal can find
that takes them (Claude Code, Codex, GitHub Copilot CLI, Grok Build, Kimi
Code, and Cursor and GitHub Copilot in VS Code when their commands are
installed), with the [plugins CLI](https://www.npmjs.com/package/plugins):

```bash
npx plugins add laughing-hermit/librocat      # or pnpm dlx / yarn dlx / bunx
```

**Without Agent Plugins: MCP + Skills.** For OpenCode, OpenClaw, Hermes,
Windsurf, Gemini CLI, and any agent that speaks
[MCP](https://modelcontextprotocol.io) without Agent Plugins. The first
command adds the server to the agents on your machine, the second the
[Agent Skills](https://agentskills.io):

```bash
npx add-mcp https://librocat.com/mcp --name librocat -g
npx skills add laughing-hermit/librocat -g
```

[add-mcp](https://github.com/neon-solutions/add-mcp) writes each agent's MCP
config; [skills](https://github.com/vercel-labs/skills) copies `skills/` from
this repository. Without `-g`, both write the project's config instead.
`-a <agent>` picks agents, `-y` skips the questions, and `pnpm dlx`,
`yarn dlx`, and `bunx` work too.

Or one agent at a time: `https://librocat.com/mcp` in its MCP settings (for
Claude Code, `claude mcp add --transport http librocat https://librocat.com/mcp`;
for OpenClaw, `openclaw mcp add librocat --url https://librocat.com/mcp
--transport streamable-http --auth oauth`, then `openclaw mcp login librocat`;
for Hermes, `hermes mcp add librocat --url https://librocat.com/mcp --auth
oauth`), then `npx skills add laughing-hermit/librocat`. For Antigravity,
`npx giget gh:laughing-hermit/librocat/plugin ~/.gemini/config/plugins/librocat --force`
copies this folder, in Antigravity's form.

**Desktop agents**, the ones that work on your computer, install this plugin
from the repository, which brings the skills and the MCP together:

- **Claude Desktop** and Cowork: Customize › Plugins › Add › Add
  marketplace, with `laughing-hermit/librocat`; then install librocat, and
  connect its connector on the plugin's Connectors tab.
- **ChatGPT**, in its desktop app: a Business or Enterprise admin imports
  `https://github.com/laughing-hermit/librocat` (Admin › Plugins › Add ›
  Import marketplace); members install librocat from Plugins. Without an
  admin, add `https://librocat.com/mcp` in the desktop app's Settings › MCP
  servers › Add server: the MCP without the skills.
- **Grok Bot** installs Cursor's plugins: a Cursor Teams admin imports the
  repository as a team marketplace (Team Marketplaces › Add Marketplace ›
  Import from Repo); each member adds librocat from Connect apps in Grok Bot's
  sidebar. On your own, Cursor's
  marketplace, once librocat is listed.

## A self-hosted librocat instead

This plugin connects to librocat Cloud. For a librocat you self-host with
Docker (SELF_HOSTING.md), install the same server entry and skills with its
URL:

```bash
npx add-mcp https://kb.example.com/mcp --name librocat -g
npx skills add laughing-hermit/librocat -g
```

For Antigravity, copy this folder as above, then set `serverUrl` in its
`mcp_config.json` to that URL. A desktop agent takes the URL as a custom
connector or MCP server: the MCP without the skills. With several
libraries, you pick one in your browser when the agent signs in; a
`?library=` URL (quoted, in zsh) pins one instead.

The skills work the same with either.
