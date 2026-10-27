import { displayable, isUrl, previewKind } from "@librocat/core/sources";
import { AlertTriangle, Download, ExternalLink } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { ButtonLink } from "@/components/button-link";
import { ConceptLink } from "@/components/concept-link";
import { CopyButton } from "@/components/copy-button";
import { CountOnce } from "@/components/counted";
import { DeleteSource } from "@/components/delete-source";
import { DoneToast } from "@/components/done-toast";
import { DownloadParts } from "@/components/download-parts";
import { PageHeader } from "@/components/page-header";
import { RefreshWhile } from "@/components/refresh-while";
import { SourcePreview } from "@/components/source-preview";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Item, ItemActions, ItemContent, ItemDescription } from "@/components/ui/item";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getMe, type IndexCredits, originOf, readSource, sourceHref } from "@/lib/librocat";
import { requireSession } from "@/lib/require-session";
import { formatBytes, formatDate, stillReading } from "@/lib/utils";

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ part?: string; done?: string }>;
};

// The page and its tab title share one counted call per request: cache()
// matches on the id and part, not on the props object each one gets.
const readOnce = cache((id: string, part?: number) => readSource(id, part));

async function sourcePage({ params, searchParams }: Props) {
  const [{ id }, { part }] = await Promise.all([params, searchParams]);
  const n = Number.parseInt(part ?? "1", 10) || 1;
  return readOnce(decodeURIComponent(id), n > 1 ? n : undefined);
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const { data } = await sourcePage(props);
  return { title: `${data?.title || "Source"} | librocat` };
}

const size = formatBytes;

/**
 * Why Libro stopped reading a file (convex/model.ts spendFileCredit): with
 * pay-as-you-go on, only its cap or a missed payment stops it; otherwise the
 * file has reached half of the month's credits.
 */
function waitingWhy(credits: IndexCredits | null | undefined): string {
  if (credits?.pay_as_you_go_paused) {
    return "Pay-as-you-go waits for the last payment to go through (Billing): then Libro reads the rest.";
  }
  if (credits?.pay_as_you_go_capped) {
    return "Pay-as-you-go reached this month's cap: Libro reads the rest next month, or sooner if the cap is raised on Billing.";
  }
  return "Files can use half of this month's credits: Libro reads the rest when credits renew, or sooner with pay-as-you-go.";
}

export default async function SourcePage(props: Props) {
  await requireSession();
  // The library's pay-as-you-go, for why a file waits (read once a request, with the session's).
  const [{ data, error }, { done }, { data: me }] = await Promise.all([
    sourcePage(props),
    props.searchParams,
    getMe(),
  ]);
  if (!data) {
    if (error?.includes("no kept source")) notFound();
    return (
      <Alert variant="destructive">
        <AlertTriangle />
        <AlertDescription>{error ?? "This source could not be read."}</AlertDescription>
      </Alert>
    );
  }
  const src = data;
  const current = src.part;
  const cited = src.cited_concepts ?? [];
  const prompt = derivePrompt(src.title);
  const fileSize = src.file ? size(src.file.bytes) : `${size(src.bytes)} of text`;

  const kind = previewKind(src.kind);
  // A PDF or a picture over one link's 16 MB only downloads, in parts.
  const tooBig = (kind === "pdf" || kind === "image") && Boolean(src.download_parts);
  const page = src.kind === "html" && src.location && isUrl(src.location) ? src.location : null;
  const text = (
    <Card>
      {src.parts > 1 && (
        <CardHeader>
          <CardTitle>{`Part ${current} of ${src.parts}`}</CardTitle>
          <CardAction>
            <div className="flex gap-2">
              {current > 1 && (
                <ButtonLink
                  variant="outline"
                  size="sm"
                  href={sourceHref(src.id, current - 1)}
                  prefetch={false}
                >
                  Previous
                </ButtonLink>
              )}
              {current < src.parts && (
                <ButtonLink
                  variant="outline"
                  size="sm"
                  href={sourceHref(src.id, current + 1)}
                  prefetch={false}
                >
                  Next
                </ButtonLink>
              )}
            </div>
          </CardAction>
        </CardHeader>
      )}
      <CardContent className="flex flex-col gap-4">
        {src.media?.map((m) =>
          m.download_url && displayable(m.mime) ? (
            // A picture by its file link (convex/files.ts), on another origin: shown, never run.
            // biome-ignore lint/performance/noImgElement: a stored file, not a site asset
            <img
              key={m.part}
              src={m.download_url}
              alt={src.title}
              className="max-h-128 rounded-lg border"
            />
          ) : (
            <p key={m.part} className="text-muted-foreground">
              {m.pages ? `Pages ${m.pages[0]} to ${m.pages[1]} of the PDF.` : `A ${m.mime} file.`}
            </p>
          ),
        )}
        {src.text ? (
          <div className="text-sm leading-relaxed whitespace-pre-wrap break-words">{src.text}</div>
        ) : (
          !src.media?.length && (
            <p className="text-muted-foreground">
              {src.status === "processing" ? "Reading it…" : "No text to show."}
            </p>
          )
        )}
      </CardContent>
    </Card>
  );

  // Formatted text is one view: its preview, or its paged text past one part.
  // A file the browser draws (a PDF, a picture, a sheet) also has its text.
  const view: "tabs" | "preview" | "text" = !src.previewable
    ? "text"
    : kind === "pdf" || kind === "image" || kind === "sheet"
      ? "tabs"
      : src.parts > 1
        ? "text"
        : "preview";
  const actions = (
    <>
      {page && (
        <ButtonLink href={page} variant="outline" size="sm" target="_blank" rel="noreferrer">
          <ExternalLink /> Open the page
        </ButtonLink>
      )}
      {src.download_url && (
        <ButtonLink href={src.download_url} variant="outline" size="sm" download>
          <Download /> Download
        </ButtonLink>
      )}
      {src.download_parts && (
        <DownloadParts
          parts={src.download_parts}
          name={src.file?.name ?? src.title}
          mime={src.file?.mime ?? "application/octet-stream"}
        />
      )}
      <DeleteSource id={src.id} />
    </>
  );
  const preview = (
    <Card>
      <CardContent>
        <SourcePreview src={src} />
      </CardContent>
    </Card>
  );

  return (
    <>
      {/* Saved from the Library's Save a link: said once, and counted. */}
      {done === "saved" && <CountOnce event="link_saved" />}
      <DoneToast messages={{ saved: "Link saved. Libro is reading it." }} />
      {/* A file just attached is still being read: the page fills in when it's done. */}
      <RefreshWhile active={stillReading(src)} />
      <PageHeader
        title={src.title}
        description={`${originOf(src)} · ${fileSize} · Added ${dateOf(src.updated_at)}`}
      >
        {actions}
      </PageHeader>
      <div className="flex flex-col gap-6">
        {(src.note || "file_transfer" in src) && (
          <p className="text-sm text-muted-foreground">
            {src.note}
            {"file_transfer" in src && ` ${src.file_transfer}`}
          </p>
        )}
        {/* How far Libro has read a file you added (convex/fileCatalog.ts). */}
        {"libro" in src && src.libro && (
          <p className="text-sm text-muted-foreground">
            {src.libro.done
              ? "Libro read all of it. Concepts it likely changes are in Needs you, under Outdated."
              : src.libro.waiting
                ? `Libro has read ${src.libro.read} of its ${src.libro.total} parts. ${waitingWhy(me?.workspace?.indexCredits)}`
                : `Libro is reading it: ${src.libro.read} of ${src.libro.total} parts so far.`}
          </p>
        )}
        {view === "tabs" ? (
          // After Previous or Next, the part's text is what was asked for.
          <Tabs defaultValue={current > 1 ? "text" : "preview"} className="min-w-0">
            <TabsList>
              <TabsTrigger value="preview">Preview</TabsTrigger>
              <TabsTrigger value="text">Text</TabsTrigger>
            </TabsList>
            <TabsContent value="preview">{preview}</TabsContent>
            <TabsContent value="text">{text}</TabsContent>
          </Tabs>
        ) : (
          <div className="flex min-w-0 flex-col gap-2">
            {tooBig && (
              <p className="text-sm text-muted-foreground">
                Too big to preview here: download its parts.
              </p>
            )}
            {view === "preview" ? preview : text}
          </div>
        )}

        {src.cited_by && (
          <Card>
            <CardHeader>
              <CardTitle>Concepts from this source</CardTitle>
              <CardDescription>
                {cited.length === 0
                  ? "None yet. Ask your agent:"
                  : src.cited_by.length === 1
                    ? "1 concept cites it."
                    : `${src.cited_by.length.toLocaleString("en-US")} concepts cite it.`}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {cited.length === 0 ? (
                <Item variant="outline" size="sm">
                  <ItemContent>
                    <ItemDescription>“{prompt}”</ItemDescription>
                  </ItemContent>
                  <ItemActions>
                    <CopyButton value={prompt} text="Copy prompt" />
                  </ItemActions>
                </Item>
              ) : (
                <ul className="flex flex-col gap-2 text-sm">
                  {cited.map((c) => (
                    <li key={c.id}>
                      <ConceptLink id={c.id}>{c.title}</ConceptLink>
                      {c.description && (
                        <span className="text-muted-foreground"> · {c.description}</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </>
  );
}

/** What to tell an agent to draw concepts from a source. */
const derivePrompt = (title: string) =>
  `Read the source '${title}' in librocat and save what matters as concepts.`;

const dateOf = formatDate;
