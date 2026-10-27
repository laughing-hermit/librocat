"use client";

import { ArrowDownUp } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

/** The pages a list keeps in the address; a new order starts each on its first. */
const PAGES = ["page", "fpage", "rpage", "after"];

/**
 * Newest or Oldest first, the same on every list: both choices in view, the
 * current one pressed, one click to change. The order is in the address
 * (`?sort=oldest`; newest has none), so a refresh or a link keeps it, and
 * the page's lists all follow it.
 */
export function SortOrder() {
  const router = useRouter();
  const order = useSearchParams().get("sort") === "oldest" ? "oldest" : "newest";
  const [pending, start] = useTransition();
  const pick = (next: string) => {
    if (next === order) return;
    const url = new URL(window.location.href);
    if (next === "oldest") url.searchParams.set("sort", "oldest");
    else url.searchParams.delete("sort");
    for (const p of PAGES) url.searchParams.delete(p);
    start(() => router.push(`${url.pathname}${url.search}`, { scroll: false }));
  };
  return (
    <div className="flex items-center gap-1.5">
      <ArrowDownUp aria-hidden className="size-4 text-muted-foreground" />
      <ToggleGroup
        variant="outline"
        spacing={0}
        aria-label="Sort"
        value={[order]}
        disabled={pending}
        // Pressing the pressed one leaves the order as it is.
        onValueChange={(v: string[]) => v[0] && pick(v[0])}
      >
        <ToggleGroupItem value="newest">Newest</ToggleGroupItem>
        <ToggleGroupItem value="oldest">Oldest</ToggleGroupItem>
      </ToggleGroup>
    </div>
  );
}
