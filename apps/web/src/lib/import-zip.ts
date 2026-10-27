"use client";

/**
 * Import, read in the browser: a zip Export made (or any OKF folder zipped),
 * of any size. The zip never leaves this machine whole:
 *
 * - the concepts, the thesaurus, and the kept sources' text go up in pieces
 *   of at most PIECE_BYTES, each a small zip that convex/importZip.ts writes
 *   through the same functions an agent's `ingest`, `thesaurus`, and
 *   `add_source` use;
 * - each attached file (`_sources/files/<id>/<name>`, from Export's file
 *   parts) goes up as the
 *   dashboard attaches one, under its old id, so the concepts citing it
 *   still find it.
 *
 * Every piece and file passes the plan's limits as it arrives.
 */

import { THESAURUS_ID } from "@librocat/core/library";
import { mimeOf } from "@librocat/core/sources";
import {
  BlobReader,
  BlobWriter,
  configure,
  type Entry,
  type FileEntry,
  Uint8ArrayReader,
  Uint8ArrayWriter,
  ZipReader,
  ZipWriter,
} from "@zip.js/zip.js";
import { finishImport, type ImportResult, startImport } from "@/app/dashboard/library/actions";
import { finishUpload, startUpload } from "@/app/dashboard/sources/actions";

configure({ useWebWorkers: false });

/** The most text one piece holds: its zip stays under the server's 50 MB (convex/imports.ts). */
const PIECE_BYTES = 40 * 1024 * 1024;

const FILES = "_sources/files/";

export type Progress = (done: number, of: number) => void;

/** Send one piece's zip up, and write what it holds into the open library. */
async function sendPiece(zip: Blob): Promise<ImportResult> {
  const up = await startImport(zip.size);
  if (!up.url) throw new Error(up.error ?? "no upload URL");
  const res = await fetch(up.url, {
    method: "POST",
    headers: { "Content-Type": "application/zip" },
    body: zip,
  });
  if (!res.ok) throw new Error(`the upload failed (HTTP ${res.status})`);
  const { storageId } = (await res.json()) as { storageId: string };
  const done = await finishImport(storageId);
  if (!done.result) throw new Error(done.error ?? "the import failed");
  return done.result;
}

/** Attach one exported file under its old id; null when it went in. */
async function sendFile(
  entry: FileEntry,
  id: string,
  name: string,
  record: Record<string, unknown> | undefined,
): Promise<string | null> {
  const type = mimeOf(name, String((record?.file as { mime?: string })?.mime ?? ""));
  const blob = await entry.getData(new BlobWriter(type));
  const up = await startUpload({ name, type, size: blob.size });
  if (!up.url) return up.error ?? "no upload URL";
  const res = await fetch(up.url, {
    method: "POST",
    headers: { "Content-Type": up.type ?? type },
    body: blob,
  });
  if (!res.ok) return `the upload failed (HTTP ${res.status})`;
  const { storageId } = (await res.json()) as { storageId: string };
  const str = (x: unknown) => (typeof x === "string" && x ? x : undefined);
  const done = await finishUpload({
    storageId,
    name,
    id,
    title: str(record?.title),
    location: str(record?.location),
  });
  return done.error ?? null;
}

const isFile = (e: Entry): e is FileEntry => !e.directory;

/** Import `file` into the library that's open. */
export async function importZip(file: File, progress?: Progress): Promise<ImportResult> {
  const reader = new ZipReader(new BlobReader(file));
  try {
    const entries = (await reader.getEntries())
      .filter(isFile)
      .filter((e) => !e.filename.startsWith("__MACOSX/") && !e.filename.endsWith(".DS_Store"));
    const root = entries.some((e) => e.filename.startsWith("okf/")) ? "okf/" : "";
    const inBundle = entries.filter((e) => e.filename.startsWith(root));
    const rel = (e: Entry) => e.filename.slice(root.length);
    // A file is in its own folder, `_sources/files/<id>/<name>`; beside the
    // folders, a file part's records (`part-<n>.json`) and notes.
    const files = inBundle.filter(
      (e) => rel(e).startsWith(FILES) && rel(e).slice(FILES.length).includes("/"),
    );
    const partRecords = inBundle.filter(
      (e) => rel(e).startsWith(FILES) && /^part-\d+\.json$/.test(rel(e).slice(FILES.length)),
    );
    const catalog = inBundle.find((e) => rel(e) === "_sources/sources.json");
    // The thesaurus first, so the concepts' tags meet their terms.
    const rest = inBundle
      .filter((e) => e !== catalog && !rel(e).startsWith(FILES))
      .sort(
        (a, b) => Number(rel(b) === `${THESAURUS_ID}.md`) - Number(rel(a) === `${THESAURUS_ID}.md`),
      );

    const catalogBytes = catalog ? await catalog.getData(new Uint8ArrayWriter()) : null;
    const records: Record<string, unknown>[] = [];
    for (const bytes of [
      catalogBytes,
      ...(await Promise.all(partRecords.map((e) => e.getData(new Uint8ArrayWriter())))),
    ]) {
      if (!bytes) continue;
      try {
        const parsed = JSON.parse(new TextDecoder().decode(bytes));
        if (Array.isArray(parsed)) records.push(...parsed);
      } catch {
        // importZip.ts reports a bad catalog; a file without its record keeps its name.
      }
    }

    // Pieces of the text, each with the catalog, so its sources keep their titles.
    const pieces: FileEntry[][] = [];
    let size = 0;
    for (const e of rest) {
      const last = pieces.at(-1);
      if (!last || (size + e.uncompressedSize > PIECE_BYTES && last.length > 0)) {
        pieces.push([e]);
        size = e.uncompressedSize;
      } else {
        last.push(e);
        size += e.uncompressedSize;
      }
    }
    const total: ImportResult = { concepts: 0, terms: 0, sources: 0, failed: 0, failures: [] };
    const of = pieces.length + files.length;
    let done = 0;
    for (const piece of pieces) {
      const out = new ZipWriter(new BlobWriter("application/zip"));
      for (const e of piece) {
        await out.add(
          `okf/${rel(e)}`,
          new Uint8ArrayReader(await e.getData(new Uint8ArrayWriter())),
        );
      }
      if (catalogBytes) {
        await out.add("okf/_sources/sources.json", new Uint8ArrayReader(catalogBytes));
      }
      const r = await sendPiece(await out.close());
      total.concepts += r.concepts;
      total.terms += r.terms;
      total.sources += r.sources;
      total.failed += r.failed;
      total.failures.push(...r.failures);
      progress?.(++done, of);
    }
    for (const e of files) {
      const [id = "", ...name] = rel(e).slice(FILES.length).split("/");
      const fileName = name.join("/");
      const error =
        id && fileName
          ? await sendFile(
              e,
              id,
              fileName,
              records.find((r) => r.id === id),
            ).catch((err: unknown) => (err instanceof Error ? err.message : String(err)))
          : "not a file Export made";
      if (error) {
        total.failed += 1;
        total.failures.push({ id: `source:${id}`, error });
      } else total.sources += 1;
      progress?.(++done, of);
    }
    total.failures = total.failures.slice(0, 5);
    return total;
  } finally {
    await reader.close();
  }
}
