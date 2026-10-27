"use client";

import { Fragment, type ReactNode, useState } from "react";
import { FilterChips, matchesWords, SearchBox } from "@/components/library-toolbar";
import { Paged } from "@/components/paged";
import type { Entry } from "@/components/review-shelf";
import { SortOrder } from "@/components/sort-order";
import { GROUPS, type Group } from "@/lib/review-groups";

/**
 * The review queue (the Library's Needs you), with the toolbar every tab
 * has: a search over the rows and chips for its three groups (Missing,
 * Outdated, Duplicates), the words on the rows' badges, ten rows a page. Both filter here, as you type: the
 * rows are on the page. A decision re-renders the page in place, so the
 * search, the filter, and the page stay; a group left empty falls back to
 * all. A one-click button for a whole group shows whenever there is one.
 */
export function ReviewQueue({
  entries,
  actions,
  base,
}: {
  entries: Entry[];
  /** The page's address, for each page's link. */
  base: string;
  /** Buttons for a whole group, such as setting every suggested date. */
  actions: ReactNode[];
}) {
  const [query, setQuery] = useState("");
  const [asked, setAsked] = useState<Group | undefined>();
  const count = (g: Group) => entries.filter((e) => e.group === g).length;
  // A group left empty (its last row decided) falls back to all.
  const group = asked && count(asked) > 0 ? asked : undefined;
  const shown = entries.filter(
    (e) => (!group || e.group === group) && (!query || matchesWords(e.text, query)),
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <SearchBox value={query} onChange={setQuery} placeholder="Search what needs you" />
        <FilterChips
          label="Type"
          options={GROUPS.map((g) => ({ value: g, label: g, count: count(g) }))}
          value={group}
          onPick={(v) => setAsked(v as Group | undefined)}
        />
        {actions}
        <SortOrder />
      </div>
      {shown.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing matches.</p>
      ) : (
        <Paged
          key={`${group ?? "all"}:${query}`}
          base={base}
          param="rpage"
          items={shown.map((e) => <Fragment key={e.key}>{e.node}</Fragment>)}
        />
      )}
    </div>
  );
}
