"use client";

import { AlertTriangle } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { createLibraryAndCheckout } from "@/app/dashboard/billing/actions";
import {
  createLibrary,
  deleteLibrary,
  type LibraryResult,
  leaveLibrary,
  renameLibrary,
} from "@/app/dashboard/library/actions";
import { ConfirmButton } from "@/components/confirm-button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { count, countRedirect } from "@/lib/analytics";
import { sentence } from "@/lib/utils";

function useAction() {
  const [pending, start] = useTransition();
  const act = (fn: () => Promise<LibraryResult>, done?: string) =>
    start(async () => {
      const result = await fn();
      if (!result.ok) toast.error(sentence(result.error));
      else if (done) toast.success(done);
    });
  return { pending, act };
}

/** Name a new library; it opens on its Connect page. */
export function NewLibraryForm() {
  const { pending, act } = useAction();
  const [name, setName] = useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        act(() => countRedirect("library_created", () => createLibrary(name)));
      }}
    >
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="library-name">Name</FieldLabel>
          <Input
            id="library-name"
            value={name}
            maxLength={60}
            placeholder="Acme docs"
            onChange={(e) => setName(e.target.value)}
            required
          />
          <FieldDescription>You can rename it later.</FieldDescription>
        </Field>
        <Field orientation="horizontal">
          <Button type="submit" disabled={pending || !name.trim()}>
            Create library
          </Button>
        </Field>
      </FieldGroup>
    </form>
  );
}

/**
 * Name a library that comes with a plan (past the one Free library): it is
 * made, then its Checkout opens, billed yearly.
 */
export function NewPaidLibraryForm() {
  const [pending, start] = useTransition();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const buy = (plan: "individual" | "team") =>
    start(async () => {
      count("checkout_started", { plan, interval: "annual" });
      const result = await createLibraryAndCheckout(name, plan);
      setError(result.error);
    });
  return (
    <form onSubmit={(e) => e.preventDefault()}>
      <FieldGroup>
        {error && (
          <Alert variant="destructive">
            <AlertTriangle />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <Field>
          <FieldLabel htmlFor="library-name">Name</FieldLabel>
          <Input
            id="library-name"
            value={name}
            maxLength={60}
            placeholder="Acme engineering"
            onChange={(e) => setName(e.target.value)}
            required
          />
          <FieldDescription>You can rename it later.</FieldDescription>
        </Field>
        <Field orientation="horizontal">
          <Button type="button" disabled={pending || !name.trim()} onClick={() => buy("team")}>
            Create with Team
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={pending || !name.trim()}
            onClick={() => buy("individual")}
          >
            Create with Individual
          </Button>
        </Field>
      </FieldGroup>
    </form>
  );
}

export function RenameLibraryForm({ name: initial }: { name: string }) {
  const { pending, act } = useAction();
  const [name, setName] = useState(initial);
  return (
    <form
      className="flex max-w-md gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        act(() => renameLibrary(name), "Renamed");
      }}
    >
      <Input
        aria-label="Library name"
        value={name}
        maxLength={60}
        onChange={(e) => setName(e.target.value)}
        required
      />
      <Button
        type="submit"
        variant="outline"
        disabled={pending || !name.trim() || name.trim() === initial}
      >
        Save
      </Button>
    </form>
  );
}

/**
 * Delete one library for good: its concepts, members' access, and plan, after
 * asking in words that say what happens to the plan (src/lib/delete-copy.ts).
 */
export function DeleteLibraryControl({
  id,
  title,
  description,
}: {
  id: string;
  title: string;
  description: string;
}) {
  const { pending, act } = useAction();
  return (
    <ConfirmButton
      label="Delete library"
      title={title}
      description={description}
      confirm="Delete the library"
      pending={pending}
      onConfirm={() => act(() => deleteLibrary(id))}
    />
  );
}

/** Leave a library someone else owns: it goes from your list, and stays for its team. */
export function LeaveLibraryControl({ id, name }: { id: string; name: string }) {
  const { pending, act } = useAction();
  return (
    <ConfirmButton
      label="Leave library"
      title={`Leave “${name}”?`}
      description="It goes from your list and stays for its team. Its admins can invite you back."
      confirm="Leave the library"
      pending={pending}
      onConfirm={() => act(() => leaveLibrary(id))}
    />
  );
}
