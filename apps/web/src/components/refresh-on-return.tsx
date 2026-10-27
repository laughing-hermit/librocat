"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** The least time between two refreshes, however often the tab comes back. */
const APART = 10_000;

/**
 * Refreshes a server-rendered page when its tab comes back into view: a new
 * library's Get started, after a person connects an agent in a terminal or
 * has it save a concept, so it ticks without a reload. Nothing runs while
 * the tab is away, and a quick look back and forth refreshes once.
 */
export function RefreshOnReturn() {
  const router = useRouter();
  useEffect(() => {
    let last = 0;
    const back = () => {
      if (document.visibilityState !== "visible" || Date.now() - last < APART) return;
      last = Date.now();
      router.refresh();
    };
    document.addEventListener("visibilitychange", back);
    return () => document.removeEventListener("visibilitychange", back);
  }, [router]);
  return null;
}
