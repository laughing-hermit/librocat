/**
 * The cataloging pipeline, with the AI Gateway stubbed: Jev selects a
 * sentence from the concept and tags from the library's vocabulary, and
 * nothing is written. What Jev can't pick stays blank for the person's agent.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { catalog, jevQuestions, vocabularyFor } from "../convex/indexation";

type Answers = Record<
  string,
  { type: string; probability?: number; choice?: string; probabilities?: Record<string, number> }
>;

/** A stub gateway: evaluate answers from `jev`. */
function stubGateway(jev: (q: Record<string, unknown>) => Answers | null) {
  const calls: string[] = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    calls.push(url.endsWith("/evaluate") ? "evaluate" : url);
    const answers = jev(body.questions);
    if (!answers) return new Response("down", { status: 503 });
    return Response.json({ answers, providerMetadata: { gateway: { cost: "0.00001" } } });
  });
  return calls;
}

const concept = {
  type: "Note",
  title: "Token refresh",
  description: null,
  tags: [],
  body: "Refresh tokens rotate on every use, and a reused one revokes the whole family.",
};
const yes = (probability: number) => ({ type: "boolean", probability });

beforeEach(() => {
  process.env.AI_GATEWAY_API_KEY = "test";
  process.env.LIBROCAT_AI_GATEWAY_URL = "http://gateway.test/v1";
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.AI_GATEWAY_API_KEY;
  delete process.env.LIBROCAT_AI_GATEWAY_URL;
});

describe("vocabularyFor", () => {
  test("the concept's shelf first, then use, then the thesaurus's unused terms", () => {
    const docs = [
      { cid: "api/a", title: "A", tags: ["auth"], status: "stable" },
      { cid: "web/b", title: "B", tags: ["css", "auth"], status: "stable" },
      { cid: "web/c", title: "C", tags: ["css"], status: "stable" },
      { cid: "web/old", title: "Old", tags: ["css"], status: "deprecated" },
      { cid: "api/self", title: "Self", tags: ["self"], status: "stable" },
    ];
    const th = { auth: { scope_note: "Sign-in and tokens." }, oauth: {} };
    const v = vocabularyFor("api/self", docs, th);
    expect(v.map((t) => t.tag)).toEqual(["auth", "css", "oauth"]);
    // Scope notes ride along; the shelf list shows same-shelf titles first.
    expect(v[0]).toEqual({ tag: "auth", scope_note: "Sign-in and tokens.", filed: ["A", "B"] });
    // Deprecated concepts and the concept itself are not examples.
    expect(v[1]?.filed).toEqual(["B", "C"]);
    expect(v.find((t) => t.tag === "self")).toBeUndefined();
  });

  test("tag questions point at the state, not at inline text", () => {
    const q = jevQuestions(
      concept,
      ["A sentence of the concept, long enough."],
      [{ tag: "auth", filed: [] }],
    );
    expect(Object.keys(q)).toEqual(["description", "tag0"]);
    expect(q.tag0?.instructions).toContain("`tags[0].tag`");
    expect(q.tag0?.instructions).toContain("`tags[0].scope_note`");
  });
});

describe("cataloging, Jev only", () => {
  test("Jev's selection is kept, and specific entry drops the broader tag", async () => {
    const calls = stubGateway(() => ({
      description: { type: "choice", choice: "c0", probabilities: { c0: 0.9, none: 0.1 } },
      tag0: yes(0.9),
      tag1: yes(0.8),
    }));
    const out = await catalog(
      concept,
      [
        { tag: "auth", filed: [] },
        { tag: "oauth", filed: [] },
      ],
      { auth: { narrower: ["oauth"] } },
    );
    expect(out).toEqual({
      description: concept.body,
      tags: ["oauth"],
      how: { description: "transcribed", tags: "selected" },
      by: ["typesafe-ai/jev"],
    });
    expect(calls).toEqual(["evaluate"]);
  });

  test("nothing Jev can pick: nothing is written, and the credit comes back", async () => {
    const calls = stubGateway(() => ({ description: { type: "choice", choice: "none" } }));
    expect(await catalog(concept, [], {})).toBeNull();
    expect(calls).toEqual(["evaluate"]);
  });

  test("when Jev cannot be asked, nothing is written, and it says so: the daily job tries again", async () => {
    stubGateway(() => null);
    expect(await catalog(concept, [{ tag: "auth", filed: [] }], {})).toBe("unreachable");
  });

  test("a self-hosted librocat without Jev makes no call", async () => {
    process.env.LIBROCAT_SELF_HOST = "1";
    delete process.env.AI_GATEWAY_API_KEY;
    try {
      const calls = stubGateway(() => ({ tag0: yes(0.9) }));
      expect(await catalog(concept, [{ tag: "auth", filed: [] }], {})).toBeNull();
      expect(calls).toEqual([]);
    } finally {
      delete process.env.LIBROCAT_SELF_HOST;
    }
  });
});
