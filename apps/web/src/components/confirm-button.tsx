"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

/**
 * An action that asks first, in a dialog over the page: its title asks, its
 * description says what happens. Cancel is focused first, so Enter never
 * confirms by accident; Cancel or Esc leaves everything as it was. Confirm
 * sends `action` (a server action, with `fields` as hidden inputs) or calls
 * `onConfirm`. The dialog stays open with a spinner while that runs (for
 * `onConfirm`, while `pending`), then closes, so what follows shows: a
 * toast, another page, or an error. Confirm is red only when the action
 * can't be undone.
 */
export function ConfirmButton({
  label,
  title,
  description,
  confirm,
  destructive = true,
  action,
  fields,
  onConfirm,
  pending = false,
  size = "sm",
  primary = false,
  className,
}: {
  /** The button that opens the dialog ("Delete library"). */
  label: ReactNode;
  /** The question ("Delete “Acme”?"). */
  title: string;
  /** What happens, and what can't be undone. */
  description: string;
  /** The button that does it ("Delete the library"). */
  confirm: string;
  destructive?: boolean;
  action?: (form: FormData) => void | Promise<void>;
  fields?: Record<string, string>;
  onConfirm?: () => void;
  /** `onConfirm`'s work is running: its caller's transition. */
  pending?: boolean;
  size?: "sm" | "default";
  /** The button that opens it is the page's main action (green), not an outline. */
  primary?: boolean;
  /** The first button's width in its place (a plan card's full width). */
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  // Confirm was pressed: close once the work it started is done (at once if none).
  const [confirmed, setConfirmed] = useState(false);
  useEffect(() => {
    if (confirmed && !pending) {
      setConfirmed(false);
      setOpen(false);
    }
  }, [confirmed, pending]);

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger
        render={
          <Button
            variant={primary ? "default" : "outline"}
            size={size}
            disabled={pending}
            className={className}
          />
        }
      >
        {label}
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        {action ? (
          <form action={action} className="contents">
            {Object.entries(fields ?? {}).map(([name, value]) => (
              <input key={name} type="hidden" name={name} value={value} />
            ))}
            <FormButtons
              confirm={confirm}
              destructive={destructive}
              onDone={() => setOpen(false)}
            />
          </form>
        ) : (
          <Buttons
            confirm={confirm}
            destructive={destructive}
            pending={pending}
            onConfirm={() => {
              setConfirmed(true);
              onConfirm?.();
            }}
          />
        )}
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** Cancel, then Confirm: both wait while the action runs. */
function Buttons({
  confirm,
  destructive,
  pending,
  onConfirm,
}: {
  confirm: string;
  destructive: boolean;
  pending: boolean;
  /** Absent, Confirm submits its form. */
  onConfirm?: () => void;
}) {
  return (
    <AlertDialogFooter>
      <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
      <Button
        type={onConfirm ? "button" : "submit"}
        variant={destructive ? "destructive" : "default"}
        disabled={pending}
        onClick={onConfirm}
      >
        {pending && <Spinner data-icon="inline-start" />}
        {confirm}
      </Button>
    </AlertDialogFooter>
  );
}

/**
 * The buttons of a server action's form, pending while it runs. `onDone`
 * once it settles: a redirect back to the same page (an error, say) would
 * otherwise leave the dialog open over it.
 */
function FormButtons({
  confirm,
  destructive,
  onDone,
}: {
  confirm: string;
  destructive: boolean;
  onDone: () => void;
}) {
  const { pending } = useFormStatus();
  const was = useRef(false);
  useEffect(() => {
    if (was.current && !pending) onDone();
    was.current = pending;
  }, [pending, onDone]);
  return <Buttons confirm={confirm} destructive={destructive} pending={pending} />;
}
