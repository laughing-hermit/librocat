import { csvRows, type PreviewSource, previewImage, previewKind } from "@librocat/core/sources";
import { ConceptBody } from "@/components/concept-body";
import { PdfPreview } from "@/components/pdf-preview";
import { PreviewOnDemand } from "@/components/preview-on-demand";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

/** The most rows a spreadsheet's preview shows; the file has the rest. */
const SHEET_ROWS = 200;

/**
 * A source as it is, for its page's Preview tab: a PDF's pages, the picture,
 * or its text formatted (the part the page shows). `previewable` (in
 * @librocat/core/sources) says which sources have one.
 */
export function SourcePreview({
  src,
}: {
  src: PreviewSource & { id: string; title: string; text: string; file?: { bytes: number } };
}) {
  const kind = previewKind(src.kind);
  const picture = previewImage(src);
  // A file's preview fetches it, counted as a download is: a big one waits for a click.
  const bytes = src.file?.bytes ?? 0;
  if (kind === "pdf" && src.download_url) {
    return (
      <PreviewOnDemand bytes={bytes}>
        <PdfPreview url={src.download_url} />
      </PreviewOnDemand>
    );
  }
  if (kind === "image" && picture) {
    return (
      <PreviewOnDemand bytes={bytes}>
        <a href={picture} target="_blank" rel="noreferrer" title="Open it full size">
          {/* A picture by its file link (convex/files.ts), on another origin: shown, never run. */}
          {/* biome-ignore lint/performance/noImgElement: a stored file, not a site asset */}
          <img src={picture} alt={src.title} className="max-w-full rounded-lg border" />
        </a>
      </PreviewOnDemand>
    );
  }
  if (kind === "markdown") return <ConceptBody id={src.id} body={src.text} />;
  if (kind === "transcript") return <Transcript text={src.text} />;
  if (kind === "sheet") return <Sheet text={src.text} />;
  return null;
}

/** A transcript, a line each: a WebVTT file's cue times muted, its header and cue numbers left out. */
function Transcript({ text }: { text: string }) {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l, i) => l && !(i === 0 && l.startsWith("WEBVTT")) && !/^\d+$/.test(l));
  return (
    <div className="flex flex-col gap-1 text-sm leading-relaxed">
      {lines.map((line, i) =>
        line.includes("-->") ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: lines in order, never reordered
          <p key={i} className="pt-2 font-mono text-xs text-muted-foreground">
            {line}
          </p>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: lines in order, never reordered
          <p key={i}>{line}</p>
        ),
      )}
    </div>
  );
}

/** A spreadsheet's text (a sheet's name, then its CSV) as tables, up to SHEET_ROWS rows. */
function Sheet({ text }: { text: string }) {
  let left = SHEET_ROWS;
  const blocks = text.split(/\n{2,}/).map((block) => {
    if (block.startsWith("# ")) return { name: block.slice(2) };
    const rows = csvRows(block).slice(0, Math.max(0, left));
    left -= rows.length;
    return { rows };
  });
  return (
    <div className="flex flex-col gap-4">
      {blocks.map((b, i) =>
        "name" in b ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: blocks in order, never reordered
          <h3 key={i} className="font-semibold">
            {b.name}
          </h3>
        ) : (
          b.rows.length > 0 && (
            // biome-ignore lint/suspicious/noArrayIndexKey: blocks in order, never reordered
            <Table key={i}>
              <TableHeader>
                <TableRow>
                  {b.rows[0]?.map((cell, j) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: a column's place is its identity
                    <TableHead key={j}>{cell}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {b.rows.slice(1).map((row, r) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: rows in order, never reordered
                  <TableRow key={r}>
                    {row.map((cell, j) => (
                      // biome-ignore lint/suspicious/noArrayIndexKey: a column's place is its identity
                      <TableCell key={j}>{cell}</TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
              {left <= 0 && i === blocks.length - 1 && (
                <TableCaption>The first {SHEET_ROWS} rows. Download it for the rest.</TableCaption>
              )}
            </Table>
          )
        ),
      )}
    </div>
  );
}
