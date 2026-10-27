"use client";

import { useTransition } from "react";
import { setReportEmail } from "@/app/dashboard/libro/actions";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";

/** Libro's review by email, on or off: a shadcn Switch over the server action (Account). */
export function ReportEmailSwitch({ enabled }: { enabled: boolean }) {
  const [pending, start] = useTransition();
  return (
    <>
      {pending && <Spinner />}
      <Switch
        id="report-email"
        aria-label="Email me Libro's review"
        checked={enabled}
        disabled={pending}
        onCheckedChange={(next) => start(() => setReportEmail(next))}
      />
    </>
  );
}
