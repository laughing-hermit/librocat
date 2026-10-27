"use client";

import { useOptimistic, useTransition } from "react";
import { setPayAsYouGo } from "@/app/dashboard/billing/actions";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { count } from "@/lib/analytics";

/**
 * Billing's pay-as-you-go switch, in its card's header (the card says what
 * on and off do): a shadcn Switch over the server action, flipped at once.
 */
export function PayAsYouGoSwitch({ enabled }: { enabled: boolean }) {
  const [pending, start] = useTransition();
  const [on, setOn] = useOptimistic(enabled);
  return (
    <div className="flex items-center gap-2">
      {pending && <Spinner />}
      <Switch
        aria-label="Pay-as-you-go"
        checked={on}
        disabled={pending}
        onCheckedChange={(next) => {
          count("pay_as_you_go", { on: next });
          start(async () => {
            setOn(next);
            await setPayAsYouGo(next);
          });
        }}
      />
    </div>
  );
}
