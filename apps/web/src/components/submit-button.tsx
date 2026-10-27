"use client";

import type { ComponentProps } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

/**
 * A form's submit button that shows it's working: a spinner, and no second
 * press, while the form's server action runs. Stripe can take seconds (a
 * Checkout or the portal to open, seats to bill).
 */
export function SubmitButton({
  children,
  disabled,
  ...props
}: Omit<ComponentProps<typeof Button>, "type">) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending || disabled} {...props}>
      {pending && <Spinner data-icon="inline-start" />}
      {children}
    </Button>
  );
}
