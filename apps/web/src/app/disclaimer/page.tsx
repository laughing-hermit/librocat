import { SitePage } from "@/components/site-chrome";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { site } from "@/lib/site";

export const metadata = {
  title: "Disclaimer | librocat",
  description:
    "What librocat is at its core: a library and information science tool that stores, catalogs, and retrieves what you put in it, and makes no decisions.",
  alternates: { canonical: "/disclaimer" },
};

const sections = [
  {
    title: "What librocat is",
    body: `At its core, librocat (a ${site.company} product) is a library and information science tool: it catalogs, indexes, and serves the knowledge you and your agents put into it. It applies classification, controlled vocabulary, and weeding practice to Markdown files. It is infrastructure, not an oracle.`,
  },
  {
    title: "What librocat is not responsible for",
    body: "librocat stores and retrieves what you give it. It does not verify, generate, or endorse the content of your concepts, and it does not make decisions. Your agents and your team do. You are responsible for the accuracy of the knowledge you store, for the actions your agents take with it, and for any decision made on top of it.",
  },
  {
    title: "Libro can be wrong",
    body: "In the hosted library, Libro, the library cat, fills in a description and tags your agent left blank, picking a sentence from the concept and tags from your own vocabulary; reads every file a person adds and flags the concepts it likely changes; and once a week proposes supersessions, retirements, merges, synonyms, and review dates. All of it waits in Needs you. A catalog record is not a judgment: it can be wrong, and Libro can miss a conflict. Nothing in Needs you changes until you or your agent approves it, and every write is a revision, so you can always see and undo what changed.",
  },
  {
    title: "Not professional advice",
    body: "Nothing stored in or retrieved from librocat is legal, medical, financial, or engineering advice. It is what you and your agents put there.",
  },
  {
    title: "No warranty",
    body: 'The service and the open-source software are provided "as is", without warranty of any kind, express or implied, including fitness for a particular purpose. The software, self-hosted or not, is licensed under Apache-2.0, and its license text governs.',
  },
  {
    title: "Limitation of liability",
    body: `To the maximum extent permitted by law, ${site.company} is not liable for indirect, incidental, or consequential damages, or for losses arising from decisions made by you, your team, or your AI agents using knowledge stored in or retrieved from librocat.`,
  },
  {
    title: "Certifications",
    body: "librocat does not currently hold SOC 2 or ISO 27001 certification. If your organization needs formal attestations, contact us before storing regulated data.",
  },
];

export default function DisclaimerPage() {
  return (
    <SitePage
      title="Disclaimer"
      lede={`Plain language, no legalese theater. Last updated ${site.legalUpdated}.`}
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
