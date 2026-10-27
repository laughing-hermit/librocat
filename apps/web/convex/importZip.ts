"use node";

/**
 * Read a piece of an import (convex/imports.ts) and write what it holds: the
 * concepts (every `.md` but OKF's reserved index.md and log.md), the
 * thesaurus's terms, and the kept sources' text from `_sources/`. The
 * browser cuts a big zip into pieces, and attaches its files itself, as the
 * dashboard attaches one (src/lib/import-zip.ts).
 */

import {
  type Concept,
  parse,
  RESERVED_NAMES,
  sourcesOf,
  staleAfterOf,
  tagsOf,
} from "@librocat/core/format";
import { THESAURUS_ID, type Thesaurus, thesaurusFrom } from "@librocat/core/library";
import { ConvexError, v } from "convex/values";
import JSZip from "jszip";
import { internal } from "./_generated/api";
import { action } from "./_generated/server";
import { authUserId } from "./identity";
import { MAX_IMPORT_BYTES } from "./imports";

type ConceptWrite = {
  id: string;
  type: string;
  title?: string;
  description?: string;
  body?: string;
  tags?: string[];
  status?: string;
  stale_after?: string;
  sources?: string[];
};
type SourceWrite = { id?: string; title: string; text: string; location?: string; kind?: string };
type Failure = { id: string; error: string };

export type Bundle = {
  concepts: ConceptWrite[];
  terms: Thesaurus;
  sources: SourceWrite[];
  failed: Failure[];
};

const str = (x: unknown) => (typeof x === "string" && x.trim() ? x : undefined);

/** A concept as `ingest` takes it. */
function toWrite(c: Concept): ConceptWrite {
  const fm = c.frontmatter;
  const sources = sourcesOf(fm);
  return {
    id: c.id,
    type: c.type,
    title: str(fm.title),
    description: str(fm.description),
    body: c.body,
    tags: tagsOf(c),
    status: str(fm.status),
    stale_after: staleAfterOf(fm) ?? undefined,
    ...(sources.length ? { sources } : {}),
  };
}

/**
 * What a zip holds. The bundle is its `okf/` folder when it has one (what
 * Export makes), else the zip's top. A concept's id is its path there,
 * without `.md`.
 */
export async function readBundle(bytes: ArrayBuffer | Uint8Array): Promise<Bundle> {
  const zip = await JSZip.loadAsync(bytes);
  const files = Object.values(zip.files).filter(
    (f) => !f.dir && !f.name.startsWith("__MACOSX/") && !f.name.endsWith(".DS_Store"),
  );
  const root = files.some((f) => f.name.startsWith("okf/")) ? "okf/" : "";
  const out: Bundle = { concepts: [], terms: {}, sources: [], failed: [] };
  const texts = new Map<string, string>();
  let records: Record<string, unknown>[] = [];
  for (const f of files) {
    if (!f.name.startsWith(root)) continue;
    const rel = f.name.slice(root.length);
    if (rel.startsWith("_sources/")) {
      const name = rel.slice("_sources/".length);
      if (name === "sources.json") {
        try {
          const parsed = JSON.parse(await f.async("string"));
          if (Array.isArray(parsed)) records = parsed;
        } catch {
          out.failed.push({ id: "_sources/sources.json", error: "not valid JSON" });
        }
      } else if (name.endsWith(".txt") && !name.includes("/")) {
        texts.set(name.slice(0, -".txt".length), await f.async("string"));
      }
      continue;
    }
    const base = rel.split("/").pop() ?? rel;
    if (!rel.endsWith(".md") || RESERVED_NAMES.has(base)) continue;
    const id = rel.slice(0, -".md".length);
    try {
      const concept = parse(await f.async("string"), { conceptId: id });
      if (concept.id === THESAURUS_ID) out.terms = thesaurusFrom(concept.frontmatter);
      else out.concepts.push(toWrite(concept));
    } catch (err) {
      out.failed.push({ id, error: err instanceof Error ? err.message : String(err) });
    }
  }
  for (const r of records) {
    const id = str(r.id);
    const title = str(r.title);
    const text = id ? texts.get(id) : undefined;
    // A file's text is read again when the file is attached; a source without text stays out.
    if (!id || !title || r.file || !text?.trim()) continue;
    out.sources.push({ id, title, text, location: str(r.location), kind: str(r.kind) });
  }
  return out;
}

const why = (err: unknown) =>
  err instanceof ConvexError ? String(err.data) : err instanceof Error ? err.message : String(err);

/** Import an uploaded zip into the library the person has open, then delete the upload. */
export const run = action({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, { storageId }) => {
    try {
      const userId = await authUserId(ctx);
      if (!userId) throw new ConvexError("not signed in");
      const workspaceId = await ctx.runQuery(internal.imports.target, { userId });
      if (!workspaceId) throw new ConvexError("no library yet");
      const blob = await ctx.storage.get(storageId);
      if (!blob) throw new ConvexError("the upload is gone: import the zip again");
      if (blob.size > MAX_IMPORT_BYTES) {
        throw new ConvexError(
          "this piece of the import is over 50 MB: import from the dashboard, which sends a zip in pieces",
        );
      }
      let bundle: Bundle;
      try {
        bundle = await readBundle(await blob.arrayBuffer());
      } catch {
        throw new ConvexError("this file isn't a zip librocat can read");
      }
      const failed = [...bundle.failed];
      // The vocabulary first, so the concepts' tags meet their terms.
      const terms = Object.entries(bundle.terms).map(([tag, term]) => ({ tag, term }));
      if (terms.length > 0) {
        try {
          await ctx.runMutation(internal.imports.writeTerms, { workspaceId, userId, terms });
        } catch (err) {
          failed.push({ id: "thesaurus", error: why(err) });
        }
      }
      let concepts = 0;
      for (const concept of bundle.concepts) {
        try {
          await ctx.runMutation(internal.imports.writeConcept, { workspaceId, userId, concept });
          concepts += 1;
        } catch (err) {
          failed.push({ id: concept.id, error: why(err) });
        }
      }
      let sources = 0;
      for (const source of bundle.sources) {
        try {
          await ctx.runMutation(internal.imports.writeSource, { workspaceId, userId, source });
          sources += 1;
        } catch (err) {
          failed.push({ id: `source:${source.id}`, error: why(err) });
        }
      }
      return {
        concepts,
        terms: terms.length,
        sources,
        failed: failed.length,
        // The first few, for the dashboard to show.
        failures: failed.slice(0, 5),
      };
    } finally {
      await ctx.storage.delete(storageId);
    }
  },
});
