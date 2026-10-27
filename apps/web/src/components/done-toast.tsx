"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { toast } from "sonner";

/**
 * What a server action did, once it has redirected here: its `?done=` key,
 * said as a toast, then taken off the address so a reload doesn't say it
 * again. The page names the keys it knows (a form's action sets one). The
 * address changes in place (replaceState): the page is already up to date,
 * so it isn't rendered again.
 */
export function DoneToast({ messages }: { messages: Record<string, string> }) {
  const params = useSearchParams();
  const pathname = usePathname();
  const done = params.get("done");
  const text = done ? messages[done] : undefined;
  useEffect(() => {
    if (!done) return;
    // One toast however often this runs (an effect runs twice in development).
    if (text) toast.success(text, { id: `done-${done}` });
    const rest = new URLSearchParams(params);
    rest.delete("done");
    const query = rest.size ? `?${rest}` : "";
    window.history.replaceState(null, "", `${pathname}${query}${window.location.hash}`);
  }, [done, text, params, pathname]);
  return null;
}
