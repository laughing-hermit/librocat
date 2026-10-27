import { conceptLink } from "@librocat/core/format";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { ConceptLink } from "@/components/concept-link";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { link } from "@/lib/utils";

/**
 * A concept's Markdown, in shadcn's typography recipes. A link to another
 * concept (a `.md` target, the rule the graph follows) opens its page here, a
 * web link opens in a new tab, and anything else stays text. Raw HTML shows
 * as text, and a picture shows as a link, so reading a concept loads nothing
 * from elsewhere.
 */
export function ConceptBody({ id, body }: { id: string; body: string }) {
  return (
    <div className="flex flex-col gap-4 text-sm leading-relaxed break-words">
      <Markdown remarkPlugins={[remarkGfm]} components={components(id)}>
        {body}
      </Markdown>
    </div>
  );
}

function components(id: string): Components {
  return {
    // The page title is the h1, so the body's headings start one level down.
    h1: ({ children }) => <h2 className="text-lg font-semibold tracking-tight">{children}</h2>,
    h2: ({ children }) => <h3 className="text-base font-semibold tracking-tight">{children}</h3>,
    h3: ({ children }) => <h4 className="font-semibold">{children}</h4>,
    h4: ({ children }) => <h5 className="font-semibold">{children}</h5>,
    h5: ({ children }) => <h6 className="font-semibold">{children}</h6>,
    h6: ({ children }) => <h6 className="font-semibold">{children}</h6>,
    ul: ({ children }) => <ul className="ml-6 list-disc space-y-2">{children}</ul>,
    ol: ({ children }) => <ol className="ml-6 list-decimal space-y-2">{children}</ol>,
    blockquote: ({ children }) => (
      <blockquote className="border-l-2 pl-6 italic">{children}</blockquote>
    ),
    hr: () => <Separator />,
    a: ({ href = "", children }) => {
      const target = conceptLink(href, id);
      if (target) {
        return <ConceptLink id={target}>{children}</ConceptLink>;
      }
      if (/^(https?:|mailto:)/i.test(href)) {
        return (
          <a href={href} target="_blank" rel="noreferrer" className={link}>
            {children}
          </a>
        );
      }
      return <>{children}</>;
    },
    img: ({ src, alt }) =>
      typeof src === "string" && /^https?:/i.test(src) ? (
        <a href={src} target="_blank" rel="noreferrer" className={link}>
          {alt || src}
        </a>
      ) : (
        (alt ?? null)
      ),
    pre: ({ children }) => (
      <pre className="overflow-x-auto rounded-md bg-muted p-4 font-mono text-xs">{children}</pre>
    ),
    // A fenced block's text ends in a newline; an inline code span's never does.
    code: ({ children }) =>
      String(children).endsWith("\n") ? (
        <code>{children}</code>
      ) : (
        <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs font-semibold">
          {children}
        </code>
      ),
    table: ({ children }) => <Table>{children}</Table>,
    thead: ({ children }) => <TableHeader>{children}</TableHeader>,
    tbody: ({ children }) => <TableBody>{children}</TableBody>,
    tr: ({ children }) => <TableRow>{children}</TableRow>,
    th: ({ children }) => <TableHead>{children}</TableHead>,
    td: ({ children }) => <TableCell className="whitespace-normal">{children}</TableCell>,
  };
}
