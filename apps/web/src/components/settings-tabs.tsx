"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { settingsNav } from "@/lib/site";

/** Settings' tabs: General, Team, and Billing, each its own page. */
export function SettingsTabs({ selfHost = false }: { selfHost?: boolean }) {
  const pathname = usePathname();
  const tabs = selfHost ? settingsNav.filter((t) => t.href !== "/dashboard/billing") : settingsNav;
  return (
    <Tabs value={pathname} className="mb-6">
      <TabsList variant="line">
        {tabs.map((t) => (
          <TabsTrigger
            key={t.href}
            value={t.href}
            nativeButton={false}
            render={<Link href={t.href} prefetch={false} />}
          >
            {t.label}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}
