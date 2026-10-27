// The hosted Backend for the shared librocat tool table: every call goes to a
// Convex function in convex/mcp.ts, authenticated with the agent's own OAuth
// access token. Convex checks the token again (convex/auth.config.ts) and
// resolves the library from the user it names: their default one, or the
// `library` slug from the MCP URL, only if they belong to it.

import type { Backend } from "@librocat/server/tools";
import { fetchAction as convexAction, fetchMutation as convexMutation } from "convex/nextjs";
import { api } from "../../convex/_generated/api";
import { errorMessage } from "./convex-error";

// The tool table reads `.message`, so a Convex failure becomes a plain Error
// carrying the readable message (convex-error.ts).
function readable<A extends unknown[], R>(call: (...args: A) => Promise<R>) {
  return async (...args: A): Promise<R> => {
    try {
      return await call(...args);
    } catch (err) {
      throw new Error(errorMessage(err));
    }
  };
}
const fetchMutation = readable(convexMutation) as typeof convexMutation;
const fetchAction = readable(convexAction) as typeof convexAction;

/** The largest picture `get_source` returns as an image, not only as its URL. */
const INLINE_PICTURE = 1_000_000;

/**
 * A part that is a picture (PNG or JPEG, up to 1 MB) comes back as an image
 * too, so an agent that reads images sees it; bigger ones keep their URL.
 */
async function withPicture<T>(result: T): Promise<T> {
  const r = result as {
    file?: { mime?: string; bytes?: number };
    media?: { mime?: string; download_url?: string | null }[];
  };
  const pic = r.media?.find((m) => m.mime === "image/png" || m.mime === "image/jpeg");
  if (!pic?.download_url || (r.file?.bytes ?? 0) > INLINE_PICTURE) return result;
  try {
    const res = await fetch(pic.download_url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return result;
    const data = Buffer.from(await res.arrayBuffer());
    if (data.length > INLINE_PICTURE) return result;
    return { ...result, image: { data: data.toString("base64"), mimeType: pic.mime } };
  } catch {
    return result;
  }
}

export function convexBackend(token: string, library?: string): Backend {
  const auth = { token };
  const lib = library ? { library } : {};
  // Every tool is one Convex call that counts itself by what it reads
  // (convex/metered.ts): reads are mutations too, so the count can't be skipped.
  return {
    // A search is by words, one mutation (convex/mcp.ts searchWords).
    search: (query, f) => fetchMutation(api.mcp.searchWords, { ...lib, query, ...f }, auth),
    // One past revision is a look at the record, not a read of the concept:
    // circulation doesn't count it.
    getConcept: async (id, { history, revision } = {}) =>
      revision !== undefined
        ? {
            id,
            revision: (await fetchMutation(api.mcp.history, { ...lib, id, revision }, auth))
              .snapshot,
          }
        : await fetchMutation(api.mcp.get, { ...lib, id, history }, auth),
    getConcepts: (ids) => fetchMutation(api.mcp.getMany, { ...lib, ids }, auth),
    list: ({ cursor, offset, ...f }) =>
      cursor !== undefined
        ? fetchMutation(api.mcp.listPage, { ...lib, ...f, cursor }, auth)
        : fetchMutation(api.mcp.list, { ...lib, ...f, offset }, auth),
    graph: (id, { depth }) => fetchMutation(api.mcp.graph, { ...lib, id, depth }, auth),
    ingestText: (o, lookup) => fetchMutation(api.mcp.ingest, { ...lib, ...o, ...lookup }, auth),
    update: (id, o) => fetchMutation(api.mcp.update, { ...lib, id, ...o }, auth),
    deleteConcept: (id) => fetchMutation(api.mcp.remove, { ...lib, id }, auth),
    filesChanged: (paths, o) => fetchMutation(api.mcp.changed, { ...lib, paths, ...o }, auth),
    thesaurus: () => fetchMutation(api.mcp.thesaurus, { ...lib }, auth),
    setTerm: (tag, term) => fetchMutation(api.mcp.setTerm, { ...lib, tag, term }, auth),
    findingAid: ({ dir }) => fetchMutation(api.mcp.findingAid, { ...lib, dir }, auth),
    status: () => fetchMutation(api.mcp.status, { ...lib }, auth),
    // A file goes in two steps (an upload URL, then the storageId); text in hand is kept
    // as it is; a URL alone is fetched by librocat (the reading list).
    addSource: ({ title, text, location, kind, id, file, storage_id, filename }) =>
      file || storage_id || text
        ? fetchMutation(
            api.mcp.addSource,
            { ...lib, title, text, location, kind, id, file, storage_id, filename },
            auth,
          )
        : fetchAction(
            api.fetching.addSourceFromUrl,
            { ...lib, location: location ?? "", title, id },
            auth,
          ),
    getSource: async (o) =>
      withPicture(await fetchMutation(api.mcp.getSource, { ...lib, ...o }, auth)),
    reviewShelf: (o) => fetchMutation(api.mcp.shelf, { ...lib, ...o }, auth),
    propose: (p) => fetchMutation(api.mcp.propose, { ...lib, ...p }, auth),
    decide: (id, decision, date) =>
      fetchMutation(api.mcp.decide, { ...lib, id, decision, ...(date ? { date } : {}) }, auth),
  };
}
