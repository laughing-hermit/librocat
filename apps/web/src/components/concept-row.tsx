"use client";

import { ChevronRight, Paperclip } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { openConcept } from "@/app/dashboard/concepts/actions";
import { useLazyView, ViewSkeleton } from "@/components/lazy-view";
import { RowDate } from "@/components/row-date";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Item, ItemActions, ItemContent, ItemDescription, ItemTitle } from "@/components/ui/item";

export type Row = {
  id: string;
  title: string;
  description: string;
  type: string;
  /** "draft" or "deprecated" show on the row; "stable" needs no word. */
  status: string;
  cites: number;
  /** Something about it waits for the person (Needs you). */
  review: boolean;
  /** `description` is a search's snippet, its matches in [brackets]. */
  snippet?: boolean;
  /** When it last changed: the list's order (a search's rows have none). */
  updatedAt?: number;
};

/** Only a status worth a glance gets a badge: a stable concept needs none. */
const STATUS: Record<string, string> = { draft: "Draft", deprecated: "Retired" };

/** A search snippet with its matched words in bold, not in brackets. */
function Snippet({ text }: { text: string }) {
  // A snippet cut off mid-match leaves an open bracket at its end.
  return text
    .replace(/\[([^\]]*)$/, "$1")
    .split(/\[([^[\]]+)\]/)
    .map((part, i) =>
      i % 2 === 1 ? (
        // biome-ignore lint/suspicious/noArrayIndexKey: the parts of one string, in order
        <strong key={i} className="font-medium text-foreground">
          {part}
        </strong>
      ) : (
        part
      ),
    );
}

/**
 * One concept in the Library's list, in the box every list uses (Home's
 * too). The whole row opens it, right under the row, fetched once (one
 * counted call) and kept; the address follows, so a refresh or a shared
 * link opens it again. `view` is the concept already rendered, when the
 * page opened on it.
 */
export function ConceptRow({
  row,
  href,
  listHref,
  view: initial,
}: {
  row: Row;
  /** The concept's own address. */
  href: string;
  /** The list's address, for when it closes. */
  listHref: string;
  view?: ReactNode;
}) {
  const [open, setOpen] = useState(initial !== undefined);
  const { view, setView, warm, onPointerEnter } = useLazyView(() => openConcept(row.id), initial);
  const self = useRef<HTMLDivElement>(null);

  // The address names this concept (a link to it, or its own page): it
  // opens, with the view the page brought, at the top of the screen. When
  // the address moves on to another concept, it closes.
  const named = initial !== undefined;
  const wasNamed = useRef(named);
  // biome-ignore lint/correctness/useExhaustiveDependencies: on a change of address only, not of the view's object
  useEffect(() => {
    if (named) {
      setOpen(true);
      setView(initial);
      const top = self.current?.getBoundingClientRect().top ?? 0;
      if (top < 0 || top > window.innerHeight / 2) self.current?.scrollIntoView({ block: "start" });
    } else if (wasNamed.current) setOpen(false);
    wasNamed.current = named;
  }, [named]);

  async function toggle(next: boolean) {
    setOpen(next);
    if (next) window.history.replaceState(null, "", href);
    else if (window.location.pathname === new URL(href, window.location.href).pathname) {
      window.history.replaceState(null, "", listHref);
    }
    if (next) warm();
  }

  return (
    <div ref={self} className="scroll-mt-20 rounded-lg border" onPointerEnter={onPointerEnter}>
      <Collapsible open={open} onOpenChange={toggle}>
        <CollapsibleTrigger nativeButton={false} render={<Item size="sm" />}>
          <ItemContent className="min-w-0">
            <ItemTitle className="max-w-full">
              {/* On a phone the badges wrap under a long title, not over it. */}
              <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span>{row.title}</span>
                <Badge variant="secondary">{row.type}</Badge>
                {STATUS[row.status] && <Badge variant="outline">{STATUS[row.status]}</Badge>}
                {row.review && <Badge variant="outline">Needs you</Badge>}
                {row.cites > 0 && (
                  <Badge variant="outline">
                    <Paperclip />
                    {row.cites === 1 ? "1 file" : `${row.cites} files`}
                  </Badge>
                )}
                {row.updatedAt && <RowDate label="Updated" at={row.updatedAt} />}
              </span>
            </ItemTitle>
            {row.description && (
              <ItemDescription>
                {row.snippet ? <Snippet text={row.description} /> : row.description}
              </ItemDescription>
            )}
          </ItemContent>
          <ItemActions>
            <ChevronRight className="transition-transform in-data-panel-open:rotate-90" />
          </ItemActions>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="px-3 pb-3">{view ?? <ViewSkeleton />}</div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
