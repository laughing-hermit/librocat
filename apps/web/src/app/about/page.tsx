import { SitePage } from "@/components/site-chrome";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { site } from "@/lib/site";
import { link } from "@/lib/utils";

export const metadata = {
  title: "About | librocat",
  description:
    "What librocat is, why a library and not a database, who Libro is, and who makes it: Laughing Hermit, Inc. Open source under Apache-2.0.",
  alternates: { canonical: "/about" },
};

const sections = [
  {
    title: "What librocat is",
    body: "The open-source knowledge base for AI agents, managed by Libro, an AI librarian. Your agents write to it and read from it over MCP; Libro catalogs, cross-references, and checks it, so your agents can keep it current. It is an LLM wiki (the pattern Andrej Karpathy described: a wiki an LLM maintains) stored as Google's Open Knowledge Format (OKF) Markdown, organized with library and information science proven over centuries. Hosted at librocat.com/mcp for every agent and every machine, free to start, or run it on your own.",
  },
  {
    title: "Why a library, not a database",
    body: "A database stores rows. A library catalogs, cross-references, weeds, and hands you the whole picture. librocat applies centuries of library and information science to Markdown your agents can use: cataloging, controlled vocabulary, authority control, weeding.",
  },
  {
    title: "Libro, the library cat",
    body: "The cat in librocat is Libro, the library cat: our librarian, and the reason librocat is a managed knowledge base rather than a folder of notes. Libro catalogs what your agents write: when an agent leaves a concept's description or tags blank, Libro fills them in from what the concept and the library already say. It reads every file you add, end to end, and flags the concepts it likely changes. It puts what's missing, outdated, or duplicated in Needs you, checks the merges your agent drafts against their sources, and reports what the library shows. Everything else, Libro proposes and you decide: your agent works the shelf with you, and every approval is a revision you can undo.",
  },
  {
    title: "Who makes it",
    body: `${site.company}, a small studio. One product, librocat.com, and one promise: your memory stays yours. Export everything, anytime. Delete in one click. Cancel whenever.`,
  },
  {
    title: "Open source, all of it",
    body: "librocat is Apache-2.0 on GitHub, all of it: the MCP server, the skills, the dashboard, the hosted backend, and Libro. The code that runs librocat.com is the code you can read and run yourself. Nothing you store is trapped: the export is plain OKF Markdown, and Import moves it into a self-hosted librocat.",
  },
  {
    title: "Contact",
    body: (
      <>
        <a href={`mailto:${site.contact}`} className={link}>
          {site.contact}
        </a>
        . Bugs and ideas:{" "}
        <a href={site.repo} className={link}>
          {site.repo}
        </a>
        .
      </>
    ),
  },
];

export default function AboutPage() {
  return (
    <SitePage title="About" lede={site.atItsCore}>
      {sections.map((s) => (
        <Card key={s.title}>
          <CardHeader>
            <CardTitle>{s.title}</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">{s.body}</CardContent>
        </Card>
      ))}
    </SitePage>
  );
}
