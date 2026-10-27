import { AlertTriangle, FileText, Info, SearchX } from "lucide-react";
import { AttachProvider, DropZone } from "@/components/attach-files";
import { ButtonLink } from "@/components/button-link";
import { ConceptList } from "@/components/concept-list";
import { ConceptView } from "@/components/concept-view";
import { DoneToast } from "@/components/done-toast";
import { FileList } from "@/components/file-list";
import { LibraryAdd } from "@/components/library-add";
import {
  ConceptsNear,
  FirstRun,
  Models,
  NeedsYou,
  needsCount,
  StorageNear,
} from "@/components/library-status";
import { LibraryTabs } from "@/components/library-tabs";
import { LibraryToolbar } from "@/components/library-toolbar";
import { PageHeader } from "@/components/page-header";
import { RefreshOnReturn } from "@/components/refresh-on-return";
import { RefreshWhile } from "@/components/refresh-while";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  conceptHref,
  getAgents,
  getLibrary,
  getMe,
  type Library,
  type LibraryFilters,
  originOf,
  sourceHref,
} from "@/lib/librocat";
import { formatBytes, formatDate, stillReading } from "@/lib/utils";

type Source = Library["sources"][number];

/** One plain word or two for where a file stands. */
export function statusOf(s: { status?: string; unread?: boolean }): string {
  if (s.status === "processing") return "Reading…";
  if (s.status === "failed") return "Couldn't read it";
  if (s.unread) return "Not cited yet";
  return "Ready";
}

/** What a Settings action did, from `?done=` (they land here), and a file's deletion. */
const DONE: Record<string, string> = {
  deleted: "File deleted",
  emptied: "The library is empty",
  removed: "The library is deleted",
  left: "You left the library",
};

/** What failed, from `?libro=` (dashboard/libro/actions.ts). */
const LIBRO_ERRORS: Record<string, string> = {
  decision: "That decision couldn't be saved. Please try again.",
  date: "Pick a review date after today.",
};

/**
 * The Library, the dashboard's one page, in three tabs. Concepts: every
 * concept your agents wrote, with search and filters, a row opening in
 * place; `open` is the concept the address names, already open. Until the
 * first concept, the list is the two steps to get there. Needs you: what
 * waits for a decision. Files: each opens its own page, with the concepts
 * that came from it. Files come in by Attach files, Save a link, or a drop.
 */
export async function ConceptLibrary({
  filters,
  open,
  rev,
  libro,
  error: saveError,
  page,
  tab,
}: {
  filters: LibraryFilters;
  /** The page of rows to show first (`?page=`). */
  page?: string;
  /**
   * `review`, `concepts` or `files`: the view picked. With none, a plain
   * visit opens on Needs you, the first tab ("All clear" when nothing waits);
   * a concept's address, a search or a filter, or a library with no
   * concepts yet (its Get started) opens on Concepts.
   */
  tab?: string;
  open?: string;
  rev?: string;
  libro?: string;
  /** What went wrong saving a link or deleting a file. */
  error?: string;
}) {
  const { after: page1, sort, ...picked } = filters;
  const oldest = sort === "oldest";
  // A plain visit (no filter, search, or page) opens on Needs you, the first tab.
  const plain = !page1 && !Object.values(picked).some(Boolean);
  const [{ data, error }, { data: me }] = await Promise.all([getLibrary(filters, true), getMe()]);
  const admin = me?.workspace?.admin ?? false;
  // A Reader (and their agents) only read: no adding, no deciding.
  const reader = me?.workspace?.role === "reader";
  const items = data?.concepts ?? [];
  const next = data?.cursor ?? null;
  const { after, ...rest } = filters;
  const keep = new URLSearchParams(
    Object.entries({ ...rest, ...(after ? { after } : {}) }).filter((e): e is [string, string] =>
      Boolean(e[1]),
    ),
  );
  const kept = keep.size > 0 ? `?${keep}` : "";
  const listHref = `/dashboard/concepts${kept}`;
  const openAt = open === undefined ? -1 : items.findIndex((c) => c.id === open);
  const listed = openAt >= 0;
  const filtering = Object.values(rest).some(Boolean);
  const review = data?.review ?? null;
  const status = data?.status ?? null;
  // The concepts a decision is about: their rows say so.
  const waiting = new Set(
    (review?.shelf ?? []).flatMap((p) => [p.subject, ...(p.target ? [p.target] : [])]),
  );
  // The concepts the list shows: not the thesaurus, librocat's own (Libro
  // keeps it), which the list and the type filters leave out too.
  const conceptTotal = status ? status.concepts - (status.by_type.Thesaurus ?? 0) : 0;
  // A new library: its list is the two steps to a first concept.
  const firstRun = Boolean(status && conceptTotal === 0 && !filtering);
  // The agents only matter to a new library's Get started (one ticks when
  // one is connected), so they're asked for only then.
  const { data: agents } = firstRun ? await getAgents() : { data: null };

  const conceptsList = (
    <div className="flex flex-col gap-4 pt-2">
      {data && !firstRun && <LibraryToolbar types={data.types} />}
      {data?.capped && (
        <p className="text-sm text-muted-foreground">
          The {data.concepts.length} best matches. Add a word or a filter to narrow it.
        </p>
      )}
      {open !== undefined && !listed && (
        <ConceptView id={open} rev={rev} libro={libro} close={listHref} />
      )}
      <DropZone disabled={reader}>
        {firstRun ? (
          <>
            <FirstRun agents={agents?.length ?? 0} reader={reader} />
            <RefreshOnReturn />
          </>
        ) : items.length === 0 ? (
          <Card>
            <CardContent>
              <Empty>
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <SearchX />
                  </EmptyMedia>
                  {/* A batch read by date can hold none of a type's: more are past it. */}
                  <EmptyTitle>{next ? "None here yet" : "Nothing matches"}</EmptyTitle>
                  <EmptyDescription>
                    {next
                      ? "More concepts are past these. Look further, or try another word or filter."
                      : "Try another word or filter."}
                  </EmptyDescription>
                </EmptyHeader>
                <EmptyContent>
                  {next && (
                    <ButtonLink href={pageHref({ ...rest, after: next })} prefetch={false}>
                      Look further
                    </ButtonLink>
                  )}
                  <ButtonLink
                    href="/dashboard/concepts?tab=concepts"
                    variant="outline"
                    prefetch={false}
                  >
                    Clear filters
                  </ButtonLink>
                </EmptyContent>
              </Empty>
            </CardContent>
          </Card>
        ) : (
          <ConceptList
            items={items.map((c) => ({
              row: {
                id: c.id,
                title: c.title || c.id,
                description: ("snippet" in c && c.snippet) || c.description || "",
                snippet: "snippet" in c && Boolean(c.snippet),
                type: c.type,
                status: c.status,
                cites: c.cites,
                review: waiting.has(c.id),
                updatedAt: "updated_at" in c ? c.updated_at : undefined,
              },
              href: `${conceptHref(c.id)}${kept}`,
              view: c.id === open ? <ConceptView id={c.id} rev={rev} libro={libro} /> : undefined,
            }))}
            listHref={listHref}
            openAt={openAt}
            page={Number(page) || 1}
            more={next ? pageHref({ ...rest, after: next }) : null}
          />
        )}
      </DropZone>
    </div>
  );

  return (
    <AttachProvider>
      <PageHeader title="Library">
        {data && !reader && <LibraryAdd canSaveLinks={data.canSaveLinks} />}
      </PageHeader>
      <DoneToast messages={DONE} />
      <RefreshWhile active={(data?.sources ?? []).some(stillReading)} />
      <div className="flex flex-col gap-4">
        {reader && (
          <Alert>
            <Info />
            <AlertDescription>
              You can read this library. Its admins can make you an Editor, so your agents can add
              to it.
            </AlertDescription>
          </Alert>
        )}
        {libro && !open && (
          <Alert variant="destructive">
            <AlertTriangle />
            <AlertDescription>
              {LIBRO_ERRORS[libro] ?? "Something went wrong. Please try again."}
            </AlertDescription>
          </Alert>
        )}
        {(saveError || error) && (
          <Alert variant="destructive">
            <AlertTriangle />
            <AlertDescription>{saveError ?? error}</AlertDescription>
          </Alert>
        )}
        {status && (
          <>
            <ConceptsNear status={status} admin={admin} />
            <StorageNear status={status} admin={admin} />
          </>
        )}
        {data && (
          <LibraryTabs
            initial={
              tab === "review" || tab === "concepts" || tab === "files"
                ? tab
                : plain && open === undefined && !firstRun
                  ? "review"
                  : "concepts"
            }
            counts={{
              concepts: conceptTotal,
              review: review ? needsCount(review) : null,
              files: data.sources.length,
            }}
            concepts={conceptsList}
            files={
              <div className="pt-2">
                <Files sources={data.sources} reader={reader} />
              </div>
            }
            needs={
              review && (
                <div className="pt-2">
                  <NeedsYou
                    review={review}
                    back="/dashboard/concepts?tab=review"
                    readOnly={reader}
                    oldest={oldest}
                  />
                </div>
              )
            }
          />
        )}
        {status?.models && <Models models={status.models} />}
      </div>
    </AttachProvider>
  );
}

const pageHref = (filters: LibraryFilters) => {
  const q = new URLSearchParams(
    Object.entries(filters).filter((e): e is [string, string] => Boolean(e[1])),
  );
  return `/dashboard/concepts${q.size ? `?${q}` : ""}`;
};

/**
 * The library's files, newest first, for the Files tab: each its kind and
 * one line, opening its own page. No files yet: where to add them.
 */
function Files({ sources, reader }: { sources: Source[]; reader: boolean }) {
  if (sources.length === 0) {
    return (
      <DropZone disabled={reader}>
        <Card>
          <CardContent>
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <FileText />
                </EmptyMedia>
                <EmptyTitle>No files yet</EmptyTitle>
                <EmptyDescription>
                  Attach documents and pictures, or drop them here: PDFs, Word, spreadsheets,
                  slides, text, and images. On paid plans, Save a link keeps a web page. Libro reads
                  each one you add. For a recording, keep its transcript.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          </CardContent>
        </Card>
      </DropZone>
    );
  }
  return (
    <DropZone disabled={reader}>
      <FileList
        files={sources.map((s) => {
          const [kind = "File", ...rest] = originOf(s).split(" · ");
          return {
            id: s.id,
            title: s.title,
            kind,
            ...(s.description ? { description: s.description } : {}),
            line: [
              kind,
              ...rest,
              formatBytes(s.file ? s.file.bytes : s.bytes),
              `Added ${formatDate(s.updated_at)}`,
            ].join(" · "),
            ...(s.status === "processing" || s.status === "failed"
              ? { status: { label: statusOf(s), failed: s.status === "failed" } }
              : {}),
            href: sourceHref(s.id),
          };
        })}
      />
    </DropZone>
  );
}
