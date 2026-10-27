/** Connect's install lines (site.ts): each library's address is one shell word, in zsh too. */

import { expect, test } from "vitest";
import { codingAgents, everyAgentCommands, MCP_URL } from "../src/lib/site";

test("the four coding agents, each with its own plugin install", () => {
  expect(codingAgents.map((c) => c.agent)).toEqual([
    "Claude Code",
    "Codex",
    "Cursor",
    "GitHub Copilot",
  ]);
});

test("every agent at once: the plugin, else MCP + Skills, one tab per package manager", () => {
  expect(everyAgentCommands()[0]).toEqual({
    pm: "npm",
    plugin: "npx plugins add laughing-hermit/librocat",
    mcp: "npx add-mcp https://librocat.com/mcp --name librocat -g",
    skills: "npx skills add laughing-hermit/librocat -g",
  });
  expect(everyAgentCommands().map((t) => t.plugin)).toEqual([
    "npx plugins add laughing-hermit/librocat",
    "pnpm dlx plugins add laughing-hermit/librocat",
    "yarn dlx plugins add laughing-hermit/librocat",
    "bunx plugins add laughing-hermit/librocat",
  ]);
});

test("at a library's own address: MCP + Skills, the address quoted", () => {
  // zsh reads an unquoted `?` as a pattern and stops: "no matches found".
  const second = `${MCP_URL}?library=acme`;
  expect(everyAgentCommands(second)[0]?.mcp).toBe(`npx add-mcp "${second}" --name librocat -g`);
  expect(everyAgentCommands("http://localhost:3000/mcp")[3]?.mcp).toBe(
    "bunx add-mcp http://localhost:3000/mcp --name librocat -g",
  );
});
