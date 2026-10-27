/**
 * Kept sources found by their title (convex/sources.ts sourceHits), their
 * pure parts: the title stemmed the way search reads a query, and what a
 * picture, a file kept as it is, and a document's passage look like as hits.
 */

import { stemQuery } from "@librocat/core/format";
import { describe, expect, test } from "vitest";
import type { Doc, Id } from "../convex/_generated/dataModel";
import { demoPdf } from "../convex/demoPdf";
import { catalogStemOf, titleStemOf } from "../convex/model";
import { hitOf } from "../convex/sources";

/** A source part as the database keeps it. */
const part = (n: number, text: string, media?: { mime: string }) =>
  ({
    _id: `part${n}` as Id<"sourceParts">,
    _creationTime: 0,
    workspaceId: "ws" as Id<"workspaces">,
    sourceId: "src" as Id<"sources">,
    n,
    text,
    ...(media ? { media } : {}),
  }) as Doc<"sourceParts">;

describe("a source's title, for search", () => {
  test("stemmed as a concept's catalog record is, so every form of a query's words meets it", () => {
    const title = "Deploying the release pipelines (diagram)";
    expect(titleStemOf(title)).toBe(catalogStemOf({ title, tags: [] }));
    const stems = titleStemOf(title).split(" ");
    for (const word of stemQuery("deploy release pipeline diagrams").split(" ")) {
      expect(stems).toContain(word);
    }
  });
});

describe("a kept source as a search hit", () => {
  test("a picture, found by its title, is its picture part", () => {
    const src = { sid: "deploy-diagram-ab12", title: "Deploy diagram", mime: "image/png" };
    expect(hitOf(src, part(1, "", { mime: "image/png" }))).toEqual({
      id: "source:deploy-diagram-ab12",
      part: 1,
      type: "Source",
      title: "Deploy diagram",
      snippet: "the image",
      file: { mime: "image/png" },
    });
  });

  test("a file kept as it is, with no parts, says what it is", () => {
    const src = { sid: "scan-cd34", title: "Office floor plan", mime: "image/bmp" };
    expect(hitOf(src, null)).toEqual({
      id: "source:scan-cd34",
      part: 0,
      type: "Source",
      title: "Office floor plan",
      snippet: "the image",
      file: { mime: "image/bmp" },
    });
  });

  test("a document's passage starts its snippet, and carries no file", () => {
    const src = { sid: "runbook-ef56", title: "Runbook", mime: "application/pdf" };
    const hit = hitOf(src, part(3, "  Rotate the Stripe key, then redeploy.  "));
    expect(hit).toEqual({
      id: "source:runbook-ef56",
      part: 3,
      type: "Source",
      title: "Runbook",
      snippet: "Rotate the Stripe key, then redeploy.",
    });
  });
});

describe("the demo's PDF (convex/demoPdf.ts)", () => {
  test("a heading, then a page per three lines, which read back as its text", async () => {
    const { extractText, getDocumentProxy } = await import("unpdf");
    const pdf = demoPdf("A report", ["One.", "Two.", "Three.", "Four."].join("\n\n"));
    const doc = await getDocumentProxy(new TextEncoder().encode(pdf));
    expect(doc.numPages).toBe(2);
    const { text } = await extractText(doc, { mergePages: false });
    expect(text[0]).toContain("A report");
    expect(text[1]).toContain("Four.");
  });
});
