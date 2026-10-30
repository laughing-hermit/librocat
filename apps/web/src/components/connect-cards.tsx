import { Fragment } from "react";
import { CopyField } from "@/components/copy-button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  codingAgents,
  connectPage,
  desktopAgents,
  everyAgentCommands,
  STANDARDS,
} from "@/lib/site";
import { link } from "@/lib/utils";

type Where = "landing" | "connect";

// A picker: a segmented control that wraps onto a second row on a phone,
// each tab taking its own height there.
const LIST = "flex-wrap group-data-horizontal/tabs:h-auto";
const TRIGGER = "h-auto after:hidden";

/**
 * Connect's ways in (site.ts): the four coding agents and the desktop
 * agents, each installing librocat's plugin its own way, then every agent
 * at once with a package manager. `cloud`: librocat.com, which the
 * plugins reach, every library of it (the agent's person picks one when it
 * signs in). A self-hosted librocat connects at its own address instead,
 * with MCP + Skills.
 */
type Props = { remote: string; cloud: boolean; where?: Where };

/** The hero's install: the four coding agents, one or two short commands each. */
export function CodingTabs({ className }: { className?: string }) {
  return (
    <Tabs defaultValue={codingAgents[0].agent} className={className}>
      <TabsList className={LIST}>
        {codingAgents.map((c) => (
          <TabsTrigger key={c.agent} value={c.agent} className={TRIGGER}>
            {c.agent}
          </TabsTrigger>
        ))}
      </TabsList>
      {codingAgents.map((c) => (
        <TabsContent key={c.agent} value={c.agent}>
          <div className="flex flex-col gap-2 text-left">
            <p className="text-sm text-muted-foreground">{c.where}</p>
            {c.steps.map((step) => (
              <CopyField
                key={step}
                value={step}
                command={c.shell}
                counted={{ method: c.method, where: "landing" }}
              />
            ))}
          </div>
        </TabsContent>
      ))}
    </Tabs>
  );
}

/** The four coding agents, each installing the plugin its own way (librocat.com). */
export function CodingAgentsCard({ where = "connect" }: { where?: Where }) {
  return (
    <Section title={connectPage.coding.title} description={connectPage.coding.description}>
      <Tabs defaultValue={codingAgents[0].agent}>
        <TabsList className={LIST}>
          {codingAgents.map((c) => (
            <TabsTrigger key={c.agent} value={c.agent} className={TRIGGER}>
              {c.agent}
            </TabsTrigger>
          ))}
        </TabsList>
        {codingAgents.map((c) => (
          <TabsContent key={c.agent} value={c.agent} className="mt-3">
            <Step label={c.where}>
              {c.steps.map((step) => (
                <CopyField
                  key={step}
                  value={step}
                  command={c.shell}
                  counted={{ method: c.method, where }}
                />
              ))}
            </Step>
          </TabsContent>
        ))}
      </Tabs>
    </Section>
  );
}

/**
 * Every agent on this computer at once, one tab per package manager: the
 * plugin into every agent that takes Agent Plugins, and MCP + Skills for
 * the rest. A self-hosted librocat, which the plugin can't reach, takes
 * MCP + Skills alone.
 */
export function EveryAgentCard({ remote, cloud, where = "connect" }: Props) {
  const tabs = everyAgentCommands(remote);
  const text = connectPage.everyAgent;
  return (
    <Section title={text.title} description={text.description}>
      <Tabs defaultValue={tabs[0]?.pm}>
        <TabsList className={LIST}>
          {tabs.map((t) => (
            <TabsTrigger key={t.pm} value={t.pm} className={TRIGGER}>
              {t.pm}
            </TabsTrigger>
          ))}
        </TabsList>
        {tabs.map((t) => (
          <TabsContent key={t.pm} value={t.pm} className="mt-3">
            <div className="flex flex-col gap-4">
              {cloud && (
                <Step label={<Linked text={text.plugin} />}>
                  <CopyField value={t.plugin} command counted={{ method: "plugin", where }} />
                </Step>
              )}
              <Step label={<Linked text={cloud ? text.mcpSkills : text.mcpSkillsSelfHost} />}>
                <CopyField value={t.mcp} command counted={{ method: "mcp", where }} />
                <CopyField value={t.skills} command counted={{ method: "skills", where }} />
              </Step>
            </div>
          </TabsContent>
        ))}
      </Tabs>
    </Section>
  );
}

/**
 * The desktop agents that work on your computer: Claude Desktop, ChatGPT
 * Desktop, Grok Bot, each installing librocat's plugin, which brings the
 * skills and the MCP together; and, where an agent has one, its way without
 * an admin (`personal`): the address, the MCP without the skills. A
 * self-hosted librocat, which the plugin can't reach, takes the address
 * alone.
 */
export function DesktopAgentsCard({ remote, cloud, where = "connect" }: Props) {
  return (
    <Section title={connectPage.desktop.title} description={connectPage.desktop.description}>
      <Tabs defaultValue={desktopAgents[0].agent}>
        <TabsList className={LIST}>
          {desktopAgents.map((d) => (
            <TabsTrigger key={d.agent} value={d.agent} className={TRIGGER}>
              {d.agent}
            </TabsTrigger>
          ))}
        </TabsList>
        {desktopAgents.map((d) => (
          <TabsContent key={d.agent} value={d.agent} className="mt-3">
            {cloud ? (
              <div className="flex flex-col gap-4">
                <Step label={d.plugin}>
                  <CopyField value={d.value} counted={{ method: d.method, where }} />
                  <p className="text-sm text-muted-foreground">{d.after}</p>
                </Step>
                {"personal" in d && (
                  <Step label={d.personal}>
                    <CopyField value={remote} counted={{ method: "mcp", where }} />
                  </Step>
                )}
              </div>
            ) : (
              <Step label={d.mcpOnly}>
                <CopyField value={remote} counted={{ method: d.method, where }} />
              </Step>
            )}
          </TabsContent>
        ))}
      </Tabs>
    </Section>
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function Step({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-muted-foreground">{label}</p>
      {children}
    </div>
  );
}

const STANDARD_NAMES = new RegExp(`(${Object.keys(STANDARDS).join("|")})`);

/** A line with each standard it names (site.ts STANDARDS) linked to the standard's own site. */
function Linked({ text }: { text: string }) {
  let at = 0;
  return text.split(STANDARD_NAMES).map((part) => {
    const key = at;
    at += part.length;
    const href = STANDARDS[part as keyof typeof STANDARDS];
    return href ? (
      <a key={key} href={href} className={link} rel="noreferrer">
        {part}
      </a>
    ) : (
      <Fragment key={key}>{part}</Fragment>
    );
  });
}
