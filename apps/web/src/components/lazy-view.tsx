"use client";

import { type ReactNode, useRef, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * A row's view, fetched once when it's first wanted: on hover (a pointer
 * that can hover; a phone never does), or on open. The hover starts the
 * fetch, so the open usually finds it ready: at most one request a row, the
 * top bar's rule (AGENTS.md "Requests cost"). `ready`: a view the page
 * already brought.
 */
export function useLazyView(load: (() => Promise<ReactNode>) | null, ready?: ReactNode) {
  const [view, setView] = useState<ReactNode>(ready ?? null);
  const started = useRef<Promise<void> | null>(ready ? Promise.resolve() : null);
  const warm = () => {
    if (!load || started.current) return;
    started.current = load()
      .then(setView)
      .catch(() => {
        // A failed fetch tries again on the next open.
        started.current = null;
      });
  };
  return {
    view,
    setView,
    warm,
    /** Hover handler: only for a mouse or a pen, never a touch's emulated hover. */
    onPointerEnter: (e: { pointerType: string }) => {
      if (e.pointerType !== "touch") warm();
    },
  };
}

/** A concept's view while it loads: its text lines and its footer, in gray. */
export function ViewSkeleton() {
  return (
    <div role="status" className="flex flex-col gap-2 pt-1" aria-busy="true" aria-label="Loading">
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-11/12" />
      <Skeleton className="h-4 w-2/3" />
      <div className="flex gap-2 pt-2">
        <Skeleton className="h-7 w-20 rounded-md" />
        <Skeleton className="h-7 w-24 rounded-md" />
      </div>
    </div>
  );
}
