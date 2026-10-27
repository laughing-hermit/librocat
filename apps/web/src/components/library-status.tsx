import { AlertTriangle, CheckCircle2, Circle } from "lucide-react";
import { ButtonLink } from "@/components/button-link";
import { CopyButton } from "@/components/copy-button";
import { UpgradeButton } from "@/components/plan-cards";
import { ReviewQueue } from "@/components/review-queue";
import { approveAllOf, reviewEntries } from "@/components/review-shelf";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import type { Library, Status } from "@/lib/librocat";

/** What needs the person, as the Library reads it. */
type Review = NonNullable<Library["review"]>;

import { selfHost } from "@/lib/self-host";
import { formatBytes } from "@/lib/utils";

// What Home showed, now in the Library: the first-run steps, the near-limit
// alerts, the review queue (Needs you), and a self-hosted library's model.

/** What to tell an agent first: copied from the first-run card. */
const FIRST_PROMPT =
  "Save to librocat how we deploy: the steps, who approves, and how to roll back.";
/** A Reader's agents search; they don't save. */
const READER_PROMPT = "Search librocat for how we deploy.";

export /** Two steps to a first concept; gone once there is one. A Reader's second is a search. */
function FirstRun({ agents, reader = false }: { agents: number; reader?: boolean }) {
  const connected = agents > 0;
  const prompt = reader ? READER_PROMPT : FIRST_PROMPT;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Get started</CardTitle>
        <CardDescription>{connected ? "1 of 2 done" : "Two steps"}</CardDescription>
      </CardHeader>
      <CardContent>
        <ItemGroup>
          <Item variant="outline" size="sm">
            <ItemMedia variant="icon">
              {connected ? <CheckCircle2 className="text-primary" /> : <Circle />}
            </ItemMedia>
            <ItemContent>
              <ItemTitle>1. Connect an agent</ItemTitle>
              <ItemDescription>
                Claude Code, Codex, Cursor, GitHub Copilot, or any agent you use.
              </ItemDescription>
            </ItemContent>
            {!connected && (
              <ItemActions>
                <ButtonLink href="/dashboard/connect" size="sm" prefetch={false}>
                  Connect
                </ButtonLink>
              </ItemActions>
            )}
          </Item>
          <Item variant="outline" size="sm">
            <ItemMedia variant="icon">
              <Circle />
            </ItemMedia>
            <ItemContent>
              <ItemTitle>{reader ? "2. Ask it something" : "2. Save your first concept"}</ItemTitle>
              <ItemDescription>Tell your agent: “{prompt}”</ItemDescription>
            </ItemContent>
            <ItemActions>
              <CopyButton value={prompt} text="Copy prompt" />
            </ItemActions>
          </Item>
        </ItemGroup>
      </CardContent>
    </Card>
  );
}

/** At 80% of a limit the Library says so; the banner on every page takes over at 95% (layout.tsx). */
const NEAR = 0.8;
const FULL = 0.95;

/** Documents and pictures at 80% of the plan's storage, below the banner's 95%. */
export function StorageNear({ status, admin }: { status: Status; admin: boolean }) {
  const max = status.sources.max_bytes ?? null;
  const used = status.sources.bytes;
  if (selfHost || max === null || used < max * NEAR || used >= max * FULL) return null;
  return (
    <Alert>
      <AlertTriangle />
      <AlertTitle>Almost full</AlertTitle>
      <AlertDescription>
        <p>
          {formatBytes(used)} of {formatBytes(max)} of documents and pictures used. Upgrade to keep
          saving.
        </p>
        <div className="mt-2">
          <UpgradeButton plan={status.plan ?? "free"} admin={admin} />
        </div>
      </AlertDescription>
    </Alert>
  );
}

/** Concepts at 80% of the plan's, below the banner's 95%. */
export function ConceptsNear({ status, admin }: { status: Status; admin: boolean }) {
  const max = status.max_concepts ?? null;
  if (selfHost || max === null || status.concepts < max * NEAR || status.concepts >= max * FULL) {
    return null;
  }
  return (
    <Alert>
      <AlertTriangle />
      <AlertTitle>Almost full</AlertTitle>
      <AlertDescription>
        <p>
          {status.concepts.toLocaleString("en-US")} of {max.toLocaleString("en-US")} concepts used.
          Upgrade to keep saving.
        </p>
        <div className="mt-2">
          <UpgradeButton plan={status.plan ?? "free"} admin={admin} />
        </div>
      </AlertDescription>
    </Alert>
  );
}

/** The review queue, or All clear: questions for an agent, files waiting, and Libro's proposals. */
export function NeedsYou({
  review,
  back,
  readOnly = false,
  oldest = false,
}: {
  review: Review;
  back: string;
  /** A Reader's: the rows without their buttons. */
  readOnly?: boolean;
  /** Oldest first; else newest first (`?sort=`). */
  oldest?: boolean;
}) {
  const _free = !selfHost && review.status.plan === "free";
  const q = review.questions;
  const found =
    q.asked === 0
      ? "No searches this week."
      : `${q.answered.toLocaleString("en-US")} of ${q.asked.toLocaleString("en-US")} searches found a concept this week.`;
  const entries = reviewEntries({
    items: review.shelf,
    titles: review.titles,
    back,
    gaps: review.questions.gaps,
    waiting: review.waiting,
    readOnly,
    oldest,
  });
  return entries.length === 0 ? (
    <Card>
      <CardContent>
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <CheckCircle2 />
            </EmptyMedia>
            <EmptyTitle>All clear</EmptyTitle>
            {/* What comes here, in the words of the tab's chips, for a first visit. */}
            <EmptyDescription>
              Nothing needs you right now. What's missing, outdated, or duplicated shows up here.{" "}
              {found}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </CardContent>
    </Card>
  ) : (
    <ReviewQueue
      entries={entries}
      actions={readOnly ? [] : approveAllOf(review.shelf)}
      base={back}
    />
  );
}

/** How many things wait for the person: the Needs you tab's count. */
export const needsCount = (review: Review) =>
  review.shelf.length + review.questions.gaps.length + review.waiting.length;

export type ModelStatus = NonNullable<Status["models"]>;

/** A self-hosted librocat has no plan; it shows what runs its model instead. */
export function Models({ models }: { models: ModelStatus }) {
  const m = models.jev;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Model</CardTitle>
        <CardDescription>Set in self-host/.env. Check it with ./models.sh.</CardDescription>
      </CardHeader>
      <CardContent>
        <ItemGroup>
          <Item size="sm">
            <ItemContent>
              <ItemTitle>Descriptions, tags, and duplicate checks</ItemTitle>
              <ItemDescription>
                {"off" in m ? `Off: ${m.off}` : <span className="font-mono">{m.model}</span>}
              </ItemDescription>
            </ItemContent>
          </Item>
        </ItemGroup>
      </CardContent>
    </Card>
  );
}
