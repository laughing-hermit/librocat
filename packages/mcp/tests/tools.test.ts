/**
 * The tools that do more than one job (get_concept's links and history,
 * update's move, list's index, review_shelf's weeding, set_term,
 * files_changed) reach the backend with the right request: a client calls
 * each one over an in-memory transport, and a fake backend records the call.
 */

import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport, McpServer } from "@modelcontextprotocol/server";
import { expect, test } from "vitest";
import { type Backend, registerTools } from "../src/tools.ts";

async function connected() {
  const calls: [string, unknown[]][] = [];
  // Every method records its name and arguments, and answers with its name.
  const backend = new Proxy({} as Backend, {
    get:
      (_, name: string) =>
      (...args: unknown[]) => {
        calls.push([name, args]);
        return { called: name };
      },
  });
  const server = new McpServer({ name: "librocat", version: "0.0.0" });
  registerTools(server, backend);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(clientSide);
  const call = async (name: string, args: Record<string, unknown>) => {
    calls.length = 0;
    const res = await client.callTool({ name, arguments: args });
    const text = (res.content as { type: string; text: string }[])[0]?.text ?? "null";
    return { result: JSON.parse(text), calls: [...calls] };
  };
  return { client, call };
}

test("get_concept asks for the history, or one revision", async () => {
  const { client, call } = await connected();
  expect((await call("get_concept", { id: "a" })).calls).toEqual([
    ["getConcept", ["a", { history: undefined, revision: undefined }]],
  ]);
  expect((await call("get_concept", { id: "a", history: true })).calls).toEqual([
    ["getConcept", ["a", { history: true, revision: undefined }]],
  ]);
  expect((await call("get_concept", { id: "a", revision: "3" })).calls).toEqual([
    ["getConcept", ["a", { history: undefined, revision: "3" }]],
  ]);
  await client.close();
});

test("update carries new_id with the other fields", async () => {
  const { client, call } = await connected();
  expect((await call("update", { id: "a", new_id: "b", title: "B" })).calls).toEqual([
    ["update", ["a", { new_id: "b", title: "B" }]],
  ]);
  await client.close();
});

test("list in markdown returns the finding aids", async () => {
  const { client, call } = await connected();
  expect((await call("list", { format: "markdown", dir: "ops" })).calls).toEqual([
    ["findingAid", [{ dir: "ops" }]],
  ]);
  expect((await call("list", { tag: "x" })).calls[0]?.[0]).toBe("list");
  await client.close();
});

test("review_shelf passes the weeding window", async () => {
  const { client, call } = await connected();
  expect((await call("review_shelf", {})).calls).toEqual([
    ["reviewShelf", [{ kind: undefined, limit: 50, days: 90 }]],
  ]);
  await client.close();
});

test("thesaurus only reads; set_term sets or removes one entry", async () => {
  const { client, call } = await connected();
  expect((await call("thesaurus", {})).calls).toEqual([["thesaurus", []]]);
  const set = await call("set_term", { tag: "k8s", use_for: ["kubernetes"] });
  expect(set.calls).toEqual([
    [
      "setTerm",
      [
        "k8s",
        {
          broader: undefined,
          narrower: undefined,
          related: undefined,
          use_for: ["kubernetes"],
          scope_note: undefined,
        },
      ],
    ],
  ]);
  expect((await call("set_term", { tag: "k8s", remove: true })).calls).toEqual([
    ["setTerm", ["k8s", null]],
  ]);
  await client.close();
});

test("files_changed reports the paths and the commit", async () => {
  const { client, call } = await connected();
  const res = await call("files_changed", { paths: ["src/a.ts"], commit: "abc" });
  expect(res.calls).toEqual([
    ["filesChanged", [["src/a.ts"], { commit: "abc", shelf: undefined }]],
  ]);
  expect(res.result).toEqual({ called: "filesChanged" });
  await client.close();
});
