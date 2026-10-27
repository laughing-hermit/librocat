import Link from "next/link";
import { Fragment, type ReactNode } from "react";
import { approveAll, decideProposal, dismissGap } from "@/app/dashboard/libro/actions";
import { ConceptBody } from "@/components/concept-body";
import { ConceptLink } from "@/components/concept-link";
import { CopyButton } from "@/components/copy-button";
import { ReviewRow } from "@/components/review-row";
import { RowDate } from "@/components/row-date";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from "@/components/ui/item";
import { type Gap, type Proposal, sourceHref, type Waiting } from "@/lib/librocat";
import type { Group } from "@/lib/review-groups";
import { link } from "@/lib/utils";

/** Each kind of proposal in a person's words, in the order the shelf shows them. */
export const KIND: Record<Proposal["kind"], string> = {
  date: "Needs a review date",
  stale: "Past its review date",
  synonym: "Two names for one tag",
  merge: "Possible duplicate",
  supersede: "Replaced by a newer concept",
  deprecate: "Ready to retire",
  gap: "Couldn't answer a question",
};

/**
 * Each kind's group (lib/review-groups.ts): Missing, Outdated, or
 * Duplicates. Each row's own line says exactly which, and its button what
 * to do.
 */
export const GROUP: Record<Proposal["kind"], Group> = {
  date: "Outdated",
  stale: "Outdated",
  supersede: "Outdated",
  deprecate: "Outdated",
  merge: "Duplicates",
  synonym: "Duplicates",
  gap: "Missing",
};

/** A row waiting for the person: its group, what a search matches, and the row. */
/** A row of Needs you; `at`, when it came up (asked, added, or proposed). */
export type Entry = { key: string; group: Group; text: string; at: number; node: ReactNode };

/** The two rows for an agent: what it couldn't find, and a file no concept cites. */
const COULDNT_FIND = "Couldn't find";
const FILE_WAITING = "File waiting";

/**
 * Everything waiting for the person, one outline row each: what it is
 * about, its kind, one line of why, and its buttons (under the text on a
 * phone). `back`: the page a decision is made on.
 */
export function reviewEntries({
  items,
  titles,
  back,
  gaps = [],
  waiting = [],
  self,
  readOnly = false,
  oldest = false,
}: {
  items: Proposal[];
  /** On a concept's own view: that concept, named without a link to itself. */
  self?: string;
  /** The concepts' titles by id (convex/dashboard.ts). */
  titles: Record<string, string>;
  back: string;
  /** Home: this week's questions with no answer yet. */
  gaps?: Gap[];
  /** Home: sources no concept cites yet. */
  waiting?: Waiting[];
  /** A Reader's: the same rows, without their buttons (they change nothing). */
  readOnly?: boolean;
  /** Oldest first; else newest first (the list's sort). */
  oldest?: boolean;
}): Entry[] {
  const ask = gaps.map((g) => ({
    key: `gap:${g.key}`,
    group: "Missing" as const,
    at: g.at,
    text: `${g.text} ${COULDNT_FIND}`,
    node: (
      <ForAgent
        title={<span>{g.text}</span>}
        kind="Missing"
        when={<RowDate label="Last asked" at={g.at} />}
        about={g.count > 1 ? `Asked ${g.count} times, no answer yet.` : "Asked, no answer yet."}
        prompt={`Save to librocat what you know about '${g.text}'.`}
        dismiss={dismissGap.bind(null, "question", g.key)}
        readOnly={readOnly}
      />
    ),
  }));
  const files = waiting.map((w) => ({
    key: `file:${w.id}`,
    group: "Missing" as const,
    at: w.at,
    text: `${w.title} ${FILE_WAITING}`,
    node: (
      <ForAgent
        title={
          <Link href={sourceHref(w.id)} className={link} prefetch={false}>
            {w.title}
          </Link>
        }
        kind="Missing"
        when={<RowDate label="Added" at={w.at} />}
        about="No concepts cite it yet. Copy the prompt into your agent, and it writes them from it."
        prompt={`Read the source '${w.title}' in librocat and save what matters as concepts.`}
        dismiss={dismissGap.bind(null, "source", w.id)}
        readOnly={readOnly}
      />
    ),
  }));
  const proposals = items.map((p) => ({
    key: `proposal:${p.id}`,
    group: GROUP[p.kind],
    at: p.created_at,
    text: [
      titles[p.subject] ?? p.subject,
      p.target ? (titles[p.target] ?? p.target) : "",
      KIND[p.kind],
    ].join(" "),
    node: proposalRow(p, titles, back, self, readOnly),
  }));
  return [...ask, ...files, ...proposals].sort((a, b) => (oldest ? a.at - b.at : b.at - a.at));
}

/**
 * One proposal's row. In Needs you it opens under itself: a merge's draft,
 * or the concept it's about (a tag pair has nothing more to show). On a
 * concept's own view it stays one line, the concept being open already.
 */
function proposalRow(
  p: Proposal,
  titles: Record<string, string>,
  back: string,
  self: string | undefined,
  readOnly: boolean,
) {
  const head = (
    <>
      <ItemTitle className="max-w-full">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Subjects proposal={p} titles={titles} self={self} />
          <Badge variant="secondary">{GROUP[p.kind]}</Badge>
          <RowDate label="Proposed" at={p.created_at} />
        </span>
      </ItemTitle>
      <ItemDescription>
        {p.reason}
        {p.kind === "merge" && (
          <>
            {" "}
            <DraftCheck support={p.support} />
          </>
        )}
      </ItemDescription>
    </>
  );
  const actions = readOnly ? null : <Decide proposal={p} back={back} />;
  if (self !== undefined || p.kind === "synonym") {
    return (
      <Item variant="outline" size="sm">
        <ItemContent className="min-w-0">{head}</ItemContent>
        {actions && (
          <ItemActions className="basis-full flex-wrap sm:basis-auto">{actions}</ItemActions>
        )}
      </Item>
    );
  }
  return p.kind === "merge" ? (
    <ReviewRow head={head} actions={actions} shown={<Draft proposal={p} />} />
  ) : (
    <ReviewRow head={head} actions={actions} concept={p.subject} />
  );
}

/** The kinds approved as a group (neither rewrites a concept's text): a button each, with its count. */
export function approveAllOf(items: Proposal[]): ReactNode[] {
  const dates = items.filter((p) => p.kind === "date").map((p) => p.id);
  const synonyms = items.filter((p) => p.kind === "synonym").map((p) => p.id);
  const button = (ids: string[], label: string) => (
    <form key={label} action={approveAll.bind(null, ids)}>
      <Button type="submit" size="sm" variant="outline">
        {label}
      </Button>
    </form>
  );
  return [
    ...(dates.length > 1 ? [button(dates, `Set ${dates.length} suggested dates`)] : []),
    ...(synonyms.length > 1 ? [button(synonyms, `Approve ${synonyms.length} tag pairs`)] : []),
  ];
}

/** A concept's own proposals, on its page: the same rows, in one list. */
export function ReviewShelf(props: {
  items: Proposal[];
  titles: Record<string, string>;
  back: string;
  self?: string;
  readOnly?: boolean;
}) {
  return (
    <ItemGroup>
      {reviewEntries(props).map((e) => (
        <Fragment key={e.key}>{e.node}</Fragment>
      ))}
    </ItemGroup>
  );
}

/** A row for the person's agent, not for a decision: copy what to tell it, or Dismiss. */
function ForAgent({
  title,
  kind,
  when,
  about,
  prompt,
  dismiss,
  readOnly = false,
}: {
  title: ReactNode;
  kind: string;
  /** Its date on the list ("Last asked Oct 23"). */
  when: ReactNode;
  about: string;
  prompt: string;
  dismiss: () => Promise<void>;
  readOnly?: boolean;
}) {
  return (
    <Item variant="outline" size="sm">
      <ItemContent className="min-w-0">
        <ItemTitle className="max-w-full">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {title}
            <Badge variant="secondary">{kind}</Badge>
            {when}
          </span>
        </ItemTitle>
        <ItemDescription>{about}</ItemDescription>
      </ItemContent>
      {!readOnly && (
        <ItemActions className="basis-full flex-wrap sm:basis-auto">
          <CopyButton value={prompt} text="Copy prompt" />
          <form action={dismiss}>
            <Button type="submit" size="sm" variant="outline">
              Dismiss
            </Button>
          </form>
        </ItemActions>
      )}
    </Item>
  );
}

/** The concepts an item is about, by title (a tag pair, by its two tags). */
function Subjects({
  proposal: p,
  titles,
  self,
}: {
  proposal: Proposal;
  titles: Record<string, string>;
  /** The concept the shelf is shown for (none in Needs you, where every name is plain). */
  self?: string;
}) {
  // In Needs you the row itself opens the concept: names, not links. On a
  // concept's own view, the other concept of a pair is a link to it.
  const named = (id: string) =>
    self === undefined || id === self ? (
      <span>{titles[id] ?? id}</span>
    ) : (
      <ConceptLink id={id}>{titles[id] ?? id}</ConceptLink>
    );
  if (p.kind === "synonym") {
    return (
      <span className="font-mono">
        {p.subject} → {p.target}
      </span>
    );
  }
  const both = p.target && p.kind !== "stale" && p.kind !== "date" && p.kind !== "gap";
  return (
    <span>
      {named(p.subject)}
      {both && p.target && (
        <>
          {" → "}
          {named(p.target)}
        </>
      )}
    </span>
  );
}

function Decide({ proposal: p, back }: { proposal: Proposal; back: string }) {
  if (p.kind === "stale") {
    return (
      <>
        <form action={decideProposal.bind(null, p.id, "verify", back)}>
          <Button type="submit" size="sm">
            Still true
          </Button>
        </form>
        <form action={decideProposal.bind(null, p.id, "approve", back)}>
          <Button type="submit" size="sm" variant="outline">
            Retire
          </Button>
        </form>
      </>
    );
  }
  return (
    <>
      {p.kind === "date" && p.target ? (
        // The suggested date, which the person may change before setting it
        // (convex/libro.ts decideProposal checks it is after today).
        <form
          action={decideProposal.bind(null, p.id, "approve", back)}
          className="flex items-center gap-2"
        >
          <Input
            name="date"
            type="date"
            aria-label="Review date"
            required
            min={tomorrow()}
            defaultValue={p.target}
            className="w-36"
          />
          <Button type="submit" size="sm">
            Set
          </Button>
        </form>
      ) : (
        <form action={decideProposal.bind(null, p.id, "approve", back)}>
          <Button type="submit" size="sm">
            {APPROVE[p.kind] ?? "Approve"}
          </Button>
        </form>
      )}
      <form action={decideProposal.bind(null, p.id, "dismiss", back)}>
        <Button type="submit" size="sm" variant="outline">
          Dismiss
        </Button>
      </form>
    </>
  );
}

/** Approve, named for what it does, so a glance says what a click changes. */
const APPROVE: Record<string, string> = {
  merge: "Merge",
  supersede: "Replace",
  deprecate: "Retire",
  gap: "Mark stale",
};

/** Tomorrow as YYYY-MM-DD (UTC): the earliest review date a person can pick. */
function tomorrow(): string {
  return new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
}

/**
 * Approving a merge rewrites its target with this draft (convex/libro.ts
 * decideProposal): it's what the row opens to, to read before Merge.
 */
function Draft({ proposal: p }: { proposal: Proposal }) {
  if (!p.draft) return <p className="text-sm text-muted-foreground">No draft to show.</p>;
  return (
    <div className="flex flex-col gap-2">
      {p.draft.title && <p className="text-sm font-medium">{p.draft.title}</p>}
      {p.draft.description && (
        <p className="text-sm text-muted-foreground">{p.draft.description}</p>
      )}
      {p.draft.body && <ConceptBody id={p.target ?? p.subject} body={p.draft.body} />}
    </div>
  );
}

// A merge draft is agent-written, so Jev checks it against its two sources
// (convex/libro.ts checkDraft). Below 80 % it says something neither says.
function DraftCheck({ support }: { support: number | null }) {
  if (support === null) return <span>Not checked against its sources yet.</span>;
  const pct = Math.round(support * 100);
  return support >= 0.8 ? (
    <span>The draft matches its sources ({pct}%).</span>
  ) : (
    <span className="text-destructive">
      The draft says things its sources don't ({pct}%). Read both first.
    </span>
  );
}
