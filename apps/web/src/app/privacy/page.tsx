import { SitePage } from "@/components/site-chrome";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { site } from "@/lib/site";

export const metadata = {
  title: "Privacy | librocat",
  description:
    "What librocat keeps, what it sends to which provider and why, what it counts about use, and how to export or delete everything.",
  alternates: { canonical: "/privacy" },
};

const sections = [
  {
    title: "Who we are",
    body: `${site.company}, a Delaware corporation, operates librocat at librocat.com and is the controller of the personal data described here. For what a team's library holds, its owner decides what goes in, and we process it for them; teams can ask us for a data processing addendum. Contact: ${site.contact}. This page covers librocat at librocat.com. A librocat you self-host sends us nothing.`,
  },
  {
    title: "What we collect",
    body: "Your account: your email address, a password stored only as a hash, and the name you give when you sign up (yours to change in Account). Each sign-in session records the IP address and browser it came from, to keep accounts secure. Your library: the concepts you and your agents write; the sources you keep (files you attach, a JPEG copy of a picture in another format, so agents and browsers can show it, and the text of documents, pages, and transcripts your agents read, so they can quote them later); the search index built from their words and titles; a revision for every write; what Libro puts in Needs you; and the agents you approved, with the library each works in and when each was last used; your teammates in a library see your name, email address, and agents there, and an invite link shows its maker's email address and the library's name to whoever opens it. The ready-reference file: the questions your agents ask the library (search queries), what they found, and which concept answered, so a question asked again gets its answer first and Libro can report what found no answer. A query carrying a key or token librocat recognizes is not kept. Usage: counters (concepts, descriptions and tags filled, calls) to enforce your plan; counts of sign-ups, connected agents, and activity, which we read only in aggregate; how many files librocat refused, by kind (audio, video, or other) and whether they came from the dashboard or an agent, never with the file's name, its library, or who sent it; and page views, a few actions, and how fast pages load, counted as the Cookies section describes. Payment: when you buy a plan, Link and Stripe collect your name, billing address, and payment details; we give Stripe your email address and your pay-as-you-go usage, and receive the plan and its billing status, never card numbers. Support: the emails you send us.",
  },
  {
    title: "How we use it, and why",
    body: "To provide librocat under our agreement with you: to store, index, and serve your library, sign you in, bill your plan, and send the emails the service needs. To keep librocat secure and working, which is our legitimate interest: rate limits, abuse prevention, fixing problems, and aggregate counts of how it is used. To send Libro's report (weekly on paid plans, monthly on Free) unless you turn it off. And where the law requires it. We do not sell your data, share it for advertising, or train models on it.",
  },
  {
    title: "The model that reads it",
    body: "Libro, librocat's librarian, uses one model: Jev, a small judgment model from TypeSafe AI. Jev writes nothing; it picks and judges (yes or no, one of a few choices, a score), and your agent does the writing. What we send Jev: a concept your agent left without a description or tags (its title, type, and body, with your library's tags, their scope notes, and a few titles filed under each), so Jev can pick a sentence and tags from it; the name and whole text of each file a person adds on the dashboard (attached, or a link you save), about 8,000 characters at a time, each part with the titles and descriptions of up to 20 of your concepts, so Jev can describe and tag the file and flag concepts it may change; after Libro's weekly review, the titles, descriptions, and tags of up to 20 pairs of concepts that may say the same thing, the start of up to 20 concepts written or changed since the last review (to suggest review dates), and pairs of tags that may mean one thing, with a few titles under each; a merge your agent drafts, with the two concepts it merges; and, on paid plans, what changed on a kept page a concept cites, with those concepts. A file your agent adds is not sent, and searches go to no model: search matches words, in librocat's own database. Each request goes through Vercel's AI Gateway, only to TypeSafe, with zero data retention: neither Vercel nor TypeSafe trains a model on it or keeps it after answering, except where the law requires. librocat keeps only Jev's answers: the sentence and tags it picked, and what it flagged. On paid plans, librocat fetches a public web page itself only when you or your agent save a link, and about once a week for the kept pages your concepts cite, to see whether they changed.",
  },
  {
    title: "Who processes it",
    body: "Vercel hosts the site and the MCP endpoint, counts page views and a few actions, checks that the sign-up, sign-in, and password-reset forms are used by a person (BotID), and routes model requests through its AI Gateway. Convex stores the database and files, on Amazon Web Services, and runs the backend. Resend sends sign-in codes, Libro's report, and service emails. Stripe and Link handle payment; for purchases, Link is the merchant of record and processes your payment details as a controller, under Stripe's privacy policy. TypeSafe AI runs Jev, Libro's model, with zero data retention. Google hosts our support mailbox in Google Workspace. Anthropic's Claude helps us run librocat and answer support, so it may see account data, service records, and the emails you send us. GitHub hosts the status page and the code's issues, which are public. No one else receives your data, apart from the people and agents you give access to, unless the law requires it, or as part of a sale or merger of the service, which we would tell you about first.",
  },
  {
    title: "Where it is processed",
    body: "librocat is run from the United States, and your data is stored and processed there, wherever you use librocat from.",
  },
  {
    title: "How long we keep it",
    body: "Your account and your libraries: until you delete them, except that 12 months after a paid plan ends, what is still over the Free limits is deleted, after emails to the owner, as the terms describe. Support emails: as long as we need them to help you. Questions in the ready-reference file: 90 days. Sign-in sessions: until they expire or you sign out. Server logs, and the copies of the emails we send: kept by our providers for a short time, at most 30 days, to run and secure the service. Requests to Jev: not kept by Vercel or TypeSafe after Jev answers (zero data retention); the AI Gateway keeps only their metadata (model, usage, cost), not what was sent. Deleting a concept erases it and its revisions; its id and title stay in the library's update log until the library is emptied. Empty this library, in Settings, erases every concept, link, revision, question, and kept source at once. Delete this library, in Settings, removes a library for everyone (its owner and admins can); Leave this library takes it off your list. Delete account, in Account, cancels any subscription and erases your account and every library you own; what you wrote in a library someone else owns stays in it. If we close an account, we erase its data within 30 days. Deleted data leaves our backups within 30 days. Payment records are kept as long as tax law requires.",
  },
  {
    title: "Cookies",
    body: "Essential cookies keep you signed in to the dashboard and secure the sign-in and agent-approval steps. On the sign-up, sign-in, and password-reset forms, Vercel's BotID runs a check in your browser and may set its own security cookies, to tell a person from a bot. There are no analytics or advertising cookies. librocat.com counts page views and a few actions with Vercel Web Analytics, which sets no cookie. A page view records the kind of page, never what it shows: a concept, a kept source, or an invite is recorded as its kind of page, without its name, id, or code, and no address's query (a search, a saved page's title, a token) is recorded. The actions are signing up, approving an agent, creating a library, attaching a file (its type and a size range), saving a link, creating an invite link, copying an install command or a desktop agent's step (which one, and whether on the home page or Connect), starting checkout (the plan and how often it bills), turning pay-as-you-go on or off, setting its cap, and exporting an index; none carries anything your library holds. Vercel Speed Insights, which sets no cookie either, measures how fast each kind of page loads and responds to you, recorded the same way, by kind of page. With each, Vercel records the site you came from, your country, and your device and browser type, and tells visitors apart by a hash of the request that is discarded after 24 hours.",
  },
  {
    title: "Emails",
    body: "We send sign-in and verification codes, notices about your account, your plan, and these policies, and, unless you turn it off, Libro's report. Every report has a link that stops it. Receipts and invoices come from Link. We do not send marketing email without your consent.",
  },
  {
    title: "Your rights",
    body: `You can see, export, and delete your data yourself: Export, in Settings, downloads your whole library as an OKF zip, with your kept sources and attached files beside it (every file at least once in any 30 days), that Import, in another librocat's Settings, copies in, hosted or self-hosted; the delete buttons described above erase it. You can also ask us at ${site.contact} to access, correct, delete, or move your personal data, to restrict or object to how we use it, or to withdraw a consent you gave. We answer within 30 days. Depending on where you live (for example the EU, the UK, or California), the law gives you these rights, and you can also complain to your data protection authority.`,
  },
  {
    title: "Children",
    body: `librocat is not for children. We do not knowingly collect data from anyone under 16. If you believe a child gave us data, write to ${site.contact} and we will delete it.`,
  },
  {
    title: "Security",
    body: "The security page says what runs where, who can see your data, and how to report a problem. If a breach affects your personal data, we tell you without undue delay, as the law requires.",
  },
  {
    title: "Self-hosted librocat",
    body: "librocat you self-host with Docker runs on your own server and sends us nothing. Your knowledge, and the models you choose for it, stay under your control. We never see it.",
  },
  {
    title: "Changes",
    body: "When this policy changes, the date at the top changes too. We email you about material changes at least 30 days before they apply.",
  },
  {
    title: "Contact",
    body: `${site.company}, ${site.contact}.`,
  },
];

export default function PrivacyPage() {
  return (
    <SitePage
      title="Privacy"
      lede={`Plain, because the architecture does most of the privacy work. Last updated ${site.legalUpdated}.`}
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
