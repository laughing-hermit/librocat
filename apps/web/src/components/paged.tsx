"use client";

import { useSearchParams } from "next/navigation";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { ItemGroup } from "@/components/ui/item";
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";

/** The pages to number: the first, the last, and the ones around `page`; null is a gap. */
function pagesAround(page: number, count: number): (number | null)[] {
  const out: (number | null)[] = [];
  for (let p = 1; p <= count; p++) {
    if (p === 1 || p === count || Math.abs(p - page) <= 1) out.push(p);
    else if (out.at(-1) !== null) out.push(null);
  }
  return out;
}

/** The address with `param` set to page `p` (the first page has none). */
function withPage(href: string, param: string, p: number): string {
  const url = new URL(href, "http://x");
  if (p > 1) url.searchParams.set(param, String(p));
  else url.searchParams.delete(param);
  return `${url.pathname}${url.search}`;
}

/**
 * A list, `perPage` at a time, with shadcn's Pagination under it: every
 * long list on the dashboard pages this way. Paging is here, with no call;
 * the page shows in the address (`param`) so a refresh keeps it. When the
 * list shrinks (a decision took an item), the page stays in range. `more`
 * is the address of what comes after the last page, when there is more.
 */
export function Paged({
  items,
  start = 1,
  perPage = 10,
  param = "page",
  base,
  more = null,
  moreLabel = "More",
}: {
  items: ReactNode[];
  /** The list's own address, for each page's link. */
  base: string;
  /** The page to show first (1-based). */
  start?: number;
  perPage?: number;
  param?: string;
  more?: string | null;
  moreLabel?: string;
}) {
  const count = Math.max(1, Math.ceil(items.length / perPage));
  const [asked, setAsked] = useState(start);
  // A new address (a link to a concept on another page) picks the page.
  useEffect(() => setAsked(start), [start]);
  // A new order (SortOrder's `?sort=`) starts the list over, from `start`.
  const order = useSearchParams().get("sort");
  const [ordered, setOrdered] = useState(order);
  if (ordered !== order) {
    setOrdered(order);
    setAsked(start);
  }
  const page = Math.min(Math.max(1, asked), count);
  const shown = items.slice((page - 1) * perPage, page * perPage);
  const top = useRef<HTMLDivElement>(null);

  const go = (p: number) => (e: React.MouseEvent) => {
    e.preventDefault();
    setAsked(p);
    window.history.replaceState(null, "", withPage(window.location.href, param, p));
    // The new page starts where the list does, when that's above the screen.
    if ((top.current?.getBoundingClientRect().top ?? 0) < 0) top.current?.scrollIntoView();
  };
  const href = (p: number) => withPage(base, param, p);

  return (
    <div ref={top} className="flex scroll-mt-20 flex-col gap-4">
      <ItemGroup>{shown}</ItemGroup>
      {(count > 1 || more) && (
        <Pagination>
          <PaginationContent>
            {page > 1 && (
              <PaginationItem>
                <PaginationPrevious href={href(page - 1)} onClick={go(page - 1)} />
              </PaginationItem>
            )}
            {pagesAround(page, count).map((p, i) =>
              p === null ? (
                // biome-ignore lint/suspicious/noArrayIndexKey: a gap has no other identity
                <PaginationItem key={`gap-${i}`}>
                  <PaginationEllipsis />
                </PaginationItem>
              ) : (
                <PaginationItem key={p}>
                  <PaginationLink href={href(p)} isActive={p === page} onClick={go(p)}>
                    {p}
                  </PaginationLink>
                </PaginationItem>
              ),
            )}
            {page < count ? (
              <PaginationItem>
                <PaginationNext href={href(page + 1)} onClick={go(page + 1)} />
              </PaginationItem>
            ) : (
              more && (
                <PaginationItem>
                  <PaginationNext href={more} text={moreLabel} />
                </PaginationItem>
              )
            )}
          </PaginationContent>
        </Pagination>
      )}
    </div>
  );
}
