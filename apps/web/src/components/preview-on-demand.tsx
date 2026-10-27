"use client";

import { Eye } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Button } from "@/components/ui/button";
import { formatBytes } from "@/lib/utils";

/**
 * The most a preview fetches by itself. Each preview's bytes count against
 * the library's file transfer a month, as a download does (convex/limits.ts),
 * so a bigger file waits for a click.
 */
export const AUTO_PREVIEW_BYTES = 5_000_000;

/** A file's preview: shown at once up to AUTO_PREVIEW_BYTES, else when asked for. */
export function PreviewOnDemand({ bytes, children }: { bytes: number; children: ReactNode }) {
  const [shown, setShown] = useState(bytes <= AUTO_PREVIEW_BYTES);
  if (shown) return children;
  return (
    <div className="flex justify-center py-12">
      <Button variant="outline" onClick={() => setShown(true)}>
        <Eye /> Show preview ({formatBytes(bytes)})
      </Button>
    </div>
  );
}
