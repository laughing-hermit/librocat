/** The dashboard's addresses for a concept and a source: one place, for server and browser alike. */

// Encode each path segment so ids containing %, #, ? round-trip through the
// [...id] catch-all route (which decodes each segment).
const encodeId = (id: string) => id.split("/").map(encodeURIComponent).join("/");

export const conceptHref = (id: string) => `/dashboard/concepts/${encodeId(id)}`;

export const sourceHref = (id: string, part?: number) =>
  `/dashboard/sources/${encodeURIComponent(id)}${part && part > 1 ? `?part=${part}` : ""}`;
