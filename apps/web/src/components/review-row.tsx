"use client";

import { ChevronRight } from "lucide-react";
import { type ReactNode, useState } from "react";
import { openConcept } from "@/app/dashboard/concepts/actions";
import { useLazyView, ViewSkeleton } from "@/components/lazy-view";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Item, ItemActions, ItemContent } from "@/components/ui/item";

/**
 * A Needs you row that opens under itself, as a concept's row does: its
 * text (the title, its kind, one line) and its chevron open it; its
 * buttons decide. What opens is `shown` (a merge's draft, already here) or
 * the concept `concept` names, fetched once (one counted call) and kept.
 */
export function ReviewRow({
  head,
  actions,
  shown,
  concept,
}: {
  /** The title with its kind, and the one line under it. */
  head: ReactNode;
  /** The decision's buttons. */
  actions: ReactNode;
  shown?: ReactNode;
  /** The concept to read, when nothing is `shown`. */
  concept?: string;
}) {
  const [open, setOpen] = useState(false);
  const { view, warm, onPointerEnter } = useLazyView(
    concept ? () => openConcept(concept, true) : null,
    shown,
  );

  function toggle(next: boolean) {
    setOpen(next);
    if (next) warm();
  }

  return (
    <div className="rounded-lg border" onPointerEnter={onPointerEnter}>
      <Collapsible open={open} onOpenChange={toggle}>
        <Item size="sm">
          <CollapsibleTrigger nativeButton={false} render={<ItemContent />}>
            {head}
          </CollapsibleTrigger>
          <ItemActions className="basis-full flex-wrap sm:basis-auto">
            {actions}
            <CollapsibleTrigger
              render={
                <Button variant="ghost" size="icon" aria-label={open ? "Show less" : "Show more"} />
              }
            >
              <ChevronRight className="transition-transform in-data-panel-open:rotate-90" />
            </CollapsibleTrigger>
          </ItemActions>
        </Item>
        <CollapsibleContent>
          <div className="px-3 pb-3">{view ?? <ViewSkeleton />}</div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
