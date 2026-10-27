import { redirect } from "next/navigation";
import { CodingAgentsCard, DesktopAgentsCard, EveryAgentCard } from "@/components/connect-cards";
import { SitePage } from "@/components/site-chrome";
import { selfHost } from "@/lib/self-host";
import { connectPage, MCP_URL } from "@/lib/site";

export const metadata = {
  title: "Connect an agent | librocat",
  description:
    "Add librocat to Claude Code, Codex, Cursor, and GitHub Copilot, to every agent at once with Agent Plugins or MCP + Skills, and to Claude Desktop, the ChatGPT app, and Grok Bot.",
  alternates: { canonical: "/connect" },
};

/**
 * Every way to connect, in public: the dashboard's Connect cards, at librocat
 * Cloud's address (the landing page's "See every way to connect").
 */
export default function PublicConnectPage() {
  // A self-hosted librocat has its own address, which its dashboard's Connect shows.
  if (selfHost) redirect("/dashboard/connect");
  return (
    <SitePage title="Connect an agent" lede={connectPage.description}>
      <CodingAgentsCard where="landing" />
      <DesktopAgentsCard remote={MCP_URL} cloud where="landing" />
      <EveryAgentCard remote={MCP_URL} cloud where="landing" />
    </SitePage>
  );
}
