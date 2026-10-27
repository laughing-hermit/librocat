/**
 * A small PDF of text, for the demo library (dev.ts seedDemo) and the
 * browser tests' fixture (browser/fixtures/one-page.pdf): a heading, then a
 * line per paragraph, `perPage` lines a page. Pure, so a test can make one.
 */
export function demoPdf(title: string, text: string, perPage = 3): string {
  const esc = (l: string) => l.replace(/[\\()]/g, (c) => `\\${c}`);
  const lines = text.split(/\n+/).filter(Boolean);
  const pages: string[][] = [];
  for (let i = 0; i < lines.length; i += perPage) pages.push(lines.slice(i, i + perPage));
  if (pages.length === 0) pages.push([]);
  // Objects 1 and 2 are the catalog and the page tree, 3 and 4 the fonts; then each page and its text.
  const pageIds = pages.map((_, i) => 5 + i * 2);
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>",
  ];
  pages.forEach((page, i) => {
    const heading = i === 0 ? `/F2 18 Tf (${esc(title)}) Tj 0 -36 Td ` : "";
    const body = page.map((l) => `(${esc(l)}) Tj T*`).join(" ");
    const stream = `BT 56 740 Td 18 TL ${heading}/F1 11 Tf ${body} ET`;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${6 + i * 2} 0 R /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> >>`,
      `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    );
  });
  let pdf = "%PDF-1.4\n";
  const offsets = objects.map((o, i) => {
    const at = pdf.length;
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
    return at;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return pdf;
}
