"use client";

import { Check, ChevronsUpDown, Library, Plus, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { switchLibrary } from "@/app/dashboard/library/actions";
import { LogoMark } from "@/components/brand";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export type LibraryItem = { id: string; name: string; plan: string; current: boolean };

const PLAN = { free: "Free", individual: "Individual", team: "Team" } as Record<string, string>;

/**
 * Which library the dashboard shows: switch, add one, or upgrade a Free one.
 * Switching changes the dashboard only; each agent keeps the library its
 * URL names.
 */
export function LibrarySwitcher({
  libraries,
  selfHost,
}: {
  libraries: LibraryItem[];
  selfHost: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const current = libraries.find((l) => l.current) ?? libraries[0];
  if (!current) return null;
  const go = (href: string) => router.push(href);
  const pick = (id: string) =>
    start(async () => {
      const result = await switchLibrary(id);
      if (!result.ok) toast.error(result.error);
      else router.refresh();
    });
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" disabled={pending} />}>
        <LogoMark className="size-6" />
        <span className="max-w-40 truncate font-medium">{current.name}</span>
        {!selfHost && (
          <span className="hidden text-muted-foreground sm:inline">
            {PLAN[current.plan] ?? current.plan}
          </span>
        )}
        <ChevronsUpDown className="text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" sideOffset={4} className="min-w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Libraries</DropdownMenuLabel>
          {libraries.map((l) => (
            <DropdownMenuItem key={l.id} onClick={() => !l.current && pick(l.id)}>
              <Library />
              <span className="truncate">{l.name}</span>
              {l.current && <Check className="ml-auto" />}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => go("/dashboard/library/new")}>
          <Plus />
          New library
        </DropdownMenuItem>
        {!selfHost && current.plan === "free" && (
          <DropdownMenuItem onClick={() => go("/dashboard/billing")}>
            <Sparkles />
            Upgrade
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
