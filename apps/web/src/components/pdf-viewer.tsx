"use client";

import { AlertTriangle, Download } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import { ButtonLink } from "@/components/button-link";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";

// Set beside the components that use it (react-pdf's README): the worker
// bundled with pdfjs-dist, so no file leaves for a CDN.
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

/**
 * A PDF's pages, drawn on canvases from its file link (convex/files.ts),
 * stacked and as wide as the box, which scrolls. Nothing in the file runs:
 * no text layer, no links, no forms.
 */
export function PdfViewer({ url }: { url: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState<number>();
  const [pages, setPages] = useState(0);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = () => setWidth(el.clientWidth);
    fit();
    const watch = new ResizeObserver(fit);
    watch.observe(el);
    return () => watch.disconnect();
  }, []);

  return (
    <div className="flex flex-col gap-2">
      {pages > 0 && (
        <p className="text-sm text-muted-foreground">
          {pages === 1 ? "1 page" : `${pages.toLocaleString("en-US")} pages`}
        </p>
      )}
      <div ref={box} className="aspect-3/4 w-full overflow-y-auto rounded-lg border">
        <Document
          file={url}
          suspense={false}
          onLoadSuccess={(pdf) => setPages(pdf.numPages)}
          loading={<Skeleton className="size-full" />}
          error={
            <Alert variant="destructive">
              <AlertTriangle />
              <AlertTitle>Can't show this PDF here.</AlertTitle>
              <AlertDescription>Download it, or read its text in the Text tab.</AlertDescription>
              <AlertAction>
                <ButtonLink href={url} variant="outline" size="sm" download>
                  <Download /> Download
                </ButtonLink>
              </AlertAction>
            </Alert>
          }
          className="flex flex-col gap-2"
        >
          {width &&
            Array.from({ length: pages }, (_, i) => (
              <Page
                // biome-ignore lint/suspicious/noArrayIndexKey: a page's number is its identity
                key={i}
                pageNumber={i + 1}
                width={width}
                renderTextLayer={false}
                renderAnnotationLayer={false}
                loading={<Skeleton className="aspect-3/4 w-full" />}
              />
            ))}
        </Document>
      </div>
    </div>
  );
}
