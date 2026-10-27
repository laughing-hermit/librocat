/**
 * Every tool carries a title and the three behavior hints hosts act on
 * (ChatGPT's directory requires readOnlyHint, destructiveHint, and
 * openWorldHint on each), as a client listing the tools sees them.
 */

import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport, McpServer } from "@modelcontextprotocol/server";
import { expect, test } from "vitest";
import { type Backend, registerTools, TOOLS } from "../src/tools.ts";

async function listedTools() {
  const server = new McpServer({ name: "librocat", version: "0.0.0" });
  // Listing never calls the backend.
  registerTools(server, {} as Backend);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(clientSide);
  const { tools } = await client.listTools();
  await client.close();
  return tools;
}

test("every tool has a title and all three behavior hints", async () => {
  const tools = await listedTools();
  expect(tools.map((t) => t.name).sort()).toEqual(Object.keys(TOOLS).sort());
  for (const t of tools) {
    expect(t.title, t.name).toBeTruthy();
    expect(typeof t.annotations?.readOnlyHint, t.name).toBe("boolean");
    expect(typeof t.annotations?.destructiveHint, t.name).toBe("boolean");
    expect(typeof t.annotations?.openWorldHint, t.name).toBe("boolean");
  }
});

test("only delete, set_term, and add_source can lose data; only add_source reaches the web", async () => {
  const tools = await listedTools();
  const where = (hint: "destructiveHint" | "openWorldHint") =>
    tools
      .filter((t) => t.annotations?.[hint])
      .map((t) => t.name)
      .sort();
  expect(where("destructiveHint")).toEqual(["add_source", "delete", "set_term"]);
  expect(where("openWorldHint")).toEqual(["add_source"]);
  const readers = tools.filter((t) => t.annotations?.readOnlyHint).map((t) => t.name);
  expect(readers.sort()).toEqual([
    "get_concept",
    "get_source",
    "graph",
    "list",
    "review_shelf",
    "search",
    "status",
    "thesaurus",
  ]);
});
