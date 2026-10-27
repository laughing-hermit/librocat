/**
 * Office documents' text (convex/officeText.ts). The files in
 * fixtures/office were saved by LibreOffice (soffice --headless
 * --convert-to xlsx|ods|pptx|odp|odt|docx|rtf|epub) from two sheets, two slides
 * with notes, and a short runbook; the rest are built here.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import JSZip from "jszip";
import { describe, expect, test } from "vitest";
import { officeText, rtfText } from "../convex/officeText";

const fixture = (name: string) => readFileSync(join(import.meta.dirname, "fixtures/office", name));

const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const PPTX = "application/vnd.openxmlformats-officedocument.presentationml.presentation";

const sheets = `# Budget

Item,Cost,Note
Servers,1250.5,"Convex, Vercel, ""AI Gateway"""
Email,,Resend Pro

# Team & seats

Seats,3`;

const slides = `## Slide 1

Quarterly review
Revenue grew 12%
Churn fell to 2%

Notes: Mention the Team plan launch.

## Slide 2

Next steps
Open librocat Cloud`;

describe("spreadsheets: each sheet as CSV, under its name", () => {
  test("Excel", async () => {
    expect((await officeText(XLSX, fixture("budget.xlsx"))).text).toBe(sheets);
  });

  test("OpenDocument", async () => {
    const ods = "application/vnd.oasis.opendocument.spreadsheet";
    expect((await officeText(ods, fixture("budget.ods"))).text).toBe(sheets);
  });

  test("cells land in their columns, inline strings and booleans included", async () => {
    const zip = new JSZip();
    zip.file(
      "xl/workbook.xml",
      '<workbook><sheets><sheet name="One" sheetId="1" r:id="rId1"/></sheets></workbook>',
    );
    zip.file(
      "xl/_rels/workbook.xml.rels",
      '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
    );
    zip.file(
      "xl/worksheets/sheet1.xml",
      '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>a &amp; b</t></is></c>' +
        '<c r="C1" t="b"><v>1</v></c></row><row r="3"><c r="B3"><v>42</v></c></row></sheetData></worksheet>',
    );
    const bytes = await zip.generateAsync({ type: "nodebuffer" });
    expect((await officeText(XLSX, bytes)).text).toBe("# One\n\na & b,,TRUE\n,42");
  });
});

describe("presentations: each slide's text, in order, with its notes", () => {
  test("PowerPoint", async () => {
    expect((await officeText(PPTX, fixture("deck.pptx"))).text).toBe(slides);
  });

  test("OpenDocument", async () => {
    const odp = "application/vnd.oasis.opendocument.presentation";
    expect((await officeText(odp, fixture("deck.odp"))).text).toBe(slides);
  });

  test("the deck's order wins over the slides' file names", async () => {
    const zip = new JSZip();
    zip.file(
      "ppt/presentation.xml",
      '<p:presentation><p:sldIdLst><p:sldId id="256" r:id="rId3"/><p:sldId id="257" r:id="rId2"/></p:sldIdLst></p:presentation>',
    );
    zip.file(
      "ppt/_rels/presentation.xml.rels",
      '<Relationships><Relationship Id="rId2" Target="slides/slide1.xml"/>' +
        '<Relationship Id="rId3" Target="slides/slide2.xml"/></Relationships>',
    );
    const slide = (text: string) => `<p:sld><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:sld>`;
    zip.file("ppt/slides/slide1.xml", slide("Second"));
    zip.file("ppt/slides/slide2.xml", slide("First"));
    const bytes = await zip.generateAsync({ type: "nodebuffer" });
    expect((await officeText(PPTX, bytes)).text).toBe(
      "## Slide 1\n\nFirst\n\n## Slide 2\n\nSecond",
    );
  });
});

describe("documents", () => {
  const runbook = [
    "Push to main, then wait for the build. Café keys stay in Convex.",
    "Rollback",
    "Find the last good deploy",
    "Ask in #ops when unsure — never guess.",
  ];

  test("OpenDocument text, with headings marked", async () => {
    const { text } = await officeText(
      "application/vnd.oasis.opendocument.text",
      fixture("notes.odt"),
    );
    for (const line of runbook) expect(text).toContain(line);
    expect(text).toContain("## Rollback");
    expect(text).toContain("- Find the last good deploy");
  });

  test("Word, with headings and lists marked", async () => {
    const { text } = await officeText(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      fixture("notes.docx"),
    );
    for (const line of runbook) expect(text).toContain(line);
    expect(text).toContain("## Rollback");
    expect(text).toContain("- Find the last good deploy");
  });

  test("RTF", async () => {
    const { text } = await officeText("application/rtf", fixture("notes.rtf"));
    for (const line of runbook) expect(text).toContain(line);
    expect(text).not.toMatch(/\\|Liberation|Times New Roman/);
  });

  test("RTF's escapes: Unicode with its fallback skipped, code page bytes, and hidden groups", () => {
    const rtf =
      "{\\rtf1\\ansi{\\fonttbl{\\f0 Arial;}}{\\*\\generator Writer;}" +
      "caf\\'e9 \\u8212? dash{\\pict 0123abcd}\\par next\\tab line\\uc0\\u8364 5}";
    expect(rtfText(rtf)).toBe("café — dash\nnext\tline€5");
  });

  test("EPUB: its chapters in reading order, and its title", async () => {
    const { text, title } = await officeText("application/epub+zip", fixture("notes.epub"));
    expect(title).toBe("Deploy runbook");
    for (const line of runbook) expect(text).toContain(line);
  });
});

test("a file that isn't the zip its type says is refused, with why", async () => {
  await expect(officeText(XLSX, Buffer.from("not a zip"))).rejects.toThrow(/isn't the zip/);
});
