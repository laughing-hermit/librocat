"use client";

import { Plug } from "lucide-react";
import { Fragment, useTransition } from "react";
import { toast } from "sonner";
import { revokeAgent } from "@/app/dashboard/connect/actions";
import { ConfirmButton } from "@/components/confirm-button";
import { Paged } from "@/components/paged";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemSeparator,
  ItemTitle,
} from "@/components/ui/item";
import { shortDate } from "@/lib/utils";

export type ConnectedAgent = {
  key: string;
  clientId: string;
  /** The app: Claude Code, Cursor, ChatGPT, ... (convex/apps.ts appLabel). */
  app: string;
  /** Whose agent: their name, else their email. */
  person: string;
  you: boolean;
  library: string | null;
  connectedAt: number | null;
  usedAt: number | null;
};

const DAY = 86_400_000;
/** Agents on one page of the list. */
const PER_PAGE = 5;

/** "Used today", "Used yesterday", "Used Oct 20", or "Not used yet" (days in UTC, as shortDate). */
function used(at: number | null): string {
  if (!at) return "Not used yet";
  const days = Math.floor(Date.now() / DAY) - Math.floor(at / DAY);
  if (days <= 0) return "Used today";
  if (days === 1) return "Used yesterday";
  return `Used ${shortDate(at)}`;
}

/**
 * Every agent in your libraries, yours first, then your teammates', in the
 * order given (last used first, or oldest first): the app, whose it is, its
 * library, when it was last used, and since when it's connected. PER_PAGE at a time (shadcn's Pagination, as the Library pages
 * its rows), starting on `page`. Only your own can be disconnected.
 */
export function ConnectedAgents({ agents, page }: { agents: ConnectedAgent[]; page: number }) {
  const [pending, start] = useTransition();
  if (agents.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Plug />
          </EmptyMedia>
          <EmptyTitle>No agents yet</EmptyTitle>
          <EmptyDescription>
            Install librocat from Ways to connect. Your agent shows up here.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }
  return (
    <Paged
      base="/dashboard/connect?tab=agents"
      start={page}
      perPage={PER_PAGE}
      items={agents.map((a, i) => (
        <Fragment key={a.key}>
          {/* A line between rows, and none above a page's first. */}
          {i % PER_PAGE > 0 && <ItemSeparator />}
          <Item size="sm">
            <ItemMedia>
              <Avatar>
                <AvatarFallback>{(a.person[0] ?? "?").toUpperCase()}</AvatarFallback>
              </Avatar>
            </ItemMedia>
            {/* min-w-0 and max-w-full let a long name truncate, so the badge stays on a phone. */}
            <ItemContent className="min-w-0">
              <ItemTitle className="max-w-full">
                <span className="truncate">
                  {a.app} · {a.person}
                </span>
                {a.you && <Badge variant="secondary">You</Badge>}
              </ItemTitle>
              <ItemDescription>
                {[a.library, used(a.usedAt), a.connectedAt && `Since ${shortDate(a.connectedAt)}`]
                  .filter(Boolean)
                  .join(" · ")}
              </ItemDescription>
            </ItemContent>
            {a.you && (
              <ItemActions>
                <ConfirmButton
                  label="Disconnect"
                  title={`Disconnect ${a.app}?`}
                  description="It stops reaching your library and has to sign in again."
                  confirm="Disconnect"
                  pending={pending}
                  onConfirm={() =>
                    start(async () => {
                      try {
                        await revokeAgent(a.clientId);
                        toast.success(`${a.app} is disconnected`);
                      } catch {
                        toast.error("Could not disconnect the agent");
                      }
                    })
                  }
                />
              </ItemActions>
            )}
          </Item>
        </Fragment>
      ))}
    />
  );
}
