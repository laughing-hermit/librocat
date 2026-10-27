"use node";

/**
 * Attached files, read (convex/sources.ts attachFile schedules `process`).
 * No model reads a file for librocat:
 * - Code reads the text where a file has one: plain text and code, HTML (the
 *   page's article), PDF (unpdf), and office documents (officeText.ts: Word
 *   and OpenDocument text with their headings and lists marked, spreadsheets
 *   as CSV, slides with their notes, RTF, EPUB). An agent may send the text
 *   it read on its own machine instead.
 * - A picture is kept as a part of its own: a PNG or a JPEG as it is, any
 *   other picture (HEIC, WebP, GIF, AVIF, TIFF, SVG) as a JPEG kept beside
 *   the original (pictures.ts), so the dashboard and an agent that reads
 *   images can show it. Search finds a picture, and a scanned PDF with no
 *   text, by its title (sources.ts sourceHits).
 * - Reading a file spends no index credits.
 * librocat keeps text and pictures only: every other file is refused at
 * upload (convex/sources.ts, `accepted` in @librocat/core/sources).
 */

import { type FileKind, fileKind, htmlToText } from "@librocat/core/sources";
import { v } from "convex/values";
import { extractText, getDocumentProxy } from "unpdf";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { type ActionCtx, internalAction } from "./_generated/server";
import { officeText } from "./officeText";
import { toJpeg } from "./pictures";

/** The most a file may be for librocat to read it: what a 512 MB action holds with room to work. */
const READ_MAX = 200_000_000;
/**
 * Pictures kept as they are: PNG and JPEG, which every agent that reads
 * images takes (src/lib/mcp-backend.ts hands them over as images).
 */
const AS_IS = new Set(["image/png", "image/jpeg"]);

type Media = { mime: string; storageId?: Id<"_storage"> };

/** A file's text, read by code; empty for a file with none. */
async function readText(kind: FileKind, mime: string, bytes: Buffer): Promise<string> {
  if (kind === "text") return new TextDecoder("utf-8").decode(bytes).replace(/^﻿/, "");
  if (kind === "html") return htmlToText(new TextDecoder("utf-8").decode(bytes)).text;
  if (kind === "pdf") {
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    const { text } = await extractText(pdf, { mergePages: false });
    return (text as string[]).map((t) => t.trim()).join("\n\n");
  }
  if (kind === "docx" || kind === "document" || kind === "sheet" || kind === "slides") {
    return (await officeText(mime, bytes)).text;
  }
  return "";
}

/**
 * A picture's part, and a note for one that couldn't be converted. A
 * converted picture is stored beside the original (`stored`, its bytes).
 */
async function pictureParts(
  ctx: ActionCtx,
  mime: string,
  bytes: Buffer,
): Promise<{ media: Media[]; note?: string; stored?: number }> {
  if (AS_IS.has(mime)) return { media: [{ mime }] };
  const jpeg = await toJpeg(mime, bytes).catch(() => null);
  if (!jpeg) return { media: [], note: `${mime} pictures are kept, and found by their title` };
  const storageId = await ctx.storage.store(
    new Blob([new Uint8Array(jpeg)], { type: "image/jpeg" }),
  );
  return { media: [{ mime: "image/jpeg", storageId }], stored: jpeg.length };
}

/** Read a newly attached file, keep its text and its picture, and mark it ready. */
export const process = internalAction({
  args: { sourceId: v.id("sources") },
  handler: async (ctx, { sourceId }) => {
    const job = await ctx.runQuery(internal.sources.fileJob, { sourceId });
    if (!job) return;
    try {
      const blob = await ctx.storage.get(job.storageId);
      if (!blob) throw new Error("the file is gone from storage");
      if (blob.size > READ_MAX) {
        await ctx.runMutation(internal.sources.storeFileParts, {
          sourceId,
          text: "",
          media: [],
          note: "over 200 MB: kept as it is, and found by its title",
        });
      } else {
        const bytes = Buffer.from(await blob.arrayBuffer());
        const kind = fileKind(job.mime);
        const text = job.hasText ? "" : await readText(kind, job.mime, bytes);
        const { media, note, stored } =
          kind === "image" ? await pictureParts(ctx, job.mime, bytes) : { media: [] };
        try {
          await ctx.runMutation(internal.sources.storeFileParts, {
            sourceId,
            text,
            media,
            ...(note ? { note } : {}),
            ...(stored ? { storedBytes: stored } : {}),
          });
        } catch (exc) {
          // The parts weren't kept: neither is the picture converted for them.
          for (const m of media) if (m.storageId) await ctx.storage.delete(m.storageId);
          throw exc;
        }
      }
    } catch (exc) {
      const why = exc instanceof Error ? exc.message : String(exc);
      await ctx.runMutation(internal.sources.finishFile, {
        sourceId,
        failed: `couldn't read it: ${why}`,
      });
      return;
    }
    await ctx.runMutation(internal.sources.finishFile, { sourceId });
  },
});
