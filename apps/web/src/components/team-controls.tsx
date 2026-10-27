"use client";

import { ChevronDown } from "lucide-react";
import { useActionState, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  acceptInvite,
  addSeat,
  createInvite,
  type InviteResult,
  removeMember,
  revokeInvite,
  setRole,
  type TeamResult,
} from "@/app/dashboard/team/actions";
import { ConfirmButton } from "@/components/confirm-button";
import { CopyField } from "@/components/copy-button";
import { ErrorAlert } from "@/components/error-alert";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Field, FieldLabel } from "@/components/ui/field";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { count } from "@/lib/analytics";
import { sentence } from "@/lib/utils";

export type Role = "admin" | "editor" | "reader";

/** The roles, as people see them, and what each may do. */
export const ROLES: { value: Role; label: string; does: string }[] = [
  { value: "admin", label: "Admin", does: "Read and write, plus the team and billing" },
  {
    value: "editor",
    label: "Editor",
    does: "Read and write: their agents add to and change the library",
  },
  { value: "reader", label: "Reader", does: "Read only: their agents search and read it" },
];

function useAction() {
  const [pending, start] = useTransition();
  const act = (fn: () => Promise<TeamResult>, done?: string) =>
    start(async () => {
      const result = await fn();
      if (!result.ok) toast.error(sentence(result.error));
      else if (done) toast.success(done);
    });
  return { pending, act };
}

/** A new share link (the old one stops working), counted. */
async function newInviteLink(role: "editor" | "reader"): Promise<InviteResult> {
  const result = await createInvite(role);
  if (result.ok) count("invite_link_created");
  return result;
}

/**
 * The share link: who joins with it (Editors or Readers), then copy it,
 * replace it, or turn it off. Choosing the other role makes a new link.
 */
export function InviteLink({ url, role }: { url: string | null; role: "editor" | "reader" }) {
  const { pending, act } = useAction();
  const [copying, startCopy] = useTransition();
  const [joinAs, setJoinAs] = useState(role);
  // One click: make the link and copy it. The clipboard takes the link as a
  // promise, so the click still counts after the round trip (Safari); if it
  // can't, the link shows below to copy.
  const copyNew = () =>
    startCopy(async () => {
      const made = newInviteLink(joinAs);
      const link = made.then((r) => {
        if (!r.ok) throw new Error(r.error);
        return new Blob([`${window.location.origin}/invite/${r.code}`], { type: "text/plain" });
      });
      // Its failure is told below, from `made`.
      link.catch(() => {});
      try {
        await navigator.clipboard.write([new ClipboardItem({ "text/plain": link })]);
        toast.success("Invite link copied: send it to who should join");
      } catch {
        const r = await made;
        if (r.ok) toast.success("Invite link ready: copy it below");
        else toast.error(r.error);
      }
    });
  const choose = (next: "editor" | "reader") => {
    setJoinAs(next);
    if (url && next !== role) {
      act(
        () => newInviteLink(next),
        `New link: people join as ${next === "reader" ? "Readers" : "Editors"}; the old one no longer works`,
      );
    }
  };
  const joinAsField = (
    <Field>
      <FieldLabel>New people join as</FieldLabel>
      <ToggleGroup
        variant="outline"
        aria-label="New people join as"
        value={[joinAs]}
        disabled={pending}
        onValueChange={(v: string[]) => v[0] && choose(v[0] as "editor" | "reader")}
      >
        <ToggleGroupItem value="editor">Editors</ToggleGroupItem>
        <ToggleGroupItem value="reader">Readers</ToggleGroupItem>
      </ToggleGroup>
    </Field>
  );
  if (!url) {
    return (
      <div className="flex flex-col gap-4">
        {joinAsField}
        <div>
          <Button disabled={pending || copying} onClick={copyNew}>
            Copy invite link
          </Button>
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      {joinAsField}
      <CopyField value={url} label="Invite link copied" />
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={pending}
          onClick={() =>
            act(() => newInviteLink(joinAs), "New link created; the old one no longer works")
          }
        >
          New link
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={pending}
          onClick={() => act(revokeInvite, "Invite link turned off")}
        >
          Turn off
        </Button>
      </div>
    </div>
  );
}

/** An admin's menu on a teammate: what they may do here. */
export function RoleMenu({ userId, name, role }: { userId: string; name: string; role: Role }) {
  const { pending, act } = useAction();
  const label = ROLES.find((r) => r.value === role)?.label ?? "Editor";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="outline" size="sm" disabled={pending} aria-label={`${name}'s role`} />
        }
      >
        {label} <ChevronDown />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-64">
        <DropdownMenuRadioGroup
          value={role}
          onValueChange={(next: string) => {
            if (next === role) return;
            const r = ROLES.find((x) => x.value === next);
            act(() => setRole(userId, next as Role), `${name} is now ${r?.label ?? next}`);
          }}
        >
          {ROLES.map((r) => (
            // Picking a role is the menu's one job: it closes on it.
            <DropdownMenuRadioItem key={r.value} value={r.value} closeOnClick>
              <span className="flex flex-col">
                <span>{r.label}</span>
                <span className="text-xs text-muted-foreground">{r.does}</span>
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function RemoveMember({ userId, email }: { userId: string; email: string }) {
  const { pending, act } = useAction();
  return (
    <ConfirmButton
      label="Remove"
      title={`Remove ${email}?`}
      description="They lose access at once, with their agents. What they wrote stays."
      confirm="Remove"
      pending={pending}
      onConfirm={() => act(() => removeMember(userId), `${email} removed`)}
    />
  );
}

/**
 * Join, as a form: pressed before the page's script has loaded, it still
 * goes through (React sends it once it can), where a click handler's press
 * would be lost.
 */
export function AcceptInvite({ code }: { code: string }) {
  const [state, join, pending] = useActionState(acceptInvite.bind(null, code), null);
  return (
    <form action={join} className="flex flex-col gap-3">
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "…" : "Join"}
      </Button>
      {state && !state.ok && <ErrorAlert>{state.error}</ErrorAlert>}
    </form>
  );
}

/**
 * A full Team's one-click fix: one more seat, after a question that
 * names its price as this Team pays it ("$15 a month", "$150 a year").
 */
export function AddSeat({ seats, price }: { seats: number; price: string }) {
  const { pending, act } = useAction();
  return (
    <ConfirmButton
      label="Add a seat"
      title="Add a seat?"
      description={`One more person can join, at ${price}. Today you pay for it until renewal.`}
      confirm="Add a seat"
      destructive={false}
      primary
      pending={pending}
      onConfirm={() => act(() => addSeat(seats), "Seat added: one more person can join")}
    />
  );
}
