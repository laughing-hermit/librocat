import { AlertTriangle, Download, History, Paperclip } from "lucide-react";
import Link from "next/link";
import { cache, Fragment } from "react";
import { ButtonLink } from "@/components/button-link";
import { ConceptBody } from "@/components/concept-body";
import { ConceptLink } from "@/components/concept-link";
import { HistoryToggle } from "@/components/history-toggle";
import { ReviewShelf } from "@/components/review-shelf";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import {
  conceptHref,
  getConceptPage,
  type History as HistoryOf,
  shelfOf,
  sourceHref,
  whoWrote,
} from "@/lib/librocat";
import { formatDate, link } from "@/lib/utils";

// The page, its tab title, and the open row share one counted call per request.
export const conceptPage = cache((id: string, rev?: string) => getConceptPage(id, rev));

/**
 * A concept, opened in the Library's list, in one view: its text, one line
 * of what it is (its versions open under it), its links, and its kept
 * files. With `close` when it
 * opens above the list, because its row isn't on this page of it.
 */
export async function ConceptView({
  id,
  rev,
  libro,
  close,
  brief = false,
}: {
  id: string;
  rev?: string;
  libro?: string;
  /** Where Close goes, when it opens above the list: then it shows its title too. */
  close?: string;
  /** Opened inside a Needs you row: its text, its line, and its links; the decision is the row's. */
  brief?: boolean;
}) {
  const titled = close !== undefined;
  const { data: page, error } = await conceptPage(id, rev);
  const concept = page?.concept ?? null;
  const graph = page?.graph ?? null;
  const history = page?.history ?? null;
  const snapshot = page?.revision?.snapshot ?? null;
  if (error) {
    return (
      <Alert variant="destructive">
        <AlertTriangle />
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }
  if (!concept) return null;

  const outbound = (graph?.edges ?? []).filter((e) => e.src === id).map((e) => e.dst);
  const inbound = (graph?.edges ?? []).filter((e) => e.dst === id).map((e) => e.src);
  const titleOf = (nid: string) => graph?.nodes.find((n) => n.id === nid)?.title || nid;
  const exists = (nid: string) => graph?.nodes.find((n) => n.id === nid)?.exists ?? false;
  const body = (snapshot ? snapshot.body : concept.body) ?? "";
  const proposals = page?.proposals ?? [];
  const back = conceptHref(id);

  const revisions = history?.revisions ?? [];
  const downloads = page?.downloads ?? {};

  const meta = [
    shelfOf(concept.id),
    concept.tags.join(", "),
    writtenBy(concept.authors),
    `Updated ${dateOf(concept.updated_at ?? concept.created_at)}`,
    concept.stale_after &&
      `Review by ${formatDate(concept.stale_after.slice(0, 10))}${concept.stale ? " (passed)" : ""}`,
  ].filter(Boolean);
  const content = (
    <div className="flex flex-col gap-4">
      {libro && (
        <Alert variant="destructive">
          <AlertTriangle />
          <AlertDescription>
            {libro === "date"
              ? "Pick a review date after today."
              : "That decision couldn't be saved. Please try again."}
          </AlertDescription>
        </Alert>
      )}
      {!brief && proposals.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium">Needs you</p>
          <ReviewShelf items={proposals} titles={page?.titles ?? {}} back={back} self={id} />
        </div>
      )}
      {snapshot && (
        <Alert>
          <History />
          <AlertDescription>
            You're reading revision {snapshot.revision}, from {dateOf(snapshot.at)}.{" "}
            <Link href={conceptHref(id)} prefetch={false}>
              Back to the current version
            </Link>
          </AlertDescription>
        </Alert>
      )}
      {body.trim() ? (
        <ConceptBody id={id} body={body} />
      ) : (
        <p className="text-sm text-muted-foreground">This concept is empty.</p>
      )}
      <div className="flex flex-col gap-1 text-sm text-muted-foreground">
        {brief || revisions.length < 2 ? (
          <p>{meta.join(" · ")}</p>
        ) : (
          <HistoryToggle line={meta.join(" · ")} count={revisions.length}>
            <Versions id={id} revisions={revisions} />
          </HistoryToggle>
        )}
        {outbound.length > 0 && (
          <p>
            Links to:{" "}
            <Joined
              items={outbound.map((nid) => ({ id: nid, title: titleOf(nid), ok: exists(nid) }))}
            />
          </p>
        )}
        {inbound.length > 0 && (
          <p>
            Linked from:{" "}
            <Joined items={inbound.map((nid) => ({ id: nid, title: titleOf(nid), ok: true }))} />
          </p>
        )}
      </div>
      {!brief && concept.stored_sources.length > 0 && (
        <ItemGroup>
          {concept.stored_sources.map((s) => (
            <Item key={s.id} variant="outline" size="sm">
              <ItemMedia variant="icon">
                <Paperclip />
              </ItemMedia>
              <ItemContent className="min-w-0">
                <ItemTitle className="max-w-full">
                  <Link href={sourceHref(s.id)} className={`truncate ${link}`} prefetch={false}>
                    {s.title}
                  </Link>
                </ItemTitle>
              </ItemContent>
              {downloads[s.id] && (
                <ItemActions>
                  <ButtonLink href={downloads[s.id] ?? ""} variant="outline" size="sm" download>
                    <Download /> Download
                  </ButtonLink>
                </ItemActions>
              )}
            </Item>
          ))}
        </ItemGroup>
      )}
    </div>
  );

  if (!titled) return content;
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {concept.title || concept.id}{" "}
          {STATUS_LABEL[concept.status] && (
            <Badge variant="outline">{STATUS_LABEL[concept.status]}</Badge>
          )}
        </CardTitle>
        {concept.description && <CardDescription>{concept.description}</CardDescription>}
        <CardAction>
          <ButtonLink href={close} variant="ghost" size="sm" scroll={false} prefetch={false}>
            Close
          </ButtonLink>
        </CardAction>
      </CardHeader>
      <CardContent>{content}</CardContent>
    </Card>
  );
}

type Revision = HistoryOf["revisions"][number];

/** Versions, newest first: one line each, its title the link to read it, then who and when. */
function Versions({ id, revisions }: { id: string; revisions: Revision[] }) {
  return (
    <ul className="flex flex-col gap-2 text-sm">
      {revisions.map((r) => (
        <li key={r.revision} className="flex flex-wrap items-baseline gap-x-2">
          <Link href={`${conceptHref(id)}?rev=${r.revision}`} className={link} prefetch={false}>
            {r.revision}. {CHANGE[r.kind] ?? r.kind}
            {r.cid !== id && ` as ${r.cid}`}
          </Link>
          <span className="text-muted-foreground">
            {byOf(r)}, {dateOf(r.at)}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Who wrote a revision, as About says who wrote the concept: the person, with their agent. */
function byOf(r: { by: string; client?: string; person?: string | null }): string {
  if (r.by === "libro" || r.by === "indexer" || r.by.startsWith("libro-")) return "Libro";
  if (!r.person && !r.client) return r.by === "human" ? "A person, on the dashboard" : "An agent";
  return whoWrote(r.person ?? null, r.client ?? null);
}

const CHANGE: Record<string, string> = {
  create: "Created",
  update: "Edited",
  rename: "Renamed",
  index: "Described by Libro",
};

/** Only a status worth a glance gets a badge: a stable concept needs none. */
const STATUS_LABEL: Record<string, string> = { draft: "Draft", deprecated: "Retired" };

const dateOf = (ms?: number | null) => (ms ? formatDate(ms) : "—");

/**
 * Author entry: the people (by email) and the agents that wrote the
 * concept, said as History says each revision's ("maya@acme.test with
 * Claude Code"). Libro's own work reads as Libro.
 */
function writtenBy(authors: string[] | undefined): string {
  const people: string[] = [];
  const agents: string[] = [];
  for (const a of authors ?? []) {
    if (a.startsWith("human:")) people.push(a.slice("human:".length));
    else if (a.startsWith("process:")) agents.push(a === "process:agent" ? "an agent" : "Libro");
    else if (a !== "agent") agents.push(a);
  }
  const uniq = (xs: string[]) => [...new Set(xs)].join(", ") || null;
  return people.length || agents.length ? whoWrote(uniq(people), uniq(agents)) : "—";
}

/** Concepts named in a line, comma-separated, each opening beside the page. */
function Joined({ items }: { items: { id: string; title: string; ok: boolean }[] }) {
  return items.map((l, i) => (
    <Fragment key={l.id}>
      {i > 0 && ", "}
      {l.ok ? <ConceptLink id={l.id}>{l.title}</ConceptLink> : <span>{l.id} (missing)</span>}
    </Fragment>
  ));
}
