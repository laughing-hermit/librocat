"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Seconds before each refresh: soon at first, then less often, then none (about 2 minutes). */
const WAITS = [3, 5, 8, 13, 21, 30, 30, 30];

/**
 * Refreshes a server-rendered page while `active`: a file's page, or the
 * Library's Files, while librocat reads what was attached, so "Reading…"
 * turns into what it found without a reload. Each refresh is a request
 * (and a counted call), so they come further apart, only while the tab is
 * in view, and stop after the last wait: a reload looks again.
 */
export function RefreshWhile({ active }: { active: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    let step = 0;
    let due = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      due = false;
      step += 1;
      router.refresh();
      wait();
    };
    const wait = () => {
      if (step >= WAITS.length) return;
      timer = setTimeout(() => {
        // Away: the refresh waits for the tab to come back.
        if (document.visibilityState === "visible") refresh();
        else due = true;
      }, WAITS[step] * 1000);
    };
    const back = () => {
      if (due && document.visibilityState === "visible") refresh();
    };
    wait();
    document.addEventListener("visibilitychange", back);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", back);
    };
  }, [active, router]);
  return null;
}
