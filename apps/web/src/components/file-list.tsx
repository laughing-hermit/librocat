"use client";

import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { FilterChips, matchesWords, SearchBox } from "@/components/library-toolbar";
import { Paged } from "@/components/paged";
import { SortOrder } from "@/components/sort-order";
import { Badge } from "@/components/ui/badge";
import { Item, ItemActions, ItemContent, ItemDescription, ItemTitle } from "@/components/ui/item";

export type FileRow = {
  id: string;
  title: string;
  /** What it is ("PDF", "Web page"): its group on the filter (groupOf). */
  kind: string;
  /** Its one line: kind, name, size, when. */
  line: string;
  /** One of its own sentences, as Jev picked it (fileCatalog.ts). */
  description?: string;
  /** "Reading…" or "Couldn't read it"; none when ready. */
  status?: { label: string; failed: boolean };
  href: string;
};

/** Three groups of file, the filter's chips: a web page, a picture, or a document (the rest). */
const GROUPS = ["Documents", "Web pages", "Pictures"] as const;
type Group = (typeof GROUPS)[number];
const groupOf = (kind: string): Group =>
  kind === "Web page" ? "Web pages" : kind === "Picture" ? "Pictures" : "Documents";

/**
 * The Library's Files, with the toolbar every tab has: a search over each
 * file's title and line, and chips for its three groups, both as you type. Each row is
 * the file's box and opens its page (preview, download, its concepts,
 * Delete), as a concept's row opens it.
 */
export function FileList({ files }: { files: FileRow[] }) {
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState<Group | undefined>();
  const count = (g: Group) => files.filter((f) => groupOf(f.kind) === g).length;
  const shown = files.filter(
    (f) =>
      (!group || groupOf(f.kind) === group) &&
      (!query || matchesWords(`${f.title} ${f.description ?? ""} ${f.line}`, query)),
  );
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <SearchBox value={query} onChange={setQuery} placeholder="Search your files" />
        <FilterChips
          label="Type"
          options={GROUPS.map((g) => ({ value: g, label: g, count: count(g) }))}
          value={group}
          onPick={(v) => setGroup(v as Group | undefined)}
        />
        <SortOrder />
      </div>
      {shown.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing matches.</p>
      ) : (
        <Paged
          key={`${group ?? "all"}:${query}`}
          base="/dashboard/concepts?tab=files"
          param="fpage"
          items={shown.map((f) => (
            <Item
              key={f.id}
              variant="outline"
              size="sm"
              render={<Link href={f.href} prefetch={false} />}
            >
              <ItemContent className="min-w-0">
                <ItemTitle className="max-w-full">
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span>{f.title}</span>
                    {f.status && (
                      <Badge variant={f.status.failed ? "destructive" : "secondary"}>
                        {f.status.label}
                      </Badge>
                    )}
                  </span>
                </ItemTitle>
                {f.description && <ItemDescription>{f.description}</ItemDescription>}
                <ItemDescription>{f.line}</ItemDescription>
              </ItemContent>
              <ItemActions>
                <ChevronRight />
              </ItemActions>
            </Item>
          ))}
        />
      )}
    </div>
  );
}
