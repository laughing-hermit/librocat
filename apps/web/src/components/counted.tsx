"use client";

import { type ComponentProps, useEffect, useRef } from "react";
import { count, type PlainEvent } from "@/lib/analytics";

/** Counts `event` once, when it shows: for a server page's success message. */
export function CountOnce({ event }: { event: PlainEvent }) {
  // Once even where React runs effects twice (development).
  const counted = useRef(false);
  useEffect(() => {
    if (counted.current) return;
    counted.current = true;
    count(event);
  }, [event]);
  return null;
}

/** A form that counts `event` when it is sent: for a server page's form and server action. */
export function CountedForm({ event, ...props }: ComponentProps<"form"> & { event: PlainEvent }) {
  return <form {...props} onSubmit={() => count(event)} />;
}
