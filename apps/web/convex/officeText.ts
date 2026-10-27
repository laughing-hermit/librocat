"use node";

/**
 * The text of office documents, read by code (convex/attachments.ts): Excel
 * and OpenDocument spreadsheets as CSV, a sheet at a time; PowerPoint and
 * OpenDocument presentations a slide at a time, with the speaker's notes;
 * OpenDocument text, RTF, and EPUB as plain text. Office files are zips of
 * XML: each reader takes only the parts with words in them.
 */

import { htmlToText, MAX_SOURCE_BYTES } from "@librocat/core/sources";
import JSZip from "jszip";
import mammoth from "mammoth";

/** The most text one zip entry may unpack to before it's skipped: a bomb, or a sheet nobody reads whole. */
const ENTRY_MAX = 40_000_000;
/** Repeated empty rows and cells OpenDocument writes to fill a sheet out: kept only this many. */
const REPEAT_MAX = 100;

const XML_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

/** XML text with its entities decoded. */
function xmlDecode(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const hex = e[1] === "x" || e[1] === "X";
      const n = Number.parseInt(e.slice(hex ? 2 : 1), hex ? 16 : 10);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : m;
    }
    return XML_ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** An attribute of an XML start tag, decoded. */
const attr = (tag: string, name: string): string | undefined => {
  const v = new RegExp(`\\s${name.replace(":", "\\:")}="([^"]*)"`).exec(tag)?.[1];
  return v === undefined ? undefined : xmlDecode(v);
};

/** A zip entry as text; null when it's missing or unpacks too big. */
async function entry(zip: JSZip, path: string): Promise<string | null> {
  const file = zip.file(path);
  if (!file) return null;
  const size = (file as unknown as { _data?: { uncompressedSize?: number } })._data
    ?.uncompressedSize;
  if (size !== undefined && size > ENTRY_MAX) return null;
  return await file.async("string");
}

/** A path relative to the folder of `from` (zip paths: no leading slash, `..` resolved). */
function resolvePath(from: string, target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const parts = from.split("/").slice(0, -1);
  for (const seg of target.split("/")) {
    if (seg === "..") parts.pop();
    else if (seg && seg !== ".") parts.push(seg);
  }
  return parts.join("/");
}

/** A relationships part: id to target, resolved against the part it describes. */
async function relationships(zip: JSZip, part: string): Promise<Map<string, string>> {
  const dir = part.split("/").slice(0, -1).join("/");
  const name = part.split("/").pop() ?? "";
  const xml = (await entry(zip, `${dir ? `${dir}/` : ""}_rels/${name}.rels`)) ?? "";
  const rels = new Map<string, string>();
  for (const m of xml.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = attr(m[0], "Id");
    const target = attr(m[0], "Target");
    if (id && target && attr(m[0], "TargetMode") !== "External") {
      rels.set(id, resolvePath(part, target));
    }
  }
  return rels;
}

/** A value as one CSV field. */
const csvField = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v);

/** Rows as CSV, without the empty rows and columns at the end. */
function toCsv(rows: string[][]): string {
  const lines = rows.map((r) => {
    let end = r.length;
    while (end > 0 && !r[end - 1]) end--;
    return r.slice(0, end).map(csvField).join(",");
  });
  let end = lines.length;
  while (end > 0 && !lines[end - 1]) end--;
  return lines.slice(0, end).join("\n");
}

/** A column's letters (A, B, …, AA) as its index from 0. */
function columnIndex(ref: string): number {
  let n = 0;
  for (const ch of /^[A-Z]+/.exec(ref)?.[0] ?? "") n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** The text runs of an OOXML rich-text element (`<t>`, `<a:t>`), joined. */
const runs = (xml: string, tag: string) =>
  [...xml.matchAll(new RegExp(`<${tag}(?:\\s[^>]*)?>([^<]*)</${tag}>`, "g"))]
    .map((m) => xmlDecode(m[1] ?? ""))
    .join("");

/** Text that stops growing once it holds what a source may (MAX_SOURCE_BYTES). */
class Sections {
  private out: string[] = [];
  private size = 0;
  add(text: string) {
    const t = text.trim();
    if (!t || this.full) return;
    this.out.push(t);
    this.size += t.length;
  }
  get full() {
    return this.size >= MAX_SOURCE_BYTES;
  }
  get text() {
    return this.out.join("\n\n");
  }
}

/** An Excel workbook (XLSX, XLSM): each sheet, in order, as CSV under its name. */
async function xlsxText(zip: JSZip): Promise<string> {
  const book = (await entry(zip, "xl/workbook.xml")) ?? "";
  const rels = await relationships(zip, "xl/workbook.xml");
  const shared = [
    ...((await entry(zip, "xl/sharedStrings.xml")) ?? "").matchAll(/<si>([\s\S]*?)<\/si>/g),
  ].map((m) => runs(m[1] ?? "", "t"));
  const out = new Sections();
  for (const m of book.matchAll(/<sheet\b[^>]*>/g)) {
    if (out.full) break;
    const name = attr(m[0], "name") ?? "Sheet";
    const path = rels.get(attr(m[0], "r:id") ?? "");
    const xml = path ? await entry(zip, path) : null;
    if (!xml) continue;
    const rows: string[][] = [];
    for (const row of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
      const cells: string[] = [];
      for (const c of (row[1] ?? "").matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const open = `<c${c[1] ?? ""}>`;
        const body = c[2] ?? "";
        const type = attr(open, "t");
        const v = /<v>([^<]*)<\/v>/.exec(body)?.[1];
        let value = "";
        if (type === "s") value = shared[Number(v)] ?? "";
        else if (type === "inlineStr") value = runs(body, "t");
        else if (type === "b") value = v === "1" ? "TRUE" : v === "0" ? "FALSE" : "";
        else if (v !== undefined) value = xmlDecode(v);
        const ref = attr(open, "r");
        const at = ref ? columnIndex(ref) : cells.length;
        if (at >= 0 && at < 16_384) cells[at] = value;
      }
      rows.push(Array.from(cells, (x) => x ?? ""));
    }
    const csv = toCsv(rows);
    if (csv) out.add(`# ${name}\n\n${csv}`);
  }
  return out.text;
}

/** An OpenDocument element's text: paragraphs, spaces, tabs, and line breaks. */
function odfText(xml: string): string {
  return xmlDecode(
    xml
      .replace(/<text:s\b[^>]*?text:c="(\d+)"[^>]*\/>/g, (_m, n: string) =>
        " ".repeat(Math.min(Number(n), 100)),
      )
      .replace(/<text:s\b[^>]*\/>/g, " ")
      .replace(/<text:tab\b[^>]*\/>/g, "\t")
      .replace(/<text:line-break\b[^>]*\/>/g, "\n")
      .replace(/<\/text:(p|h)>/g, "\n")
      .replace(/<[^>]+>/g, ""),
  );
}

/** An OpenDocument spreadsheet (ODS): each table, as CSV under its name. */
function odsText(content: string): string {
  const out = new Sections();
  for (const t of content.matchAll(/<table:table\b([^>]*)>([\s\S]*?)<\/table:table>/g)) {
    if (out.full) break;
    const name = attr(`<t${t[1] ?? ""}>`, "table:name") ?? "Sheet";
    const rows: string[][] = [];
    for (const r of (t[2] ?? "").matchAll(
      /<table:table-row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/table:table-row>)/g,
    )) {
      const cells: string[] = [];
      for (const c of (r[2] ?? "").matchAll(
        /<table:(?:covered-)?table-cell\b([^>]*?)(?:\/>|>([\s\S]*?)<\/table:(?:covered-)?table-cell>)/g,
      )) {
        const open = `<c${c[1] ?? ""}>`;
        const value = odfText(c[2] ?? "").trim() || attr(open, "office:value") || "";
        const repeat = Number(attr(open, "table:number-columns-repeated") ?? 1);
        for (let i = 0; i < Math.min(repeat, REPEAT_MAX); i++) cells.push(value);
      }
      const repeat = Number(attr(`<r${r[1] ?? ""}>`, "table:number-rows-repeated") ?? 1);
      const filled = cells.some(Boolean);
      for (let i = 0; i < (filled ? Math.min(repeat, REPEAT_MAX) : 1); i++) rows.push(cells);
    }
    const csv = toCsv(rows);
    if (csv) out.add(`# ${name}\n\n${csv}`);
  }
  return out.text;
}

/** A PowerPoint deck (PPTX): each slide's text, in order, with its notes. */
async function pptxText(zip: JSZip): Promise<string> {
  const deck = (await entry(zip, "ppt/presentation.xml")) ?? "";
  const rels = await relationships(zip, "ppt/presentation.xml");
  const paragraphs = (xml: string) =>
    [...xml.matchAll(/<a:p>([\s\S]*?)<\/a:p>/g)]
      .map((p) => runs(p[1] ?? "", "a:t").trim())
      .filter(Boolean)
      .join("\n");
  const out = new Sections();
  let n = 0;
  for (const m of deck.matchAll(/<p:sldId\b[^>]*>/g)) {
    if (out.full) break;
    const path = rels.get(attr(m[0], "r:id") ?? "");
    const xml = path ? await entry(zip, path) : null;
    if (!path || !xml) continue;
    n += 1;
    const notesPath = [...(await relationships(zip, path)).values()].find((p) =>
      /notesSlides\//.test(p),
    );
    // Notes slides repeat the slide's number in a placeholder: keep only real sentences.
    const notes = notesPath
      ? paragraphs((await entry(zip, notesPath)) ?? "")
          .replace(/^\d+$/gm, "")
          .trim()
      : "";
    const body = paragraphs(xml);
    out.add([`## Slide ${n}`, body, notes ? `Notes: ${notes}` : ""].filter(Boolean).join("\n\n"));
  }
  return out.text;
}

/** An OpenDocument presentation (ODP): each page's text, in order, with its notes. */
function odpText(content: string): string {
  const out = new Sections();
  let n = 0;
  for (const p of content.matchAll(/<draw:page\b[^>]*>([\s\S]*?)<\/draw:page>/g)) {
    if (out.full) break;
    n += 1;
    const xml = p[1] ?? "";
    const notesXml =
      /<presentation:notes\b[^>]*>([\s\S]*?)<\/presentation:notes>/.exec(xml)?.[1] ?? "";
    const body = odfText(xml.replace(/<presentation:notes\b[\s\S]*?<\/presentation:notes>/, ""));
    const notes = odfText(notesXml).trim();
    out.add(
      [`## Slide ${n}`, body.trim(), notes ? `Notes: ${notes}` : ""].filter(Boolean).join("\n\n"),
    );
  }
  return out.text;
}

/** An OpenDocument text (ODT): its body, headings marked with #. */
function odtText(content: string): string {
  const body = /<office:text\b[^>]*>([\s\S]*)<\/office:text>/.exec(content)?.[1] ?? "";
  const marked = body.replace(/<text:h\b([^>]*)>/g, (_m, attrs: string) => {
    const level = Number(attr(`<h${attrs}>`, "text:outline-level") ?? 1);
    return `\n${"#".repeat(Math.min(Math.max(level, 1), 6))} `;
  });
  return odfText(marked.replace(/<text:list-item\b[^>]*>/g, "- ")).replace(/\n{3,}/g, "\n\n");
}

/** An EPUB book: its chapters in reading order (the spine), and its title. */
async function epubText(zip: JSZip): Promise<{ text: string; title?: string }> {
  const container = (await entry(zip, "META-INF/container.xml")) ?? "";
  const opfPath = attr(/<rootfile\b[^>]*>/.exec(container)?.[0] ?? "", "full-path");
  const opf = opfPath ? ((await entry(zip, opfPath)) ?? "") : "";
  if (!opfPath || !opf) return { text: "" };
  const items = new Map<string, string>();
  for (const m of opf.matchAll(/<item\b[^>]*>/g)) {
    const id = attr(m[0], "id");
    const href = attr(m[0], "href");
    if (id && href) items.set(id, resolvePath(opfPath, decodeURIComponent(href)));
  }
  const out = new Sections();
  for (const m of opf.matchAll(/<itemref\b[^>]*>/g)) {
    if (out.full) break;
    const path = items.get(attr(m[0], "idref") ?? "");
    const html = path ? await entry(zip, path) : null;
    if (html) out.add(htmlToText(html).text);
  }
  const title = /<dc:title\b[^>]*>([^<]*)<\/dc:title>/.exec(opf)?.[1];
  return { text: out.text, ...(title?.trim() ? { title: xmlDecode(title).trim() } : {}) };
}

/** Windows-1252's characters 128–159, which RTF's \'hh escapes use. */
const CP1252: Record<number, string> = {
  128: "€",
  130: "‚",
  131: "ƒ",
  132: "„",
  133: "…",
  134: "†",
  135: "‡",
  136: "ˆ",
  137: "‰",
  138: "Š",
  139: "‹",
  140: "Œ",
  142: "Ž",
  145: "‘",
  146: "’",
  147: "“",
  148: "”",
  149: "•",
  150: "–",
  151: "—",
  152: "˜",
  153: "™",
  154: "š",
  155: "›",
  156: "œ",
  158: "ž",
  159: "Ÿ",
};

/** Groups whose contents are never text: fonts, colors, styles, pictures, and metadata. */
const RTF_SKIP = new Set([
  "fonttbl",
  "colortbl",
  "stylesheet",
  "info",
  "pict",
  "object",
  "header",
  "footer",
  "headerl",
  "headerr",
  "footerl",
  "footerr",
  "listtable",
  "listoverridetable",
  "themedata",
  "colorschememapping",
  "datastore",
  "latentstyles",
  "rsidtbl",
  "generator",
  "xmlnstbl",
]);

/** A control word and its number, matched where the scanner is (sticky). */
const CONTROL_WORD = /([a-zA-Z]+)(-?\d+)? ?/y;

/** An RTF document's text. */
export function rtfText(rtf: string): string {
  let out = "";
  const stack: { skip: boolean; uc: number }[] = [];
  let skip = false;
  let uc = 1; // characters that stand in for a \u character, skipped after it
  let pendingSkip = 0;
  for (let i = 0; i < rtf.length; i++) {
    const ch = rtf[i] as string;
    if (ch === "{") {
      stack.push({ skip, uc });
      continue;
    }
    if (ch === "}") {
      const top = stack.pop();
      if (top) ({ skip, uc } = top);
      continue;
    }
    if (ch === "\\") {
      const next = rtf[i + 1] ?? "";
      if (next === "'") {
        const code = Number.parseInt(rtf.slice(i + 2, i + 4), 16);
        i += 3;
        if (pendingSkip > 0) pendingSkip--;
        else if (!skip && Number.isFinite(code)) out += CP1252[code] ?? String.fromCharCode(code);
        continue;
      }
      if (next === "*") {
        skip = true; // an optional destination this reader doesn't know
        i += 1;
        continue;
      }
      if (/[{}\\]/.test(next)) {
        if (!skip) out += next;
        i += 1;
        continue;
      }
      CONTROL_WORD.lastIndex = i + 1;
      const m = CONTROL_WORD.exec(rtf);
      if (!m) {
        // A control symbol: \~ (a hard space), \- (an optional hyphen), \_ (a hard hyphen).
        if (!skip && next === "~") out += " ";
        if (!skip && next === "_") out += "-";
        i += 1;
        continue;
      }
      i += m[0].length;
      const word = m[1] as string;
      const n = m[2] === undefined ? undefined : Number(m[2]);
      if (RTF_SKIP.has(word)) skip = true;
      else if (skip) continue;
      else if (word === "par" || word === "line" || word === "sect" || word === "page") out += "\n";
      else if (word === "tab" || word === "cell") out += "\t";
      else if (word === "row") out += "\n";
      else if (word === "uc" && n !== undefined) uc = n;
      else if (word === "u" && n !== undefined) {
        out += String.fromCharCode(n < 0 ? n + 65_536 : n);
        pendingSkip = uc;
      } else if (word === "emdash") out += "—";
      else if (word === "endash") out += "–";
      else if (word === "bullet") out += "•";
      else if (word === "lquote") out += "‘";
      else if (word === "rquote") out += "’";
      else if (word === "ldblquote") out += "“";
      else if (word === "rdblquote") out += "”";
      continue;
    }
    if (ch === "\r" || ch === "\n") continue;
    if (pendingSkip > 0) {
      pendingSkip--;
      continue;
    }
    if (!skip) out += ch;
  }
  return out
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * An office document's text, by its MIME type (the `document`, `sheet`, and
 * `slides` kinds of @librocat/core/sources), and its title where the file
 * names one. Empty text when it has none, or isn't what its name says.
 */
export async function officeText(
  mime: string,
  bytes: Buffer,
): Promise<{ text: string; title?: string }> {
  if (mime === "application/rtf") return { text: rtfText(new TextDecoder("latin1").decode(bytes)) };
  if (mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
    // Word as HTML, then the page reader: headings keep their #s and list
    // items their dash, the way an OpenDocument text's do.
    return { text: htmlToText((await mammoth.convertToHtml({ buffer: bytes })).value).text };
  }
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch {
    throw new Error("it isn't the zip an office document is: it may be damaged, or another type");
  }
  if (mime === "application/epub+zip") return await epubText(zip);
  if (
    mime.startsWith("application/vnd.openxmlformats-officedocument.spreadsheetml") ||
    mime === "application/vnd.ms-excel.sheet.macroenabled.12"
  ) {
    return { text: await xlsxText(zip) };
  }
  if (mime === "application/vnd.openxmlformats-officedocument.presentationml.presentation") {
    return { text: await pptxText(zip) };
  }
  const content = (await entry(zip, "content.xml")) ?? "";
  if (mime === "application/vnd.oasis.opendocument.spreadsheet") return { text: odsText(content) };
  if (mime === "application/vnd.oasis.opendocument.presentation") return { text: odpText(content) };
  if (mime === "application/vnd.oasis.opendocument.text") return { text: odtText(content) };
  return { text: "" };
}
