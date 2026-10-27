/**
 * Import's reader (convex/importZip.ts readBundle): what a zip that Export
 * made comes back as. The fixture is the same zip the browser test imports.
 */

import { readFileSync } from "node:fs";
import JSZip from "jszip";
import { describe, expect, test } from "vitest";
import { readBundle } from "../convex/importZip";

const fixture = () => readFileSync(new URL("../browser/fixtures/import.zip", import.meta.url));

describe("readBundle", () => {
  test("an export's zip: its concepts, tags, and kept source text", async () => {
    const b = await readBundle(fixture());
    expect(b.concepts.map((c) => c.id).sort()).toEqual(["notes/imported-note", "runbooks/restore"]);
    const note = b.concepts.find((c) => c.id === "notes/imported-note");
    expect(note).toMatchObject({ type: "Note", title: "Imported note", tags: ["import"] });
    expect(b.terms).toEqual({ ops: { scope_note: "Running the service." } });
    expect(b.sources).toEqual([
      {
        id: "src-restore",
        title: "Restore notes",
        text: expect.stringContaining("source text back"),
        kind: "page",
        location: undefined,
      },
    ]);
    expect(b.failed).toEqual([]);
  });

  test("an attached file's text stays out: the file brings it back when it's attached", async () => {
    const b = await readBundle(fixture());
    expect(b.sources.map((s) => s.id)).not.toContain("src-checklist");
  });

  test("a zipped folder without okf/ reads from its top, and skips OKF's reserved files", async () => {
    const zip = new JSZip();
    zip.file("a.md", "---\ntype: Note\ntitle: A\n---\n\nA.\n");
    zip.file("index.md", "# Not a concept\n");
    zip.file("log.md", "# Not a concept either\n");
    zip.file("notes.txt", "Not Markdown.\n");
    const b = await readBundle(await zip.generateAsync({ type: "uint8array" }));
    expect(b.concepts.map((c) => c.id)).toEqual(["a"]);
  });

  test("a concept that won't parse is reported, and the rest still come in", async () => {
    const zip = new JSZip();
    zip.file("okf/good.md", "---\ntype: Note\ntitle: Good\n---\n\nFine.\n");
    zip.file("okf/bad.md", "---\ntitle: No type\n---\n\nNo type.\n");
    const b = await readBundle(await zip.generateAsync({ type: "uint8array" }));
    expect(b.concepts.map((c) => c.id)).toEqual(["good"]);
    expect(b.failed.map((f) => f.id)).toEqual(["bad"]);
  });
});
