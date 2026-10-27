# Install librocat

The same ways as on [librocat.com/connect](https://librocat.com/connect) and in
the dashboard: your coding agent's own install, or every agent at once with
your package manager; then the desktop agents that work on your computer. The
first time an agent uses librocat, your browser opens to sign in or make a free
account. No API keys.

## Coding agents

**Claude Code**, one after the other:

```text
/plugin marketplace add laughing-hermit/librocat
/plugin install librocat@librocat
```

**Codex**, in a terminal:

```bash
codex plugin marketplace add laughing-hermit/librocat
codex plugin add librocat@librocat
```

**Cursor**, in its chat:

```text
/add-plugin https://github.com/laughing-hermit/librocat
```

**GitHub Copilot**, in a terminal, with the Copilot CLI:

```bash
copilot plugin install laughing-hermit/librocat:plugin
```

## Every agent at once

With your package manager, in every agent on your computer.

### With Agent Plugins

[Agent Plugins](https://agent-plugins.org) installs librocat's plugin, skills
included, in every agent that takes them: Claude Code, Codex, GitHub Copilot
CLI, Grok Build, Kimi Code, and Cursor and GitHub Copilot in VS Code when their
`cursor` and `code` commands are installed.

**npm**

```bash
npx plugins add laughing-hermit/librocat
```

**pnpm**

```bash
pnpm dlx plugins add laughing-hermit/librocat
```

**yarn**

```bash
yarn dlx plugins add laughing-hermit/librocat
```

**bun**

```bash
bunx plugins add laughing-hermit/librocat
```

### Without Agent Plugins: MCP + Skills

For OpenCode, OpenClaw, Hermes, Windsurf, Gemini CLI, and any agent that speaks
[MCP](https://modelcontextprotocol.io) without Agent Plugins, or a
self-hosted librocat at its own address. The first command adds
the server to every agent it finds, the second the
[Agent Skills](https://agentskills.io):

**npm**

```bash
npx add-mcp https://librocat.com/mcp --name librocat -g
npx skills add laughing-hermit/librocat -g
```

**pnpm**

```bash
pnpm dlx add-mcp https://librocat.com/mcp --name librocat -g
pnpm dlx skills add laughing-hermit/librocat -g
```

**yarn**

```bash
yarn dlx add-mcp https://librocat.com/mcp --name librocat -g
yarn dlx skills add laughing-hermit/librocat -g
```

**bun**

```bash
bunx add-mcp https://librocat.com/mcp --name librocat -g
bunx skills add laughing-hermit/librocat -g
```

[add-mcp](https://github.com/neon-solutions/add-mcp) writes each agent's MCP
config, and [skills](https://github.com/vercel-labs/skills) copies the three
skills from this repository. Without `-g`, both write the project's config
instead, to commit for your team. `-a <agent>` picks the agents, and `-y`
skips the questions. With several libraries, your agent asks which one
when it signs in. For a self-hosted librocat, use its address instead of
`https://librocat.com/mcp`.

To add one agent at a time, add the server, then the skills with
`npx skills add laughing-hermit/librocat`:

<details>
<summary><strong>Claude Code</strong></summary>

```bash
claude mcp add --transport http librocat https://librocat.com/mcp
```

</details>

<details>
<summary><strong>GitHub Copilot</strong></summary>

In VS Code's `.vscode/mcp.json`:

```json
{ "servers": { "librocat": { "type": "http", "url": "https://librocat.com/mcp" } } }
```

</details>

<details>
<summary><strong>Codex</strong></summary>

```bash
codex mcp add librocat --url https://librocat.com/mcp
```

</details>

<details>
<summary><strong>Cursor</strong></summary>

In `~/.cursor/mcp.json`:

```json
{ "mcpServers": { "librocat": { "url": "https://librocat.com/mcp" } } }
```

</details>

<details>
<summary><strong>OpenCode</strong></summary>

In `opencode.json`:

```json
{ "mcp": { "librocat": { "type": "remote", "url": "https://librocat.com/mcp" } } }
```

</details>

<details>
<summary><strong>Antigravity</strong></summary>

Antigravity doesn't read the skills from where `npx skills add` puts them, so
its plugin carries the server and the skills together. This copies the
repository's `plugin/` folder:

```bash
npx giget gh:laughing-hermit/librocat/plugin ~/.gemini/config/plugins/librocat --force
```

For a second library or a self-hosted librocat, then set `serverUrl` in that
folder's `mcp_config.json` to its address.

</details>

<details>
<summary><strong>OpenClaw</strong></summary>

```bash
openclaw mcp add librocat --url https://librocat.com/mcp --transport streamable-http --auth oauth
openclaw mcp login librocat
```

</details>

<details>
<summary><strong>Hermes</strong></summary>

```bash
hermes mcp add librocat --url https://librocat.com/mcp --auth oauth
```

</details>

<details>
<summary><strong>Any other MCP client</strong></summary>

```json
{ "mcpServers": { "librocat": { "url": "https://librocat.com/mcp" } } }
```

An agent that only runs local (stdio) servers reaches it through
[mcp-remote](https://www.npmjs.com/package/mcp-remote):

```json
{ "mcpServers": { "librocat": { "command": "npx", "args": ["-y", "mcp-remote", "https://librocat.com/mcp"] } } }
```

</details>

## Desktop agents

The agents that work on your computer. Each installs librocat's plugin from
this repository, which brings the skills and the MCP together.

- **Claude Desktop** and Cowork: Customize › Plugins › Add marketplace, with
  `laughing-hermit/librocat`. Then install librocat from it, and connect its
  librocat connector on the plugin's Connectors tab.
- **ChatGPT**, in its desktop app: a Business or Enterprise admin opens Admin
  › Plugins › Add › Import marketplace, with
  `https://github.com/laughing-hermit/librocat`. Then members install librocat
  from Plugins, or the admin sets it to Installed. On a personal plan,
  ChatGPT's plugin directory will have it once librocat is listed.
- **Grok Bot** installs Cursor's plugins: a Cursor Teams admin opens Dashboard
  › Plugins & MCPs › Team Marketplaces › Add Marketplace › Import from Repo,
  with `https://github.com/laughing-hermit/librocat`. Then install librocat
  from Customize, or the admin makes it Required. On your own, Cursor's
  marketplace will have it once librocat is listed.

For a second library or a self-hosted librocat, which the plugin can't reach,
add its address as the agent's custom connector or MCP server instead: the MCP
without the skills.
