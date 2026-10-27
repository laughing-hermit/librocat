"use client";

import { LogOut, Settings } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { type ComponentProps, useState } from "react";
import { ButtonLink } from "@/components/button-link";
import { type LibraryItem, LibrarySwitcher } from "@/components/library-switcher";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
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
import { authClient } from "@/lib/auth-client";
import { settingsNav } from "@/lib/site";

const under = (href: string, pathname: string) =>
  pathname === href || pathname.startsWith(`${href}/`);

/** Library and Settings are each one place over several pages. */
const isActive = (href: string, pathname: string) => {
  if (href === "/dashboard/concepts") {
    return under(href, pathname) || under("/dashboard/sources", pathname);
  }
  if (href === "/dashboard/library") {
    return settingsNav.some((t) => pathname === t.href) || pathname === "/dashboard/library/new";
  }
  return under(href, pathname);
};

/** The dashboard's one bar: the library, its places, and you. On a phone the places wrap under it. */
export function AppHeader({
  items,
  email,
  libraries,
  selfHost,
}: {
  items: { href: string; label: string }[];
  email: string;
  libraries: LibraryItem[];
  selfHost: boolean;
}) {
  const pathname = usePathname();
  return (
    <header className="sticky top-0 z-10 border-b bg-background">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-2 gap-y-1 px-4 py-2">
        {/* Its icon on the page's left edge: the ghost button's padding and border, taken back. */}
        <div className="-ml-2.75">
          <LibrarySwitcher libraries={libraries} selfHost={selfHost} />
        </div>
        <nav className="order-last flex w-full gap-1 sm:order-none sm:w-auto">
          {items.map((item) => (
            <NavLink
              key={item.href}
              href={item.href}
              variant={isActive(item.href, pathname) ? "secondary" : "ghost"}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <NavUser email={email} />
      </div>
    </header>
  );
}

/**
 * A place in the bar. Dashboard links don't prefetch (each prefetch is a
 * request), but these do once the pointer is on one: the click that
 * usually follows shows its page's skeleton at once. That's one small
 * request, which reads no data, and Next keeps it 5 minutes.
 */
function NavLink(props: ComponentProps<typeof ButtonLink>) {
  const [near, setNear] = useState(false);
  return (
    <ButtonLink {...props} prefetch={near ? null : false} onMouseEnter={() => setNear(true)} />
  );
}

/** Who is signed in: account settings and sign out. */
function NavUser({ email }: { email: string }) {
  const router = useRouter();
  const initial = (email[0] ?? "?").toUpperCase();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="ghost" size="icon" className="ml-auto" aria-label="Account" />}
      >
        <Avatar size="sm">
          <AvatarFallback>{initial}</AvatarFallback>
        </Avatar>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="min-w-56" align="end" sideOffset={4}>
        <DropdownMenuGroup>
          <DropdownMenuLabel>
            <span className="block truncate">{email}</span>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem onClick={() => router.push("/dashboard/account")}>
            <Settings />
            Account
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={async () => {
              await authClient.signOut();
              router.push("/sign-in");
            }}
          >
            <LogOut />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
