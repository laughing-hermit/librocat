"use client";

import { Download } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

/**
 * A kept file bigger than one link serves (convex/files.ts): its parts,
 * fetched in order and saved as the one file they make.
 */
export function DownloadParts({
  parts,
  name,
  mime,
}: {
  parts: string[];
  name: string;
  mime: string;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  async function save() {
    const blobs: Blob[] = [];
    try {
      for (const [i, url] of parts.entries()) {
        setBusy(`Part ${i + 1} of ${parts.length}…`);
        const res = await fetch(url);
        if (!res.ok) throw new Error(await res.text());
        blobs.push(await res.blob());
      }
      const href = URL.createObjectURL(new Blob(blobs, { type: mime }));
      const a = document.createElement("a");
      a.href = href;
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(href), 60_000);
    } catch (exc) {
      toast.error(exc instanceof Error ? exc.message : String(exc));
    } finally {
      setBusy(null);
    }
  }
  return (
    <Button type="button" variant="outline" size="sm" disabled={busy !== null} onClick={save}>
      {busy ? <Spinner /> : <Download />}{" "}
      {busy ?? `Download the file (${parts.length} parts, joined here)`}
    </Button>
  );
}
