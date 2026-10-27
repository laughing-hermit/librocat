"use client";

import { Download, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { deleteIndex } from "@/app/dashboard/actions";
import { exportParts } from "@/app/dashboard/library/actions";
import { ConfirmButton } from "@/components/confirm-button";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Spinner } from "@/components/ui/spinner";
import { count } from "@/lib/analytics";
import { type FilePart, partHref } from "@/lib/export-parts";
import { importZip } from "@/lib/import-zip";
import { formatBytes } from "@/lib/utils";

const size = formatBytes;

/**
 * Download the library as plain Markdown files (OKF zips), in parts: the
 * library itself, then its attached files about a gigabyte at a time
 * (lib/export-parts.ts), so each download finishes.
 */
export function ExportButton() {
  const [parts, setParts] = useState<FilePart[] | null>(null);
  const download = (href: string) => {
    count("index_exported");
    window.location.assign(href);
  };
  return (
    <DropdownMenu
      onOpenChange={(open) => {
        if (!open || parts) return;
        void exportParts().then((r) => {
          if (r.error) toast.error(r.error);
          setParts(r.parts ?? []);
        });
      }}
    >
      <DropdownMenuTrigger render={<Button variant="outline" size="sm" />}>
        <Download /> Export
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-56">
        <DropdownMenuItem onClick={() => download(partHref())}>
          Library: concepts and text
        </DropdownMenuItem>
        {parts === null ? (
          <DropdownMenuItem disabled>
            <Spinner /> Finding files
          </DropdownMenuItem>
        ) : (
          parts.map((p, i) => (
            <DropdownMenuItem
              key={p.from}
              onClick={() => download(partHref({ ...p, n: i + 1, of: parts.length }))}
            >
              Files {i + 1} of {parts.length} ({plural(p.files, "file")}, {size(p.bytes)})
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * Bring a library in from the zips Export made, its parts all at once (or
 * any OKF folder zipped): its concepts, tags, kept source text, and attached
 * files. The browser reads each zip and sends it up a piece and a file at a
 * time (lib/import-zip.ts), into the library that's open.
 */
export function ImportButton() {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function bringIn(files: File[]) {
    setBusy("Importing");
    const total = { concepts: 0, terms: 0, sources: 0, failed: 0 };
    let firstFailure: { id: string; error: string } | undefined;
    for (const [i, file] of files.entries()) {
      const zip = files.length > 1 ? `zip ${i + 1} of ${files.length}, ` : "";
      try {
        const r = await importZip(file, (done, of) => setBusy(`Importing ${zip}${done} of ${of}`));
        total.concepts += r.concepts;
        total.terms += r.terms;
        total.sources += r.sources;
        total.failed += r.failed;
        firstFailure ??= r.failures[0];
      } catch (exc) {
        toast.error(`${file.name}: ${exc instanceof Error ? exc.message : String(exc)}`);
      }
    }
    const parts = [plural(total.concepts, "concept")];
    if (total.sources > 0) parts.push(plural(total.sources, "source"));
    if (total.terms > 0) parts.push(plural(total.terms, "tag term"));
    toast.success(`Imported ${parts.join(", ")}.`);
    if (firstFailure) {
      toast.error(
        `${plural(total.failed, "item")} weren't imported. ${firstFailure.id}: ${firstFailure.error}`,
      );
    }
    router.refresh();
    setBusy(null);
    if (input.current) input.current.value = "";
  }

  return (
    <>
      <input
        ref={input}
        type="file"
        accept=".zip,application/zip"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length > 0) void bringIn(files);
        }}
      />
      <Button variant="outline" size="sm" disabled={!!busy} onClick={() => input.current?.click()}>
        {busy ? <Spinner /> : <Upload />} {busy ?? "Import"}
      </Button>
    </>
  );
}

/** Empty the library: every concept, link, and kept source, after asking. */
export function DeleteIndexButton() {
  return (
    <ConfirmButton
      label="Empty library"
      title="Empty this library?"
      description="Every concept, link, and file in it goes, with no undo. The library and its plan stay. Export first to keep a copy."
      confirm="Empty the library"
      action={deleteIndex}
    />
  );
}
