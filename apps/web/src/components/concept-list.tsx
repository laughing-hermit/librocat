"use client";

import type { ReactNode } from "react";
import { ConceptRow, type Row } from "@/components/concept-row";
import { Paged } from "@/components/paged";

/** Rows on one page of the Library. */
const PER_PAGE = 10;

export type Listed = { row: Row; href: string; view?: ReactNode };

/**
 * The Library's rows, PER_PAGE at a time (shadcn's Pagination). Paging is
 * here, with no call: the server loads up to 100 rows, and past them
 * `more` is the next 100's address. It starts on the page holding the open
 * concept, or on `page`.
 */
export function ConceptList({
  items,
  listHref,
  openAt,
  page: asked,
  more,
}: {
  items: Listed[];
  listHref: string;
  /** Where the open concept is in `items` (-1: none): its page shows first. */
  openAt: number;
  /** Otherwise the page to show first (1-based, `?page=`). */
  page: number;
  /** The next 100 rows' address, when there are more. */
  more: string | null;
}) {
  const start = openAt >= 0 ? Math.floor(openAt / PER_PAGE) + 1 : asked;
  return (
    <Paged
      items={items.map((c) => (
        <ConceptRow key={c.row.id} row={c.row} href={c.href} listHref={listHref} view={c.view} />
      ))}
      start={start}
      perPage={PER_PAGE}
      base={listHref}
      more={more}
      moreLabel="Next 100"
    />
  );
}
