"use client";

import type { ReactNode } from "react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

/** A concept's line with "N versions" at its end: clicking it opens the versions under the line. */
export function HistoryToggle({
  line,
  count,
  children,
}: {
  line: string;
  count: number;
  children: ReactNode;
}) {
  return (
    <Collapsible>
      <p>
        {line} ·{" "}
        <CollapsibleTrigger>
          <span className="font-medium text-foreground underline-offset-4 hover:underline">
            {count} versions
          </span>
        </CollapsibleTrigger>
      </p>
      <CollapsibleContent>
        <div className="pt-2">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  );
}
