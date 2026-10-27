import { PageHeader } from "@/components/page-header";
import { FieldSkeleton, Loading, ROWS } from "@/components/page-skeleton";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { selfHost } from "@/lib/self-host";
import { connectPage } from "@/lib/site";

// Connect while it loads: its two tabs (none picked: it may open on the
// agents), then the ways to connect, its usual view: their cards with their
// real words, a gray bar where each picker will be, and a gray field where
// each command will be.
export default function ConnectLoading() {
  // Self-hosted, no plugin: MCP + Skills alone.
  const cards = [
    ...(selfHost ? [] : [{ ...connectPage.coding, fields: 2 }]),
    { ...connectPage.desktop, fields: 1 },
    { ...connectPage.everyAgent, fields: selfHost ? 2 : 3 },
  ];
  return (
    <Loading>
      <PageHeader title="Connect an agent" />
      <Tabs value={null}>
        <TabsList variant="line">
          <TabsTrigger value="connect">{connectPage.tabs.connect}</TabsTrigger>
          <TabsTrigger value="agents">
            {connectPage.tabs.agents} <Skeleton className="h-5 w-7 rounded-full" />
          </TabsTrigger>
        </TabsList>
        <div className="flex flex-col gap-6 pt-2">
          {cards.map((c) => (
            <Card key={c.title}>
              <CardHeader>
                <CardTitle>{c.title}</CardTitle>
                <CardDescription>{c.description}</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <Skeleton className="h-8 w-80 max-w-full rounded-lg" />
                {ROWS.slice(0, c.fields).map((k) => (
                  <FieldSkeleton key={k} />
                ))}
              </CardContent>
            </Card>
          ))}
        </div>
      </Tabs>
    </Loading>
  );
}
