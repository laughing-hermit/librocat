"use client";

import { useEffect, useState } from "react";
import { formatDate } from "@/lib/utils";

/**
 * A moment's date where the viewer is, as Stripe's portal and emails give
 * it: a plan ending at 02:00 UTC ends the evening before in the Americas.
 * The server can't know the viewer's time zone, so it renders the UTC date
 * until the page loads.
 */
export function LocalDate({ at }: { at: number }) {
  const [text, setText] = useState(() => formatDate(at));
  useEffect(() => {
    setText(new Date(at).toLocaleDateString("en-US", { dateStyle: "medium" }));
  }, [at]);
  return <time dateTime={new Date(at).toISOString()}>{text}</time>;
}
