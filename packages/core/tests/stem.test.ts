/** Word stems for search: the forms of a word meet, and the Porter stemmer's classic cases hold. */

import { expect, test } from "vitest";
import { stem, stemQuery, stemText } from "../src/stem.ts";

test("the forms of a word share a stem", () => {
  const same = (words: string[]) => expect(new Set(words.map(stem)).size, words.join(" ")).toBe(1);
  same(["deploy", "deploys", "deployed", "deploying"]);
  same(["rotate", "rotating", "rotation", "rotated"]);
  same(["connect", "connected", "connecting", "connection", "connections"]);
  same(["index", "indexes", "indexing"]);
  same(["policy", "policies"]);
});

test("the Porter stemmer's published examples", () => {
  const cases: Record<string, string> = {
    caresses: "caress",
    ponies: "poni",
    cats: "cat",
    agreed: "agre",
    plastered: "plaster",
    motoring: "motor",
    hopping: "hop",
    filing: "file",
    happy: "happi",
    relational: "relat",
    conditional: "condit",
    generalization: "gener",
    hopeful: "hope",
    goodness: "good",
    revival: "reviv",
    adjustable: "adjust",
    probate: "probat",
    controll: "control",
    roll: "roll",
  };
  for (const [word, want] of Object.entries(cases)) expect(stem(word), word).toBe(want);
});

test("text and queries: lowercase, split on anything not a letter or digit, short words kept", () => {
  expect(stemText("Deploying the API to prod: v3.0!")).toBe("deploi the api to prod v3 0");
  expect(stemText("Übersetzungen sind wichtig")).toBe("übersetzungen sind wichtig");
  expect(stemQuery("  ")).toBe("");
  const long = Array.from({ length: 20 }, (_, i) => `w${i}`).join(" ");
  expect(stemQuery(long).split(" ")).toHaveLength(16);
  expect(stemQuery(long).endsWith("w19")).toBe(true);
});
