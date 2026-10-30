import { dump } from "@librocat/core/format";
import {
  ADDITIONS_DAYS,
  renderFindingAids,
  renderLog,
  type Tombstone,
} from "@librocat/core/library";
import { configure, TextReader, ZipWriter } from "@zip.js/zip.js";
import { fetchMutation } from "convex/nextjs";
import { getToken } from "@/lib/auth-server";
import { api } from "../../../../convex/_generated/api";
import { errorMessage } from "../../../lib/convex-error";

type ExportedConcept = {
  cid: string;
  frontmatter: Record<string, unknown>;
  body: string;
  title: string | null;
  description: string | null;
  type: string;
  status: string;
  added: number;
};
type ExportedSource = { id: string; text: string; bytes: number } & Record<string, unknown>;
type ExportedFile = {
  id: string;
  file?: { name: string; mime: string; bytes: number };
  download_url?: string;
  download_parts?: string[];
} & Record<string, unknown>;

// Node streams everything: no worker threads on a server.
configure({ useWebWorkers: false });

// A part streams for a few minutes at most (src/lib/export-parts.ts); this is Vercel Pro's longest run.
export const maxDuration = 800;

/** A file's bytes from its signed links (convex/files.ts), fetched one part at a time. */
function fetchParts(urls: string[]): ReadableStream<Uint8Array> {
  let next = 0;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  return new ReadableStream({
    async pull(controller) {
      for (;;) {
        if (!reader) {
          const url = urls[next++];
          if (!url) return controller.close();
          const res = await fetch(url);
          if (!res.ok || !res.body) throw new Error(`a file part answered HTTP ${res.status}`);
          reader = res.body.getReader();
        }
        const { done, value } = await reader.read();
        if (!done) return controller.enqueue(value);
        reader = undefined;
      }
    },
  });
}

/** A file's name as one path segment in the zip. */
const segment = (name: string) => name.replace(/[/\\]/g, "_").trim() || "file";

const zipHeaders = (name: string) => ({
  "Content-Type": "application/zip",
  "Content-Disposition": `attachment; filename="${name}"`,
});

/** A zip streamed as `write` adds to it; an error midway breaks the download. */
function streamed(name: string, write: (zip: ZipWriter<unknown>) => Promise<void>): Response {
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const zip = new ZipWriter(writable);
  void write(zip)
    .then(() => zip.close())
    .catch((err) => writable.abort(err).catch(() => {}));
  return new Response(readable, { headers: zipHeaders(name) });
}

const addText = (zip: ZipWriter<unknown>, name: string, value: string) =>
  zip.add(name, new TextReader(value));

/**
 * Download the library as an OKF bundle, in parts (src/lib/export-parts.ts):
 * without a range, the library part (the concepts, the tags, and every kept
 * source's text); with `from` and `to`, a file part (the attached files with
 * ids in that range). Import, in any librocat's Settings, hosted or
 * self-hosted, brings them back.
 * No lock-in by design: the export is the same format the user would have
 * written by hand.
 */
export async function GET(req: Request): Promise<Response> {
  if (!process.env.NEXT_PUBLIC_CONVEX_URL) {
    return new Response("Convex is not configured", { status: 503 });
  }
  const token = await getToken();
  if (!token) return new Response("not signed in", { status: 401 });
  const q = new URL(req.url).searchParams;
  const from = q.get("from");
  const to = q.get("to");
  if (from !== null && to !== null) return filePart(token, from, to, q.get("part"), q.get("of"));
  return await libraryPart(token);
}

/** The library part: concepts, finding aids, the update log, and the kept sources' text. */
async function libraryPart(token: string): Promise<Response> {
  const concepts: ExportedConcept[] = [];
  let aids: { dir: string; markdown: string }[];
  let tombstones: Tombstone[];
  try {
    // Bodies make a workspace too big for one Convex transaction: walk the pages.
    // Each page counts what it reads against the library's calls (convex/metered.ts).
    let cursor: string | null = null;
    do {
      const page: { concepts: ExportedConcept[]; cursor: string | null } = await fetchMutation(
        api.concepts.exportPage,
        { cursor },
        { token },
      );
      concepts.push(...page.concepts);
      cursor = page.cursor;
    } while (cursor);
    // Built here from the pages already read: no query reads the whole library at once.
    aids = renderFindingAids(
      concepts.map((c) => ({
        id: c.cid,
        title: c.title,
        description: c.description,
        type: c.type,
        status: c.status,
        added: c.added,
      })),
      { additions: { since: Date.now() - ADDITIONS_DAYS * 86_400_000 } },
    );
    tombstones = await fetchMutation(api.concepts.tombstones, {}, { token });
  } catch (exc) {
    return new Response(errorMessage(exc, "export failed"), { status: 500 });
  }
  return streamed("librocat-okf-export.zip", async (zip) => {
    for (const c of concepts) {
      // The core writes the file text, the same bytes Import reads.
      await addText(
        zip,
        `okf/${c.cid}.md`,
        dump({
          id: c.cid,
          type: String(c.frontmatter.type ?? ""),
          frontmatter: c.frontmatter,
          body: c.body,
          links: [],
        }),
      );
    }
    // Finding aids: OKF's reserved index.md per directory — the shelf list a
    // human browses in the repo. The Local index never treats them as concepts.
    for (const a of aids) {
      await addText(zip, a.dir ? `okf/${a.dir}/index.md` : "okf/index.md", a.markdown);
    }
    // The update log, OKF's other reserved file: the ids deleted or renamed
    // away, which the library it is imported into never hands to a new concept either.
    if (tombstones.length > 0) await addText(zip, "okf/log.md", renderLog(tombstones));
    // Kept sources: text files beside the bundle's concepts (only `.md` files
    // are concepts), and their catalog records; Import adds them back. An
    // attached file's bytes are in the file parts.
    const records: Record<string, unknown>[] = [];
    let cursor: string | null = null;
    do {
      const page: { sources: ExportedSource[]; cursor: string | null } = await fetchMutation(
        api.sources.exportPage,
        { cursor },
        { token },
      );
      for (const { text, ...record } of page.sources) {
        if (text) await addText(zip, `okf/_sources/${record.id}.txt`, text);
        records.push(record);
      }
      cursor = page.cursor;
    } while (cursor);
    if (records.length > 0) {
      await addText(zip, "okf/_sources/sources.json", `${JSON.stringify(records, null, 2)}\n`);
    }
  });
}

/**
 * A file part: each attached file with an id from `from` to `to`, in its own
 * folder, and their records, so this part imports on its own.
 */
function filePart(
  token: string,
  from: string,
  to: string,
  part: string | null,
  of: string | null,
): Response {
  const n = Number(part) || 1;
  const name = `librocat-okf-export-files-${n}${of ? `-of-${of}` : ""}.zip`;
  return streamed(name, async (zip) => {
    const records: Record<string, unknown>[] = [];
    let leftOut = 0;
    let cursor: string | null = null;
    do {
      // A page at a time, so a file's links are fresh when it streams.
      const page: { sources: ExportedFile[]; cursor: string | null } = await fetchMutation(
        api.sources.exportFiles,
        { from, to, cursor },
        { token },
      );
      for (const { download_url, download_parts, ...record } of page.sources) {
        const urls = download_parts ?? (download_url ? [download_url] : []);
        if (!record.file) continue;
        if (urls.length === 0) {
          leftOut += 1;
          continue;
        }
        // Stored as they are: pictures and PDFs are compressed already.
        await zip.add(
          `okf/_sources/files/${record.id}/${segment(record.file.name)}`,
          fetchParts(urls),
          { level: 0 },
        );
        records.push(record);
      }
      cursor = page.cursor;
    } while (cursor);
    await addText(
      zip,
      `okf/_sources/files/part-${n}.json`,
      `${JSON.stringify(records, null, 2)}\n`,
    );
    if (leftOut > 0) {
      await addText(
        zip,
        `okf/_sources/files/part-${n}-README.txt`,
        `${leftOut} attached file(s) stayed out: this library has used its file transfer ` +
          "for now. Download this part again once it refills (Billing shows it).\n",
      );
    }
  });
}
