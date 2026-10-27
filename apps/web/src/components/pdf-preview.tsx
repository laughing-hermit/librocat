"use client";

import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui/skeleton";

/** A PDF's pages (pdf-viewer.tsx), loaded in the browser alone, so PDF.js is in this chunk only. */
export const PdfPreview = dynamic(
  () => import("@/components/pdf-viewer").then((m) => m.PdfViewer),
  { ssr: false, loading: () => <Skeleton className="aspect-3/4 w-full" /> },
);
