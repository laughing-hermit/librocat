"use client";

import { type ReactNode, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

/**
 * The Library's three views: what needs the person first (its count a
 * filled badge so it stands out), its concepts, and its files. The view shows in the address
 * (`?tab=`), so a link (the weekly email's) opens on it and a refresh
 * keeps it.
 */
export function LibraryTabs({
  initial,
  counts,
  concepts,
  needs,
  files,
}: {
  initial: "concepts" | "review" | "files";
  /** `review` is null until Needs you is read. */
  counts: { concepts: number; review: number | null; files: number };
  concepts: ReactNode;
  needs: ReactNode;
  files: ReactNode;
}) {
  const [value, setValue] = useState<string>(initial);
  // A new address (a filter, a decision's failure) may name another view.
  // The view opened on goes in the address, so a decision's re-render (the
  // last one leaves nothing waiting) stays on it.
  useEffect(() => {
    setValue(initial);
    const url = new URL(window.location.href);
    if (!url.searchParams.has("tab")) {
      url.searchParams.set("tab", initial);
      window.history.replaceState(null, "", url);
    }
  }, [initial]);
  return (
    <Tabs
      value={value}
      onValueChange={(v) => {
        setValue(v);
        const url = new URL(window.location.href);
        // The choice is kept, so a refresh opens the view picked, either way.
        url.searchParams.set("tab", v);
        window.history.replaceState(null, "", url);
      }}
    >
      {/* What needs the person first: the view the Library opens on. */}
      <TabsList variant="line">
        <TabsTrigger value="review">
          Needs you
          {counts.review ? <Badge>{counts.review}</Badge> : null}
        </TabsTrigger>
        <TabsTrigger value="concepts">
          Concepts <Badge variant="secondary">{counts.concepts.toLocaleString("en-US")}</Badge>
        </TabsTrigger>
        <TabsTrigger value="files">
          Files <Badge variant="secondary">{counts.files}</Badge>
        </TabsTrigger>
      </TabsList>
      <TabsContent value="review">{needs}</TabsContent>
      <TabsContent value="concepts">{concepts}</TabsContent>
      <TabsContent value="files">{files}</TabsContent>
    </Tabs>
  );
}
