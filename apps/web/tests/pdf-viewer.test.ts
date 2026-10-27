/**
 * The PDF viewer (src/components/pdf-viewer.tsx) runs pdf.js through
 * react-pdf, with the worker from our own pdfjs-dist. pdf.js refuses a worker
 * whose version differs from its API's, and the PDF shows only an error, so
 * pdfjs-dist moves with react-pdf, never alone (.github/dependabot.yml).
 */

import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

const manifest = (name: string) =>
  JSON.parse(
    readFileSync(new URL(`../node_modules/${name}/package.json`, import.meta.url), "utf8"),
  );

test("pdfjs-dist is the version react-pdf runs", () => {
  expect(manifest("pdfjs-dist").version).toBe(manifest("react-pdf").dependencies["pdfjs-dist"]);
});
