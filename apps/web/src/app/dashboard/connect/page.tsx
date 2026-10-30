import { CodingAgentsCard, DesktopAgentsCard, EveryAgentCard } from "@/components/connect-cards";
import { ConnectTabs } from "@/components/connect-tabs";
import { ConnectedAgents } from "@/components/connected-agents";
import { DoneToast } from "@/components/done-toast";
import { PageHeader } from "@/components/page-header";
import { SortOrder } from "@/components/sort-order";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getAgents, mcpUrl } from "@/lib/librocat";
import { requireSession } from "@/lib/require-session";
import { selfHost } from "@/lib/self-host";
import { connectPage } from "@/lib/site";

export const metadata = { title: "Connect | librocat" };

// Two tabs. Ways to connect: the four coding agents and the desktop agents,
// each installing librocat's plugin its own way, then every agent at once
// with a package manager (the plugin, else MCP + Skills, and the address).
// Connected agents: the agents already connected (`?tab=agents`). The same on
// every library: an agent's person picks its library when it signs in
// (/consent, the open one checked). Its title stands alone, as every
// dashboard page's does.
export default async function ConnectPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; tab?: string; sort?: string }>;
}) {
  await requireSession();
  const [remote, { data: agents }, { page, tab, sort }] = await Promise.all([
    mcpUrl(),
    getAgents(),
    searchParams,
  ]);
  // The agents' plugins connect librocat.com/mcp: librocat.com's, not a self-hosted site's.
  const cloud = !selfHost;
  // Yours first, then your teammates', each last used first (agents.list);
  // oldest first reverses each, so yours still lead.
  const all = agents ?? [];
  const listed =
    sort === "oldest"
      ? [...all.filter((a) => a.you).reverse(), ...all.filter((a) => !a.you).reverse()]
      : all;

  return (
    <>
      <PageHeader title="Connect an agent" />
      <DoneToast messages={{ created: "Library created. Connect an agent to it here." }} />
      <ConnectTabs
        initial={tab === "agents" ? "agents" : "connect"}
        count={agents?.length ?? 0}
        connect={
          <div className="flex flex-col gap-6 pt-2">
            {/* Each kind of agent's own plugin, then every agent at once. */}
            {cloud && <CodingAgentsCard />}
            <DesktopAgentsCard remote={remote} cloud={cloud} />
            <EveryAgentCard remote={remote} cloud={cloud} />
          </div>
        }
        agents={
          <div className="pt-2">
            <Card>
              <CardHeader>
                <CardTitle>{connectPage.agents.title}</CardTitle>
                <CardDescription>{connectPage.agents.description}</CardDescription>
                <CardAction>
                  <SortOrder />
                </CardAction>
              </CardHeader>
              <CardContent>
                <ConnectedAgents agents={listed} page={Number(page) || 1} />
              </CardContent>
            </Card>
          </div>
        }
      />
    </>
  );
}
