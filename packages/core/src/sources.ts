/**
 * Source copies: the text of a document, page, or transcript an agent read,
 * kept next to the concepts written from it, so an agent can quote it exactly
 * later. Karpathy's LLM wiki keeps its raw sources the same way: immutable,
 * beside the wiki the model writes. A source may also keep its original file
 * (an attachment: a document or a picture), whose text is read by code where
 * it has one; a picture is kept as it is, and found by its title.
 *
 * Pure, like format.ts: the Convex runtime imports it as
 * `@librocat/core/sources`.
 */

import { findSecret, slugify } from "./format.ts";

/** The most text one source may hold: about 1,000 pages. */
export const MAX_SOURCE_BYTES = 2_000_000;
/** A part is what `get_source` returns and searches: about a page. */
export const PART_TARGET = 4_000;
const PART_MAX = 6_000;

export const utf8Bytes = (text: string): number => new TextEncoder().encode(text).length;

/** Unix newlines, no NUL characters, no trailing blank space. */
export function normalizeText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replaceAll(String.fromCharCode(0), "")
    .replace(/[ \t]+$/gm, "")
    .trim();
}

/** A paragraph as pieces of at most `max` characters: its sentences, cut hard if one is longer. */
function pieces(para: string, max: number): string[] {
  if (para.length <= max) return [para];
  const out: string[] = [];
  for (const sentence of para.split(/(?<=[.!?。])\s+/)) {
    for (let i = 0; i < sentence.length; i += max) out.push(sentence.slice(i, i + max));
  }
  return out;
}

/**
 * Split text into parts of about `target` characters, at paragraph ends, then
 * sentence ends. No part is longer than `max`, and none is empty.
 */
export function splitParts(text: string, target = PART_TARGET, max = PART_MAX): string[] {
  const parts: string[] = [];
  let cur = "";
  const add = (piece: string, sep: string) => {
    if (cur && cur.length + sep.length + piece.length > target) {
      parts.push(cur);
      cur = "";
    }
    cur = cur ? cur + sep + piece : piece;
  };
  for (const raw of normalizeText(text).split(/\n{2,}/)) {
    const para = raw.trim();
    if (!para) continue;
    pieces(para, max).forEach((piece, i) => {
      add(piece, i === 0 ? "\n\n" : " ");
    });
  }
  if (cur) parts.push(cur);
  return parts;
}

/**
 * A 64-bit fingerprint of the text (cyrb53's mixing, both halves kept), to
 * tell a copy already kept from new text. Not for security.
 */
export function hashText(text: string): string {
  let h1 = 0xdeadbeef ^ text.length;
  let h2 = 0x41c6ce57 ^ text.length;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, "0") + (h1 >>> 0).toString(16).padStart(8, "0");
}

export const isUrl = (s: string): boolean => /^https?:\/\/\S+$/i.test(s.trim());

/** A URL as sources compare it: without its #fragment. Anything else, trimmed. */
export function normalizeCite(s: string): string {
  const t = s.trim();
  if (!isUrl(t)) return t;
  try {
    const u = new URL(t);
    u.hash = "";
    return u.toString();
  } catch {
    return t;
  }
}

/** What a concept puts in `sources` to cite a kept copy: its URL, else `source:<id>`. */
export function sourceCite(src: { sid: string; location?: string | null }): string {
  return src.location && isUrl(src.location) ? normalizeCite(src.location) : `source:${src.sid}`;
}

/** A `get_source` reference: `source:<id>`, a URL, or a bare id. */
export function parseSourceRef(ref: string): { sid: string } | { url: string } {
  const r = ref.trim();
  if (r.startsWith("source:")) return { sid: r.slice("source:".length).trim() };
  if (isUrl(r)) return { url: normalizeCite(r) };
  return { sid: r };
}

const SOURCE_ID = /^[a-z0-9][a-z0-9-]{0,79}$/;

/** An explicit source id must be a lowercase slug of at most 80 characters. */
export function checkSourceId(id: string): string {
  const s = id.trim();
  if (!SOURCE_ID.test(s)) {
    throw new Error(
      `source id "${id}" must be lowercase letters, digits, and dashes, at most 80 characters`,
    );
  }
  return s;
}

/** A new source's id: its title as a slug, and four characters of its text's fingerprint. */
export function deriveSourceId(title: string, hash: string): string {
  const base =
    slugify(title || "source")
      .slice(0, 60)
      .replace(/-+$/, "") || "source";
  return `${base}-${hash.slice(0, 4)}`;
}

/** The first credential in the text, and its line (1-based), or null. */
export function findSecretLine(text: string): { label: string; line: number } | null {
  const label = findSecret(text);
  if (!label) return null;
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (findSecret(lines[i] as string)) return { label, line: i + 1 };
  }
  return { label, line: 0 };
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  mdash: "—",
  ndash: "–",
  hellip: "…",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
};

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e.startsWith("#")) {
      const hex = e[1] === "x" || e[1] === "X";
      const n = Number.parseInt(e.slice(hex ? 2 : 1), hex ? 16 : 10);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/**
 * A web page's title and readable text: the article when the page marks one
 * (<main> or <article>), else the body without its navigation, header,
 * footer, and forms. Headings keep their `#`s, list items their dash.
 */
export function htmlToText(html: string): { title: string | null; text: string } {
  const rawTitle = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
  let s = html.replace(/<!--[\s\S]*?-->/g, "");
  s = s.replace(/<(script|style|noscript|svg|template|iframe|canvas)\b[\s\S]*?<\/\1\s*>/gi, "");
  const main = /<(main|article)\b[^>]*>([\s\S]*?)<\/\1\s*>/i.exec(s)?.[2];
  if (main) s = main;
  else {
    s = /<body\b[^>]*>([\s\S]*)<\/body\s*>/i.exec(s)?.[1] ?? s;
    s = s.replace(/<(nav|header|footer|aside|form)\b[\s\S]*?<\/\1\s*>/gi, "");
  }
  s = s
    .replace(/<h([1-6])\b[^>]*>/gi, (_m, n: string) => `\n\n${"#".repeat(Number(n))} `)
    .replace(/<li\b[^>]*>/gi, "\n- ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/t[dh]\s*>/gi, "\t")
    .replace(
      /<\/?(p|div|section|article|main|h[1-6]|ul|ol|table|tr|blockquote|pre|figure|dl|dt|dd)\b[^>]*>/gi,
      "\n\n",
    )
    .replace(/<[^>]+>/g, "");
  const text = decodeEntities(s)
    .replace(/[ \t\f\v ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const title = rawTitle ? decodeEntities(rawTitle).replace(/\s+/g, " ").trim() : "";
  return { title: title || null, text };
}

// ---- files: attachments -----------------------------------------------------------

/** What a file is to librocat: how its text is read, or that it is a picture. */
export type FileKind =
  | "text"
  | "html"
  | "pdf"
  | "docx"
  /** OpenDocument text, RTF, and EPUB: read as text. */
  | "document"
  /** Excel and OpenDocument spreadsheets: each sheet read as CSV. */
  | "sheet"
  /** PowerPoint and OpenDocument presentations: each slide's text, and its notes. */
  | "slides"
  | "image"
  | "other";

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const DOCUMENTS = new Set([
  "application/vnd.oasis.opendocument.text",
  "application/rtf",
  "application/epub+zip",
]);
const SHEETS = new Set([
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel.sheet.macroenabled.12",
  "application/vnd.oasis.opendocument.spreadsheet",
]);
const SLIDES = new Set([
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.oasis.opendocument.presentation",
]);

const MIME_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  heic: "image/heic",
  heif: "image/heif",
  avif: "image/avif",
  tif: "image/tiff",
  tiff: "image/tiff",
  bmp: "image/bmp",
  pdf: "application/pdf",
  docx: DOCX,
  odt: "application/vnd.oasis.opendocument.text",
  rtf: "application/rtf",
  epub: "application/epub+zip",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xlsm: "application/vnd.ms-excel.sheet.macroenabled.12",
  ods: "application/vnd.oasis.opendocument.spreadsheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  odp: "application/vnd.oasis.opendocument.presentation",
  html: "text/html",
  htm: "text/html",
  md: "text/markdown",
  markdown: "text/markdown",
  csv: "text/csv",
  json: "application/json",
  vtt: "text/vtt",
  srt: "application/x-subrip",
};

/** Plain text under another name: notes, data, logs, and code. */
const TEXT_EXT = new Set(
  (
    "txt text log ini cfg conf env toml yaml yml xml sql sh bash zsh ps1 bat ts tsx js jsx mjs cjs " +
    "py rb go rs java kt kts swift c h cc cpp hpp cs php pl lua r scala dart ex exs erl hs clj " +
    "css scss less vue svelte astro graphql proto tf hcl dockerfile makefile gradle"
  ).split(" "),
);

/** Normalized aliases the browser or the shell may report. */
const MIME_ALIASES: Record<string, string> = {
  "image/jpg": "image/jpeg",
  "application/x-pdf": "application/pdf",
  "text/rtf": "application/rtf",
  "image/x-ms-bmp": "image/bmp",
  "image/heic-sequence": "image/heic",
  "image/heif-sequence": "image/heif",
};

/**
 * A file's MIME type: the one given, when it says something specific, else
 * the one its name implies, else `application/octet-stream`.
 */
export function mimeOf(filename: string, given?: string | null): string {
  const g = (given ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  const known = MIME_ALIASES[g] ?? g;
  if (known && known !== "application/octet-stream" && known !== "binary/octet-stream")
    return known;
  const name = filename.trim().toLowerCase();
  const ext =
    /\.([a-z0-9]+)$/.exec(name)?.[1] ?? (/(^|\/)(dockerfile|makefile)$/.test(name) ? "txt" : "");
  if (MIME_BY_EXT[ext]) return MIME_BY_EXT[ext] as string;
  if (TEXT_EXT.has(ext)) return "text/plain";
  return "application/octet-stream";
}

/** What kind of file a MIME type is. */
export function fileKind(mime: string): FileKind {
  if (mime === "application/pdf") return "pdf";
  if (mime === DOCX) return "docx";
  if (DOCUMENTS.has(mime)) return "document";
  if (SHEETS.has(mime)) return "sheet";
  if (SLIDES.has(mime)) return "slides";
  if (mime === "text/html") return "html";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("text/") || mime === "application/json" || mime === "application/x-subrip") {
    return "text";
  }
  return "other";
}

/** What librocat keeps: text (documents, PDFs, spreadsheets, slides, pages, code) and pictures. */
const KEPT: ReadonlySet<FileKind> = new Set<FileKind>([
  "text",
  "html",
  "pdf",
  "docx",
  "document",
  "sheet",
  "slides",
  "image",
]);

/**
 * Whether librocat keeps a file of this type. Its knowledge base is for
 * agents, and agents read text and look at pictures: every other file is
 * refused (`refusal` says why, and what to attach instead).
 */
export const accepted = (mime: string): boolean => KEPT.has(fileKind(mime));

/** The file extensions librocat keeps, as `.ext`: for a file picker's `accept`. */
export const acceptedExtensions = (): string[] =>
  [
    ...Object.entries(MIME_BY_EXT)
      .filter(([, mime]) => accepted(mime))
      .map(([ext]) => ext),
    ...TEXT_EXT,
  ].map((ext) => `.${ext}`);

/** Why a file of this type isn't kept, and what to attach instead. */
export function refusal(mime: string): string {
  return (
    "librocat keeps text and pictures (documents, PDFs, spreadsheets, slides, code, images), " +
    `not ${mime} files: attach its text instead (for a recording, its transcript), or send ` +
    "it as text/plain if it is text"
  );
}

const AUDIO_EXT = new Set("mp3 wav m4a aac flac ogg oga opus wma aif aiff amr".split(" "));
const VIDEO_EXT = new Set("mp4 m4v mov webm mkv avi wmv mpg mpeg 3gp ogv".split(" "));

/**
 * What kind of file a refused one was, and nothing more: audio, video, or
 * anything else, by its type or, when that says nothing, its extension.
 * librocat.com counts refusals by this alone, to learn whether people want
 * recordings kept.
 */
export function refusalKind(mime: string, filename = ""): "audio" | "video" | "other" {
  const ext = /\.([a-z0-9]+)$/.exec(filename.trim().toLowerCase())?.[1] ?? "";
  if (mime.startsWith("audio/") || AUDIO_EXT.has(ext)) return "audio";
  if (mime.startsWith("video/") || VIDEO_EXT.has(ext)) return "video";
  return "other";
}

/** Whether a browser may show the file inline: images the page can't script (never SVG, never HTML). */
export const displayable = (mime: string): boolean =>
  ["image/png", "image/jpeg", "image/gif", "image/webp"].includes(mime);

// ---- a source's page: the file as it is -------------------------------------------

/** How a source's page shows it as it is: a PDF's pages, a picture, or its text formatted. */
export type PreviewKind = "pdf" | "image" | "markdown" | "transcript" | "sheet";

/**
 * How a source of this kind (convex/sources.ts KINDS) shows on its page, or
 * null when its text is the only view: plain text reads the same either way,
 * and an office document or a web page has no faithful view in a browser.
 */
export function previewKind(kind: string): PreviewKind | null {
  if (kind === "pdf" || kind === "image" || kind === "transcript" || kind === "sheet") return kind;
  // A web page is kept as Markdown, as a .md file is.
  if (kind === "md" || kind === "html") return "markdown";
  return null;
}

/** A source as its page reads it (convex/sources.ts `read`): its kind, file, and links. */
export type PreviewSource = {
  kind: string;
  file?: { mime: string };
  download_url?: string;
  media?: { mime: string; download_url?: string }[];
};

/**
 * The picture a source's page shows: the file itself when a browser shows it
 * safely, else its converted JPEG; each by its one link.
 */
export function previewImage(s: PreviewSource): string | undefined {
  if (s.download_url && s.file && displayable(s.file.mime)) return s.download_url;
  return s.media?.find((m) => m.download_url && displayable(m.mime))?.download_url;
}

/**
 * Whether a source's page previews it. Formatted text needs only its text; a
 * PDF or a picture needs its file served by one link (16 MB at most), so a
 * bigger file is only downloaded.
 */
export function previewable(s: PreviewSource): boolean {
  const kind = previewKind(s.kind);
  if (kind === "pdf") return Boolean(s.download_url);
  if (kind === "image") return Boolean(previewImage(s));
  return kind !== null;
}

/** CSV text as rows of fields (RFC 4180 quoting); a row cut short keeps what it has. */
export function csvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"' && field === "") quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (c !== "\r") field += c;
  }
  if (field || row.length > 0) rows.push([...row, field]);
  return rows;
}
