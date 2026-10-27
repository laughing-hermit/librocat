"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/** Its children everywhere but on `path` (a layout can't see the page it wraps). */
export function NotOnPage({ path, children }: { path: string; children: ReactNode }) {
  return usePathname() === path ? null : children;
}
