import { SitePage } from "@/components/site-chrome";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { site } from "@/lib/site";

export const metadata = {
  title: "Terms | librocat",
  description:
    "The terms of service for librocat: the plans, fair use, payment through Stripe's Managed Payments, and your rights to your data.",
  alternates: { canonical: "/terms" },
};

// Plain-language terms for librocat, the hosted service at librocat.com. The code is
// Apache-2.0, and that license governs the code.
const sections = [
  {
    title: "The deal",
    body: `librocat, at librocat.com, is a hosted knowledge base for AI agents, operated by ${site.company}, a Delaware corporation ("we", "us"). It stores your library (the concepts, sources, and files you and your agents add) and serves it to your agents over MCP. These terms are an agreement between you and us. By creating an account or using librocat you accept them. If you use librocat for an organization, you accept them for that organization and confirm that you may.`,
  },
  {
    title: "Your account",
    body: `You need an account to use librocat. You must be at least 16, and old enough to enter a contract where you live. You may not use librocat from a country under US embargo, or if you are on a US sanctions list. Use a real email address, keep your password and sign-in codes secret, and tell us at ${site.contact} if someone else got in. Anything done with your account, or by an agent you approved, is on your account. Disconnect an agent on the Connect page when you no longer trust it.`,
  },
  {
    title: "Plans and limits",
    body: "Every account starts on the Free plan. Each plan's limits (concepts, storage, Libro's credits, people, and the monthly ceilings on calls, writes, and file transfer) are on librocat.com (the pricing and its FAQ), and the product enforces them. We may change the Free plan's limits, with notice by email. When a paid plan ends, Individual or Team, its libraries return to Free, and new concepts and sources wait until a library is back under the Free limits. Free has one library: 30 days after the plan ends, your others pause (no agent reaches them, and you can still open, export, or delete them), and the one with the most concepts stays active. A plan for a paused library, or deleting another, brings it back. If 12 months after the plan ends a library is still paused or over the Free limits, what is over them is deleted: the paused libraries, then, in the one that stays, what changed least recently, until it fits. We email you when the plan ends, and 30 and 7 days before anything is deleted, each time with a link to export. Nothing within the limits is deleted, and choosing a paid plan before then keeps everything. There is no trial of the paid plans.",
  },
  {
    title: "Paying",
    body: "Paid plans are billed monthly or yearly, in US dollars, plus any pay-as-you-go credits you turn on for Libro ($0.01 a credit: a concept cataloged, or about three pages of a file you add, up to the monthly cap you set), billed at the end of each month. Paid plans are sold through Link, Stripe's merchant of record service: Link is the seller on your receipt, charges your payment method, adds sales tax or VAT where it applies, and answers payment questions, and its own terms apply to the payment. Your statement shows LINK.COM* LIBROCAT. A plan renews at the end of each period until you cancel. Adding seats, or moving to Team, charges the prorated difference at once. Cancel anytime in Billing, and the plan runs to the end of the period you paid for.",
  },
  {
    title: "Refunds and price changes",
    body: "Payments cover the period you chose, and we do not refund the unused part of a period, except where the law requires it. Where consumer law gives you a right to cancel and get your money back, such as a cooling-off period, Link applies it, and Link may also refund a payment within 60 days of purchase under its own rules. If we raise a price, the new price applies from your next renewal, and we tell you by email at least 30 days before.",
  },
  {
    title: "Team plans",
    body: "A Team plan covers up to 10 libraries its buyer owns, on one bill, for the people it has seats for (three or more, priced per person, each person counted once), each signed in with their own account. The libraries share the plan's limits. Whoever buys it is responsible for who joins through its invite links, and for removing people who leave. Members of a library see each other's email addresses and everything in that library. When the plan ends, its libraries go back to Free, as Plans and limits describes, and only their owner can use them: the other members are paused until the libraries are on Team again.",
  },
  {
    title: "Your content",
    body: "What you store stays yours. You give us only the rights needed to host, copy, convert, index, catalog, and serve it to you, your team, and the agents you approve, to back it up, and to have the providers the privacy page names process it for that. You are responsible for your content, and you must have the right to store it. We open it only as the privacy and security pages describe. We can remove content that breaks the law or these terms, and we tell you when we do, unless the law forbids it. If something in librocat infringes your copyright, send the details the law asks for (17 U.S.C. § 512(c)(3)) to our designated agent: Copyright Agent, Laughing Hermit, Inc., 1111B S Governors Ave # 46301, Dover, DE 19904, USA; +1 787-325-8664; support@librocat.com. We remove it, and we close the accounts of repeat infringers.",
  },
  {
    title: "Acceptable use",
    body: "Do not use librocat to break the law or infringe anyone's rights; to store malware, or other people's personal data without a lawful basis; to store secrets such as passwords and private keys (librocat refuses keys and tokens in the formats it recognizes); to store payment card numbers, health information covered by HIPAA, or other specially regulated data; to attack, probe, or overload the service or its users; to work around its quotas, for example with many Free accounts; or to resell access to it as your own service. The software is open source: the Apache-2.0 license governs the code, and these terms govern the hosted service.",
  },
  {
    title: "Models and agents",
    body: "librocat uses Jev, a small judgment model from TypeSafe AI, to catalog concepts and the files you add and to flag what may be duplicated or out of date, as the privacy page describes. Its picks, what it flags or misses, and search results can be wrong. Nothing in Needs you changes until you or your agent approves it, and every write is a revision you can see and undo, within the history your plan keeps. Your agents write and act for you, and you are responsible for what they do with what they read. Nothing in librocat is legal, medical, financial, or engineering advice.",
  },
  {
    title: "Availability and changes",
    body: `We work to keep librocat available, but we do not promise uptime (${site.status.replace("https://", "")} shows how it runs), and we may change or retire features. We email you about material changes to prices or these terms at least 30 days before they take effect; other changes apply when we post them here, with a new date at the top. If you disagree with a change, cancel and export your library before it takes effect. If we shut librocat down, we email you at least 30 days before, so you can export.`,
  },
  {
    title: "Ending",
    body: "You can delete a library, or your whole account, from the dashboard at any time, and cancel your subscription in Billing. Deleting a library, or the account, ends its plan at once and bills any pay-as-you-go credits used that period. We can suspend or close an account that breaks these terms or does not pay, with notice first unless the breach is serious or the law requires otherwise. Before you delete anything, Export (in Settings) downloads your whole library, every file at least once in any 30 days. After an account closes, we erase its data as the privacy page describes.",
  },
  {
    title: "Warranty",
    body: 'librocat is provided "as is" and "as available". To the extent the law allows, we disclaim all warranties, express or implied, including merchantability, fitness for a particular purpose, and non-infringement.',
  },
  {
    title: "Liability",
    body: "To the extent the law allows, we are not liable for indirect, incidental, special, or consequential losses, or for lost profits, revenue, data, or goodwill, including losses from decisions made by you, your team, or your agents. Our total liability for all claims about librocat is limited to what you paid for librocat in the twelve months before the claim arose, or US$100, whichever is more.",
  },
  {
    title: "Indemnity",
    body: "If you use librocat for a business, you will defend us against, and cover our losses from, claims by others that arise from your content, from what your agents do, or from your breaking these terms.",
  },
  {
    title: "Law and disputes",
    body: `If you have a dispute with us, write to us first and give us 30 days to resolve it. These terms are governed by the laws of ${site.jurisdiction}, without regard to its conflict-of-law rules. Disputes go to the state or federal courts located in Delaware, and both of us accept their jurisdiction. If you are a consumer, nothing in these terms takes away rights that the law where you live gives you and does not let a contract remove, including the right to go to your local courts.`,
  },
  {
    title: "General",
    body: "These terms, with the pricing at librocat.com/#pricing and the privacy page, are the whole agreement about librocat. If a part cannot be enforced, the rest still applies. Not enforcing a part is not a waiver of it. We are not responsible for failures caused by events beyond our reasonable control, including outages of the providers we rely on. You may not transfer your account without our consent. We may transfer these terms to whoever takes over the service, and we will tell you if we do.",
  },
  {
    title: "Contact",
    body: `${site.company}, ${site.contact}.`,
  },
];

export default function TermsPage() {
  return (
    <SitePage
      title="Terms of service"
      lede={`Plain language, for librocat. Last updated ${site.legalUpdated}.`}
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
