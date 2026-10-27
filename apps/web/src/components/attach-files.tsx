"use client";

import { acceptedExtensions, fileKind, mimeOf } from "@librocat/core/sources";
import { useRouter } from "next/navigation";
import { createContext, useContext, useState } from "react";
import { toast } from "sonner";
import { finishUpload, startUpload } from "@/app/dashboard/sources/actions";
import { count, sizeBucket } from "@/lib/analytics";
import { sourceHref } from "@/lib/hrefs";
import { cn } from "@/lib/utils";

/** What the picker offers: text and pictures, the only files librocat keeps. */
const ACCEPT = ["text/*", "image/*", ...acceptedExtensions()].join(",");

/** Whether a file of a type librocat doesn't know holds text: no NUL byte at its start. */
async function holdsText(file: File): Promise<boolean> {
  return !new Uint8Array(await file.slice(0, 8000).arrayBuffer()).includes(0);
}

type Attach = { busy: string | null; attach: (files: FileList | File[]) => Promise<void> };

/**
 * Attaching documents and pictures, dropped or picked. Each goes straight to
 * Convex storage through an upload URL (never through this site), then
 * becomes a source that librocat reads (convex/attachments.ts).
 * Anything else is refused, with why, before a byte is sent: the server says
 * so when asked for the upload URL.
 */
function useAttachState(): Attach {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  async function attach(files: FileList | File[]) {
    let attached = 0;
    let last: string | undefined;
    for (const file of Array.from(files)) {
      setBusy(file.name);
      try {
        let type = mimeOf(file.name, file.type);
        // A file of no known type, with text in it, is kept as text.
        if (type === "application/octet-stream" && (await holdsText(file))) type = "text/plain";
        // The server refuses anything but text and pictures, with why, and counts its kind.
        const up = await startUpload({ name: file.name, type, size: file.size });
        if (!up.url) throw new Error(up.error ?? "no upload URL");
        const res = await fetch(up.url, {
          method: "POST",
          headers: { "Content-Type": up.type ?? type },
          body: file,
        });
        if (!res.ok) throw new Error(`the upload failed (HTTP ${res.status})`);
        const { storageId } = (await res.json()) as { storageId: string };
        const done = await finishUpload({ storageId, name: file.name });
        if (done.error) throw new Error(done.error);
        attached += 1;
        last = done.id;
        count("file_attached", {
          kind: fileKind(type),
          size: sizeBucket(file.size),
        });
      } catch (exc) {
        toast.error(`${file.name}: ${exc instanceof Error ? exc.message : String(exc)}`);
      }
    }
    setBusy(null);
    if (attached > 0) {
      toast.success(`${attached} file${attached === 1 ? "" : "s"} attached. Reading now.`);
      // One file opens on its own page; several, the Files tab (refreshed, when it's already here).
      const to = attached === 1 && last ? sourceHref(last) : "/dashboard/concepts?tab=files";
      if (`${window.location.pathname}${window.location.search}` === to) router.refresh();
      else router.push(to);
    }
  }
  return { busy, attach };
}

const AttachContext = createContext<Attach | null>(null);

/** One upload at a time for what it wraps: the Add menu and the drop zone share it. */
export function AttachProvider({ children }: { children: React.ReactNode }) {
  return <AttachContext value={useAttachState()}>{children}</AttachContext>;
}

/** The upload in progress (the file's name) and how to start one, from AttachProvider. */
export function useAttach(): Attach {
  const value = useContext(AttachContext);
  if (!value) throw new Error("useAttach needs an AttachProvider");
  return value;
}

/** The hidden file picker behind "Attach files": `ref.current.click()` opens it. */
export function AttachInput({
  ref,
  attach,
}: {
  ref: React.Ref<HTMLInputElement>;
  attach: Attach["attach"];
}) {
  return (
    <input
      ref={ref}
      type="file"
      multiple
      hidden
      accept={ACCEPT}
      aria-label="Attach files"
      onChange={(e) => {
        if (e.target.files?.length) void attach(e.target.files);
        e.target.value = "";
      }}
    />
  );
}

/** Files dropped anywhere on what it wraps are attached; it outlines itself while one hovers. */
export function DropZone({
  children,
  disabled = false,
}: {
  children: React.ReactNode;
  /** A Reader's library: files can't be dropped in. */
  disabled?: boolean;
}) {
  const [over, setOver] = useState(false);
  const { busy, attach } = useAttach();
  if (disabled) return <>{children}</>;
  return (
    <section
      aria-label="Drop files here to attach them"
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        if (!busy && e.dataTransfer.files.length > 0) void attach(e.dataTransfer.files);
      }}
      className={cn("rounded-xl", over && "ring-2 ring-primary ring-offset-4")}
    >
      {children}
    </section>
  );
}
