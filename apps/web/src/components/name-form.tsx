"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth-client";

/** Your name, as your teammates see it on Connect's agents and on Team. */
export function NameForm({ name: initial }: { name: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [name, setName] = useState(initial);
  return (
    <form
      className="flex max-w-md gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const { error } = await authClient.updateUser({ name: name.trim() });
          if (error) {
            toast.error(error.message ?? "Could not save your name");
            return;
          }
          toast.success("Saved");
          router.refresh();
        });
      }}
    >
      <Input
        aria-label="Your name"
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
