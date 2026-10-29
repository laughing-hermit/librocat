import { FileText, RefreshCw, Unlock, Users } from "lucide-react";
import type { Metadata } from "next";
import Image, { type StaticImageData } from "next/image";
import Link from "next/link";
import agentsShot from "@/assets/landing/agents.webp";
import exportShot from "@/assets/landing/export.webp";
import filesShot from "@/assets/landing/files.webp";
import libraryShot from "@/assets/landing/library.webp";
import libroShot from "@/assets/landing/libro.webp";
import { LogoMark } from "@/components/brand";
import { ButtonLink } from "@/components/button-link";
import { CodingTabs } from "@/components/connect-cards";
import { PlanCards } from "@/components/plan-cards";
import { SiteFooter, SiteHeader } from "@/components/site-chrome";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { comingSoon } from "@/lib/coming-soon";
import {
  LIMITS_URL,
  MIN_TEAM_SEATS,
  PLUGINS_COMMAND,
  PRICES,
  riskReversal,
  SELF_HOSTING_URL,
  site,
  taxNote,
  unitsNote,
} from "@/lib/site";
import { cn, link } from "@/lib/utils";

// How it works: a real sequence, so it's numbered.
const STEPS = [
  {
    title: "1. Install it",
    body: "One or two commands in your coding agent. It signs in once, in your browser, and picks its library. No API keys to copy.",
  },
  {
    title: "2. Tell it once",
    body: "Say “remember this”: a decision, a runbook, a document. Your agent files it in your library.",
  },
  {
    title: "3. Every agent knows",
    body: "Ask any agent, tomorrow or next year. It finds the answer, and Libro flags what's out of date.",
  },
];

// What you get, and what makes it safe to try, each beside a picture of it
// (the demo library; scripts/landing-shots.ts takes them again).
const BENEFITS = [
  {
    icon: Users,
    title: "Every agent, every teammate",
    body: "You on Claude Code, a teammate on Cursor, another on Codex or Copilot: one library, and each agent sees what the others saved. Nobody starts from zero.",
    shot: agentsShot,
    alt: "A team's connected agents: Cursor, ChatGPT, Claude Code, and Codex, each teammate's, used today and yesterday.",
  },
  {
    icon: RefreshCw,
    title: "Kept current by Libro",
    body: "Libro, our AI librarian, catalogs what your agents save and reads the files you add, then flags duplicates, stale answers, and what a new file changes. You approve or dismiss.",
    shot: libroShot,
    alt: "A concept Libro flagged: an older runbook this one replaces, with Replace and Dismiss, and the report the concept cites.",
  },
  {
    icon: FileText,
    title: "Your documents, findable",
    body: "Attach PDFs, docs, slides, and pictures. Your agents find them by their words and titles, and cite them.",
    shot: filesShot,
    alt: "A library's files: a Markdown note, a call transcript, a PDF report, and a saved web page.",
  },
  {
    icon: Unlock,
    title: "Yours to keep",
    body: "Plain Markdown you can export or import anytime. Open source, and free to self-host.",
    shot: exportShot,
    alt: "Your data in Settings: export everything as Markdown with your files, or import an export.",
  },
];

// The questions people ask before they try it. Every answer stays in the
// page's HTML (closed, not removed), for search engines and AI assistants.
// `table`: the page shows LIMITS instead of the words (they stay in the
// structured data below).
const FAQ: { q: string; a: string; table?: boolean }[] = [
  {
    q: "What is librocat?",
    a: "librocat is an open-source knowledge base that all your AI agents, and everyone on your team, share. Tell one agent once, and every agent knows it. Libro, an AI librarian, keeps it organized and current. Free to start on librocat Cloud, and free to self-host.",
  },
  {
    q: "Which agents does it work with?",
    a: `Coding and desktop agents, and any agent with Agent Plugins or MCP + Agent Skills (not web chat). Claude Code, Codex, Cursor, and GitHub Copilot each install it with one or two commands, at the top of this page. Every other agent on your computer at once: with Agent Plugins, ${PLUGINS_COMMAND}; without them, MCP + Skills, both on the Connect page. Desktop agents install the same plugin: Claude Desktop and Cowork today, the ChatGPT desktop app through a workspace admin (or its MCP alone without one), and Grok Bot through a Cursor Teams admin. Each agent signs in once in your browser and picks its library; there are no API keys.`,
  },
  {
    q: "How is this different from agent memory or a vector database?",
    a: "An agent's memory belongs to that one agent, and a vector database hands back text that looks similar. librocat is shared by all your agents and your whole team, and it's organized like a library: a catalog of titles, descriptions, and tags, a thesaurus, links, review dates, and a librarian. Search finds the words you asked for, in any of their forms, so you can see why something was found, and whether it's still true.",
  },
  {
    q: "What does Libro do?",
    a: "Libro is librocat's librarian (and a cat). When an agent saves a concept without a description or tags, Libro fills them in. It reads every file you add, end to end, describes it, and flags the concepts it likely changes. Each week it lists duplicates and answers past their review date (on Free, in the weeks your agents write), proposes merges and fixes, and checks the merges your agent drafts. You approve or dismiss in Needs you, and every change is saved as a new version.",
  },
  {
    q: "Is my data private?",
    a: "Yes. We don't sell your data, use it for ads, or train AI models on it. Libro's model, from TypeSafe AI, reads your concepts and the files you add to catalog them, with zero data retention: nothing it reads is kept after it answers. Search uses no model. The privacy page lists exactly what it reads. Export or delete everything anytime, or run librocat on your own server.",
  },
  {
    q: "What can I add to it?",
    a: "Anything your agents write down, plus documents (PDF, Word, spreadsheets, slides, text, and code) and pictures: up to 50 MB a file on Free, 200 MB on paid plans. On a paid plan, save a link: librocat keeps the page, or the file it points to, up to 50 MB (a PDF, an Office file, a picture). Some sites, like LinkedIn, don't let apps read their pages. Agents find all of it by its words, and a picture by its title. For a recording, keep its transcript.",
  },
  {
    q: "What are the limits on each plan?",
    table: true,
    a: "Free: 1,000 concepts, 100 MB of files (10 MB of it text, 50 MB a file), 200 of Libro's credits, 10,000 calls, 1,500 writes, and 1 GB of file transfer a month. Individual: 5,000 concepts, 5 GB of files (250 MB of text, 200 MB a file), 500 credits, then $0.01 each if you turn on pay-as-you-go, up to a monthly cap you set, 30,000 calls, 5,000 writes, and 10 GB of file transfer a month. Team: 15,000 concepts, 25 GB of files (1 GB of text, 200 MB a file), 2,500 credits, then the same, and 30,000 calls and 5,000 writes a month for each person, with 50 GB of file transfer a month, shared by up to 10 libraries you own, on one bill, where each person is an Admin, an Editor, or a Reader (their agents only read). A credit is a concept Libro catalogs, or about three pages of a file you add; files use at most half. Saving links is on paid plans. Self-hosted librocat has no limits.",
  },
  {
    q: "Is it open source? Can I host it myself?",
    a: "Yes, all of it, under Apache-2.0, including the code behind librocat Cloud. Run it with Docker on your own server, free and with no limits, and move a library between the two with Export and Import.",
  },
];

// The limits answer as a table: rows of limits, a column per plan. The same
// numbers as its words above (convex/model.ts and convex/limits.ts).
const LIMITS = {
  plans: ["Free", "Individual", "Team"],
  rows: [
    ["Libraries", "1", "1 per plan", "Up to 10, sharing these"],
    ["Concepts", "1,000", "5,000", "15,000"],
    ["Files (of it, text)", "100 MB (10 MB)", "5 GB (250 MB)", "25 GB (1 GB)"],
    ["Largest file", "50 MB", "200 MB", "200 MB"],
    ["Save a link", "No", "Yes", "Yes"],
    [
      "Libro's credits a month (a concept cataloged, or ~3 pages of a file you add)",
      "200",
      "500, then $0.01 each if you turn it on",
      "2,500, then $0.01 each if you turn it on",
    ],
    ["Calls a month", "10,000", "30,000", "30,000 a person"],
    ["Writes a month", "1,500", "5,000", "5,000 a person"],
    ["File transfer a month", "1 GB", "10 GB", "50 GB"],
  ],
};

export const metadata: Metadata = { alternates: { canonical: "/" } };

// What the page says, for search engines and AI assistants (schema.org, as
// JSON-LD): who makes librocat, what it is and costs, and the questions
// above with their answers. Built from the same constants the page shows.
const ORIGIN = "https://librocat.com";
const structuredData = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": `${ORIGIN}/#organization`,
      name: site.name,
      url: ORIGIN,
      logo: `${ORIGIN}/logo.svg`,
      email: site.contact,
      parentOrganization: { "@type": "Organization", name: site.company },
      sameAs: ["https://github.com/laughing-hermit", site.repo, site.status],
    },
    {
      "@type": "WebSite",
      "@id": `${ORIGIN}/#website`,
      name: site.name,
      url: ORIGIN,
      description: site.tagline,
      publisher: { "@id": `${ORIGIN}/#organization` },
    },
    {
      "@type": "SoftwareApplication",
      name: site.name,
      url: ORIGIN,
      description: site.description,
      applicationCategory: "BusinessApplication",
      operatingSystem: "Any",
      license: "https://www.apache.org/licenses/LICENSE-2.0",
      isAccessibleForFree: true,
      publisher: { "@id": `${ORIGIN}/#organization` },
      offers: [
        { "@type": "Offer", name: "Free", price: "0", priceCurrency: "USD" },
        {
          "@type": "Offer",
          name: "Individual",
          price: String(PRICES.individual.monthly),
          priceCurrency: "USD",
          description: "Per library, per month",
        },
        {
          "@type": "Offer",
          name: "Team",
          price: String(PRICES.team.monthly),
          priceCurrency: "USD",
          description: `Per person, per month, ${MIN_TEAM_SEATS} people or more`,
        },
      ],
    },
    {
      "@type": "FAQPage",
      mainEntity: FAQ.map((f) => ({
        "@type": "Question",
        name: f.q,
        acceptedAnswer: { "@type": "Answer", text: f.a },
      })),
    },
  ],
};

export default function Home() {
  return (
    <>
      <script
        type="application/ld+json"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: JSON-LD from constants, with "<" escaped (Next.js's JSON-LD guide)
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(structuredData).replace(/</g, "\\u003c"),
        }}
      />
      <SiteHeader home />

      <main className="flex-1">
        <section className="mx-auto grid max-w-6xl grid-cols-1 items-center gap-12 px-6 pt-12 pb-16 lg:grid-cols-[1fr_auto] lg:gap-16 lg:pt-24 lg:pb-20">
          <div className="flex flex-col items-center text-center lg:items-start lg:text-left">
            {/* What it is, in big letters; then what it does for you. */}
            <h1 className="max-w-3xl font-serif text-4xl font-semibold tracking-tight text-balance sm:text-6xl xl:text-7xl">
              The open-source knowledge base for AI agents.
            </h1>
            <p className="mt-6 max-w-xl text-lg text-pretty text-muted-foreground sm:text-xl">
              <span className="font-medium text-foreground">
                Tell one agent once. Every agent remembers.
              </span>{" "}
              Stop re-explaining your project every session. Claude Code, Codex, Cursor, and Copilot
              share one library, whichever each teammate uses: you on Claude Code and a teammate on
              Cursor work from the same knowledge. Libro, our AI librarian, keeps it organized and
              current.
            </p>
            {/* The four coding agents, the way in (site.ts codingAgents). */}
            <CodingTabs className="mt-10 w-full max-w-xl" />
            <p className="mt-3 text-sm text-muted-foreground">
              {comingSoon
                ? "librocat Cloud opens soon. Self-hosting works today."
                : "Installs in a minute. No API keys. Free up to 1,000 concepts."}
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-3 lg:justify-start">
              {comingSoon ? (
                <ButtonLink size="xl" href={site.repo}>
                  View on GitHub
                </ButtonLink>
              ) : (
                <ButtonLink size="xl" href="/sign-up">
                  Start free
                </ButtonLink>
              )}
              <ButtonLink size="xl" variant="outline" href={SELF_HOSTING_URL}>
                Self-host
              </ButtonLink>
            </div>
            <p className="mt-6 text-sm text-muted-foreground">
              Another agent?{" "}
              <Link href="/connect" className={`whitespace-nowrap ${link}`}>
                See every way to connect
              </Link>
            </p>
          </div>
          {/* Libro on the book: the one place the whole drawing appears. */}
          <LogoMark
            line
            alt="Libro, the library cat, sitting on a book"
            className="order-first mx-auto size-28 sm:size-36 lg:order-none lg:size-80 xl:size-96"
          />
        </section>

        {/* The product itself: a team's library, on what Libro flagged for it. */}
        <section className="mx-auto max-w-6xl px-6 pb-8">
          <Shot
            src={libraryShot}
            alt="A team's library on Needs you: questions agents asked that have no answer yet, an outdated price and review date, and a duplicate tag, each with what to do."
          />
        </section>

        <section id="how" className="mx-auto max-w-6xl scroll-mt-16 px-6 py-16 sm:py-20">
          <h2 className="text-center font-serif text-4xl font-semibold tracking-tight text-balance">
            Three steps. Under a minute.
          </h2>
          <ol className="mt-12 grid grid-cols-1 gap-10 md:grid-cols-3 md:gap-8">
            {STEPS.map((s) => (
              <li key={s.title} className="border-t pt-6">
                <h3 className="text-lg font-semibold">{s.title}</h3>
                <p className="mt-2 text-muted-foreground">{s.body}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="mx-auto max-w-6xl px-6 py-16 sm:py-20">
          <h2 className="text-center font-serif text-4xl font-semibold tracking-tight text-balance">
            Everything your agents learn, in one library you own.
          </h2>
          {/* A row each, the picture beside its words and wider than them (so
              its text reads): on alternate sides from md up, under them on a
              phone. */}
          <ul className="mt-12 flex flex-col gap-16 md:gap-24">
            {BENEFITS.map((b, i) => (
              <li
                key={b.title}
                className={cn(
                  "grid items-center gap-8 md:gap-12",
                  i % 2 === 1 ? "md:grid-cols-[3fr_2fr]" : "md:grid-cols-[2fr_3fr]",
                )}
              >
                <div className={cn("flex gap-4", i % 2 === 1 && "md:order-last")}>
                  <b.icon className="mt-1 size-5 shrink-0 text-primary" />
                  <div>
                    <h3 className="text-lg font-semibold">{b.title}</h3>
                    <p className="mt-1 text-muted-foreground">{b.body}</p>
                  </div>
                </div>
                <Shot src={b.shot} alt={b.alt} />
              </li>
            ))}
          </ul>
        </section>

        <section id="pricing" className="mx-auto max-w-6xl scroll-mt-16 px-6 py-16 sm:py-20">
          <h2 className="text-center font-serif text-4xl font-semibold tracking-tight text-balance">
            Pricing
          </h2>
          <p className="mt-4 text-center text-lg text-muted-foreground">
            Start free. Pay when you need more room, a second library, or your team.
          </p>
          <div className="mt-10">
            <PlanCards variant="landing" comingSoon={comingSoon} />
          </div>
          <p className="mx-auto mt-8 max-w-2xl text-center text-sm text-muted-foreground">
            {unitsNote}
          </p>
          <p className="mt-4 text-center text-muted-foreground">{riskReversal}</p>
          <p className="mt-2 text-center text-sm text-muted-foreground">
            {taxNote}{" "}
            <a href={LIMITS_URL} className={link}>
              See every limit
            </a>
          </p>
        </section>

        <section id="faq" className="mx-auto max-w-3xl scroll-mt-16 px-6 py-16 sm:py-20">
          <h2 className="text-center font-serif text-4xl font-semibold tracking-tight">
            Questions
          </h2>
          {/* hiddenUntilFound keeps every answer in the page, closed: find in
              page opens it, and crawlers that run no script read it. */}
          <Accordion className="mt-10" hiddenUntilFound>
            {FAQ.map((f) => (
              <AccordionItem key={f.q} value={f.q}>
                <AccordionTrigger className="text-base">{f.q}</AccordionTrigger>
                <AccordionContent className="text-base text-muted-foreground">
                  {f.table ? <LimitsTable /> : f.a}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </section>

        <section className="mx-auto flex max-w-6xl flex-col items-center gap-6 px-6 py-24 text-center">
          <h2 className="font-serif text-4xl font-semibold tracking-tight text-balance">
            Stop repeating yourself.
          </h2>
          <p className="text-lg text-muted-foreground">
            Give every agent the same library. Free to start. No card. Set up in a minute.
          </p>
          {comingSoon ? (
            <ButtonLink size="xl" href={site.repo}>
              View on GitHub
            </ButtonLink>
          ) : (
            <ButtonLink size="xl" href="/sign-up">
              Start free
            </ButtonLink>
          )}
        </section>
      </main>

      <SiteFooter />
    </>
  );
}

/**
 * A picture of the product, on a pale green mat like the app's tinted
 * surfaces. The files are already small WebP (scripts/landing-shots.ts), so
 * they're served as they are, with no image optimization to pay for.
 */
function Shot({ src, alt }: { src: StaticImageData; alt: string }) {
  return (
    <div className="rounded-2xl bg-muted p-2 ring-1 ring-border sm:p-3">
      <Image
        src={src}
        alt={alt}
        unoptimized
        className="h-auto w-full rounded-lg border bg-background"
      />
    </div>
  );
}

/** The limits answer, as a table: easier to compare than a paragraph of numbers. */
function LimitsTable() {
  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead />
            {LIMITS.plans.map((p) => (
              <TableHead key={p}>{p}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {LIMITS.rows.map(([limit, ...values]) => (
            <TableRow key={limit}>
              <TableCell className="whitespace-normal">{limit}</TableCell>
              {values.map((v, i) => (
                <TableCell key={LIMITS.plans[i]} className="whitespace-normal">
                  {v}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <p className="mt-3">Self-hosted librocat has no limits.</p>
    </>
  );
}
