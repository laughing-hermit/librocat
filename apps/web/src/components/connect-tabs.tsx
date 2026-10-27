"use client";

import { type ReactNode, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { connectPage } from "@/lib/site";

/**
 * Connect's two views, as the Library's tabs: the ways to connect, and the
 * agents already connected (their count beside it). The view shows in the
 * address (`?tab=`), so a link opens on it and a refresh keeps it.
 */
export function ConnectTabs({
  initial,
  count,
  connect,
  agents,
}: {
  initial: "connect" | "agents";
  count: number;
  connect: ReactNode;
  agents: ReactNode;
}) {
  const [value, setValue] = useState<string>(initial);
  // A new address may name the other view.
  useEffect(() => setValue(initial), [initial]);
  return (
    <Tabs
      value={value}
      onValueChange={(v) => {
        setValue(v);
        const url = new URL(window.location.href);
        url.searchParams.set("tab", v);
        window.history.replaceState(null, "", url);
      }}
    >
      <TabsList variant="line">
        <TabsTrigger value="connect">{connectPage.tabs.connect}</TabsTrigger>
        <TabsTrigger value="agents">
          {connectPage.tabs.agents} <Badge variant="secondary">{count}</Badge>
        </TabsTrigger>
      </TabsList>
      <TabsContent value="connect">{connect}</TabsContent>
      <TabsContent value="agents">{agents}</TabsContent>
    </Tabs>
  );
}
