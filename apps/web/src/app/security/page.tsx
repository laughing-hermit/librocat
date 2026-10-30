import { SitePage } from "@/components/site-chrome";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { site } from "@/lib/site";

export const metadata = {
  title: "Security | librocat",
  description:
    "How librocat keeps a library safe: OAuth 2.1 sign-in for agents, refused secrets, encryption, the providers involved, and how to report a vulnerability.",
  alternates: { canonical: "/security" },
};

const link = "underline underline-offset-4";

const sections: { title: string; body: React.ReactNode }[] = [
  {
    title: "Installing, and self-hosting",
    body: (
      <>
        librocat ships no installer of its own. An agent adds librocat through its own plugin
        install, or through open-source tools that only write the agent's config and skill folders
        (plugins, for agents with Agent Plugins; add-mcp and skills, for the rest) from the{" "}
        <a href={site.repo} className={link}>
          Apache-2.0 source
        </a>
        . A self-hosted librocat runs the whole service on your own server with Docker, calls only
        the model you choose (TypeSafe's through a provider, an open System One server, or none),
        and reports nothing to us.
      </>
    ),
  },
  {
    title: "Hosted: where your data lives",
    body: "Vercel hosts the site and the MCP endpoint, counts page views and a few actions without cookies (by kind of page, never what a page shows), and routes model requests through its AI Gateway. Convex stores the database and files, on Amazon Web Services, and runs the backend. Resend sends email. Stripe and Link handle payment, and we never see card numbers. Google Workspace hosts the support mailbox. One model reads parts of your library, as the privacy page details: Jev, Libro's small judgment model from TypeSafe AI. It picks a description sentence and tags for a concept your agent left them blank on, reads every file a person adds to describe it and flag the concepts it may change, and judges what the weekly review proposes and the merges your agent drafts. Each request goes only to TypeSafe, with zero data retention: neither Vercel nor TypeSafe trains on it or keeps it after answering, except where the law requires, and librocat stores only Jev's answers. Search matches words in librocat's own database and calls no model. librocat's model generates no text: it picks from what your agent wrote or a file says, and your agent does the writing. librocat refuses to store keys and tokens in the formats it recognizes.",
  },
  {
    title: "In transit and at rest",
    body: (
      <>
        Every request to librocat.com and to the MCP endpoint is HTTPS. Convex states that it
        encrypts customer data at rest with AES-256 and in transit with TLS, runs on AWS, and holds
        a SOC 2 Type II report (
        <a href="https://www.convex.dev/security" className={link}>
          convex.dev/security
        </a>
        ). That report is theirs. librocat holds no certification of its own today.
      </>
    ),
  },
  {
    title: "Access: your sign-in, and the agents you approve",
    body: "Agents connect over OAuth 2.1. An agent's first call opens your browser: you sign in and approve that agent, and it receives a signed access token bound to librocat's MCP endpoint and to your account, valid for one hour and renewed with a refresh token. Every call is checked twice, by the endpoint and by the database, and each call also checks that you still approve that agent: disconnect it on the Connect page and it is cut off on its next call. There is no API key to copy, paste, or leak. The dashboard signs you in with your email and password, once an emailed code has verified your address, and each sign-in session records the IP address and browser it came from.",
  },
  {
    title: "Who can see your data",
    body: `${site.company} is a small studio. Operators have administrative access to production to run the service. We open a library's concepts only to resolve an incident or a support request you made, to act on a report that it breaks the law or our terms, or where the law requires it; never to train models. We do not sell data.`,
  },
  {
    title: "Your exit",
    body: "Export, in Settings, downloads the whole library as an OKF zip that any librocat reads, hosted or self-hosted. Empty this library, in Settings, erases every concept, link, revision, and kept source at once. Delete account erases your account and every library you own. If we close an account, we erase its data within 30 days. Deleted data leaves backups within 30 days.",
  },
  {
    title: "What we do not claim",
    body: (
      <>
        No SOC 2, ISO 27001, or HIPAA for librocat itself today. We will not claim a certification
        we do not hold. Need a security questionnaire answered? Email{" "}
        <a href={`mailto:${site.contact}`} className={link}>
          {site.contact}
        </a>
        .
      </>
    ),
  },
  {
    title: "Report a vulnerability",
    body: (
      <>
        Email{" "}
        <a href={`mailto:${site.contact}?subject=Security`} className={link}>
          {site.contact}
        </a>{" "}
        with "Security" in the subject. We acknowledge within three business days and keep you
        informed until the fix ships. Please give us 90 days before public disclosure. The same
        policy is in{" "}
        <a href={`${site.repo}/blob/main/SECURITY.md`} className={link}>
          SECURITY.md
        </a>
        .
      </>
    ),
  },
];

export default function SecurityPage() {
  return (
    <SitePage
      title="Security"
      lede={`What runs where, who can see what, and how to report a problem. Plain statements. No certification claimed. Last updated ${site.legalUpdated}.`}
    >
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
