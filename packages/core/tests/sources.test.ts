/** Source copies: splitting text into parts, fingerprints, cites, and reading web pages. */

import { describe, expect, test } from "vitest";
import { markSources } from "../src/format.ts";
import {
  accepted,
  checkSourceId,
  csvRows,
  deriveSourceId,
  displayable,
  fileKind,
  findSecretLine,
  hashText,
  htmlToText,
  mimeOf,
  normalizeCite,
  parseSourceRef,
  previewable,
  previewImage,
  previewKind,
  refusal,
  refusalKind,
  sourceCite,
  splitParts,
} from "../src/sources.ts";

describe("splitting text into parts", () => {
  test("short text is one part, and paragraphs share a part up to the target", () => {
    expect(splitParts("One.\n\nTwo.")).toEqual(["One.\n\nTwo."]);
    const para = "word ".repeat(100).trim();
    const parts = splitParts(Array(30).fill(para).join("\n\n"), 1_000, 1_500);
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(1_500);
    expect(parts.join("\n\n")).toBe(Array(30).fill(para).join("\n\n"));
  });

  test("a paragraph longer than a part is cut at sentence ends, then hard", () => {
    const sentence = `${"a".repeat(80)}.`;
    const parts = splitParts(Array(40).fill(sentence).join(" "), 500, 600);
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(600);
    expect(parts.join(" ").replace(/\s+/g, "")).toBe(Array(40).fill(sentence).join(""));
    const blob = splitParts("x".repeat(2_500), 1_000, 1_000);
    expect(blob.map((p) => p.length)).toEqual([1_000, 1_000, 500]);
  });

  test("no part is empty, and Windows newlines and trailing spaces go", () => {
    expect(splitParts("  \r\n\r\n\r\nHello  \r\nworld\r\n\r\n\r\n")).toEqual(["Hello\nworld"]);
    expect(splitParts("")).toEqual([]);
  });
});

test("a fingerprint is stable, differs with the text, and is 16 hex characters", () => {
  expect(hashText("the same text")).toBe(hashText("the same text"));
  expect(hashText("the same text")).not.toBe(hashText("the same text."));
  expect(hashText("")).toMatch(/^[0-9a-f]{16}$/);
});

describe("cites and references", () => {
  test("a URL is compared without its fragment; anything else is trimmed", () => {
    expect(normalizeCite("https://example.com/a#part-2")).toBe("https://example.com/a");
    expect(normalizeCite("https://example.com")).toBe("https://example.com/");
    expect(normalizeCite("  specs/search.md ")).toBe("specs/search.md");
  });

  test("a copy of a web page is cited by its URL, anything else as source:<id>", () => {
    expect(sourceCite({ sid: "post-1a2b", location: "https://example.com/post#top" })).toBe(
      "https://example.com/post",
    );
    expect(sourceCite({ sid: "spec-1a2b", location: "specs/search.pdf" })).toBe("source:spec-1a2b");
    expect(sourceCite({ sid: "notes-1a2b" })).toBe("source:notes-1a2b");
  });

  test("a reference names an id or a URL", () => {
    expect(parseSourceRef("source:spec-1a2b")).toEqual({ sid: "spec-1a2b" });
    expect(parseSourceRef("https://example.com/x#y")).toEqual({ url: "https://example.com/x" });
    expect(parseSourceRef("spec-1a2b")).toEqual({ sid: "spec-1a2b" });
  });

  test("ids: derived from the title and the fingerprint; explicit ones must be slugs", () => {
    expect(deriveSourceId("Search Spec (v2)", "abcdef0123456789")).toBe("search-spec-v2-abcd");
    expect(deriveSourceId("", "abcdef0123456789")).toBe("source-abcd");
    expect(checkSourceId("my-spec")).toBe("my-spec");
    expect(() => checkSourceId("My Spec")).toThrow(/lowercase/);
    expect(() => checkSourceId("../x")).toThrow();
  });
});

test("a secret in a source is found with its line", () => {
  const key = `sk_live_${"a".repeat(24)}`;
  expect(findSecretLine(`fine\nstill fine\nkey: ${key}\n`)).toEqual({
    label: "a Stripe secret key",
    line: 3,
  });
  expect(findSecretLine("nothing here")).toBeNull();
});

describe("reading a web page", () => {
  test("the article, not the navigation; headings, lists, and entities kept", () => {
    const html = `<!doctype html><html><head><title>Launch &amp; notes</title>
      <style>body{}</style><script>alert(1)</script></head><body>
      <nav><a href="/">Home</a> <a href="/blog">Blog</a></nav>
      <main><h1>Launch plan</h1><p>We ship on <b>Monday</b>.</p>
      <h2>Steps</h2><ul><li>Price &mdash; $15</li><li>Post</li></ul>
      <p>Don&#39;t forget&nbsp;the mail.</p></main>
      <footer>© 2026</footer></body></html>`;
    const { title, text } = htmlToText(html);
    expect(title).toBe("Launch & notes");
    expect(text).toBe(
      "# Launch plan\n\nWe ship on Monday.\n\n## Steps\n\n- Price — $15\n- Post\n\nDon't forget the mail.",
    );
    expect(text).not.toMatch(/Home|Blog|alert|2026/);
  });

  test("without <main>, the body without its header, footer, and forms", () => {
    const { title, text } = htmlToText(
      "<body><header>Site</header><div>Body text</div><form>Search</form><footer>F</footer></body>",
    );
    expect(title).toBeNull();
    expect(text).toBe("Body text");
  });
});

test("a concept citing a changed source is marked for review", () => {
  const fm: Record<string, unknown> = {
    sources: ["https://example.com/post", "src/app.ts"],
    stale_after: "2099-01-01",
  };
  const hit = markSources(fm, (r) => r === "https://example.com/post", Date.parse("2026-09-28"));
  expect(hit).toEqual(["https://example.com/post"]);
  expect(fm.stale_after).toBe("2026-09-28T00:00:00.000Z");
  expect(fm.sources).toEqual([
    { resource: "https://example.com/post", last_modified: "2026-09-28T00:00:00.000Z" },
    "src/app.ts",
  ]);
  expect(markSources({ sources: ["x"] }, () => false)).toEqual([]);
});

describe("attached files", () => {
  test("a file's type: the one given when specific, else its name's, else unknown", () => {
    expect(mimeOf("deck.pdf", "application/octet-stream")).toBe("application/pdf");
    expect(mimeOf("shot.PNG")).toBe("image/png");
    expect(mimeOf("photo.jpg", "image/jpg")).toBe("image/jpeg");
    expect(mimeOf("main.go")).toBe("text/plain");
    expect(mimeOf("Dockerfile")).toBe("text/plain");
    expect(mimeOf("notes.md", "text/markdown; charset=utf-8")).toBe("text/markdown");
    expect(mimeOf("archive.zip")).toBe("application/octet-stream");
  });

  test("what kind each is, and what a page may show", () => {
    expect(fileKind("application/pdf")).toBe("pdf");
    expect(fileKind("text/plain")).toBe("text");
    expect(fileKind("application/json")).toBe("text");
    expect(fileKind("image/webp")).toBe("image");
    expect(fileKind("application/zip")).toBe("other");
    expect(displayable("image/png")).toBe(true);
    expect(displayable("image/svg+xml")).toBe(false);
  });

  test("office documents and other pictures, by name or by the type a browser gives", () => {
    const kinds = Object.fromEntries(
      ["a.xlsx", "a.xlsm", "a.ods", "a.pptx", "a.odp", "a.odt", "a.rtf", "a.epub", "a.docx"].map(
        (f) => [f, fileKind(mimeOf(f))],
      ),
    );
    expect(kinds).toEqual({
      "a.xlsx": "sheet",
      "a.xlsm": "sheet",
      "a.ods": "sheet",
      "a.pptx": "slides",
      "a.odp": "slides",
      "a.odt": "document",
      "a.rtf": "document",
      "a.epub": "document",
      "a.docx": "docx",
    });
    // A browser's own spelling of the same types.
    expect(fileKind(mimeOf("a.rtf", "text/rtf"))).toBe("document");
    expect(fileKind(mimeOf("b.xlsm", "application/vnd.ms-excel.sheet.macroEnabled.12"))).toBe(
      "sheet",
    );
    for (const f of ["p.heic", "p.heif", "p.avif", "p.tif", "p.tiff", "p.bmp"]) {
      expect(fileKind(mimeOf(f))).toBe("image");
    }
    expect(mimeOf("p.bmp", "image/x-ms-bmp")).toBe("image/bmp");
  });

  test("librocat keeps text and pictures, and refuses the rest with what to attach instead", () => {
    for (const f of ["a.md", "a.ts", "a.pdf", "a.docx", "a.xlsx", "a.pptx", "a.odt", "a.epub"]) {
      expect(accepted(mimeOf(f))).toBe(true);
    }
    for (const f of ["a.png", "a.jpg", "a.heic", "a.webp", "a.svg", "a.html", "a.vtt"]) {
      expect(accepted(mimeOf(f))).toBe(true);
    }
    for (const f of ["a.mp3", "a.wav", "a.m4a", "a.mp4", "a.mov", "a.webm", "a.zip", "a.psd"]) {
      expect(accepted(mimeOf(f))).toBe(false);
    }
    expect(refusal("video/mp4")).toMatch(/not video\/mp4 files: .*for a recording, its transcript/);
    expect(refusal(mimeOf("bundle.zip"))).toMatch(/not application\/octet-stream files/);
    for (const mime of ["audio/mpeg", "video/quicktime", "application/zip"]) {
      expect(accepted(mime)).toBe(false);
    }
    // A refusal is counted by its kind alone.
    expect(refusalKind(mimeOf("memo.m4a"), "memo.m4a")).toBe("audio");
    expect(refusalKind("audio/mpeg")).toBe("audio");
    expect(refusalKind("video/quicktime", "talk.mov")).toBe("video");
    expect(refusalKind(mimeOf("talk.webm"), "talk.webm")).toBe("video");
    expect(refusalKind(mimeOf("bundle.zip"), "bundle.zip")).toBe("other");
  });
});

describe("a source's preview on its page", () => {
  const url = "https://files.test/a";
  test("a PDF or a picture previews from its one link; a bigger file only downloads", () => {
    expect(previewable({ kind: "pdf", file: { mime: "application/pdf" }, download_url: url })).toBe(
      true,
    );
    expect(previewable({ kind: "pdf", file: { mime: "application/pdf" } })).toBe(false);
    expect(previewable({ kind: "image", file: { mime: "image/png" }, download_url: url })).toBe(
      true,
    );
    expect(previewable({ kind: "image", file: { mime: "image/png" } })).toBe(false);
  });

  test("a picture a browser can't show safely previews as its converted JPEG", () => {
    const heic = { kind: "image", file: { mime: "image/heic" }, download_url: url };
    expect(previewable(heic)).toBe(false);
    const converted = { ...heic, media: [{ mime: "image/jpeg", download_url: `${url}.jpg` }] };
    expect(previewImage(converted)).toBe(`${url}.jpg`);
    expect(previewable(converted)).toBe(true);
  });

  test("Markdown, a web page, a transcript, and a spreadsheet show their text; the rest show only text", () => {
    for (const kind of ["md", "html", "transcript", "sheet"])
      expect(previewable({ kind })).toBe(true);
    expect(previewKind("html")).toBe("markdown");
    for (const kind of ["txt", "docx", "document", "slides", "file", "other"]) {
      expect(previewKind(kind)).toBeNull();
      expect(previewable({ kind, download_url: url })).toBe(false);
    }
  });

  test("CSV reads as rows, quotes and all", () => {
    expect(csvRows('a,b\n"c, d","say ""hi"""\n1,')).toEqual([
      ["a", "b"],
      ["c, d", 'say "hi"'],
      ["1", ""],
    ]);
  });
});
