/**
 * The demo library `dev:seedDemo` builds: one believable team's knowledge,
 * so the dashboard reads like a real one. Acme's engineering team, three
 * people, their agents, five shelves, four sources (one no concept cites),
 * one review-shelf proposal of each kind, and a week of their agents'
 * searches. Data only; dev.ts writes it.
 */

export const DEMO_LIBRARY = "Acme engineering";

export const DEMO_PEOPLE = [
  { email: "maya@acme.test", name: "Maya", role: "admin" },
  { email: "dev@acme.test", name: "Gabriella", role: "member" },
  { email: "ops@acme.test", name: "Omar", role: "reader" },
] as const;

export type DemoPerson = (typeof DEMO_PEOPLE)[number]["email"];
export const DEMO_AGENTS = ["Claude Code", "Codex", "Cursor"] as const;
export type DemoAgent = (typeof DEMO_AGENTS)[number];

export type DemoConcept = {
  id: string;
  type: "Decision" | "Note";
  title: string;
  description: string;
  tags: string[];
  body: string;
  by: DemoPerson;
  agent: DemoAgent;
  /** Days since it was last written: 0 to 6 shows on Home as this week's. */
  age: number;
  sources?: string[];
};

export type DemoSource = {
  id: string;
  title: string;
  location: string;
  kind: string;
  text: string;
  by: DemoPerson;
  agent: DemoAgent;
  /** The file it keeps, as an upload would: it downloads from its page. */
  file?: { name: string; mime: string };
};

export const DEMO_SOURCES: DemoSource[] = [
  {
    id: "incident-handbook",
    title: "Incident response handbook",
    location: "https://handbook.acme.test/incident-response",
    kind: "html",
    by: "ops@acme.test",
    agent: "Claude Code",
    text: [
      "# Incident response",
      "An incident is anything that hurts customers: errors, slowness, or data that looks wrong.",
      "Declare it in #incidents with /incident. The first responder is the lead until they hand off.",
      "The lead opens the status page within 15 minutes and updates it every 30 minutes.",
      "Keep a timeline in the incident channel as you go: what you saw, what you tried, and when.",
      "Within five business days, write a blameless postmortem with follow-ups and owners.",
    ].join("\n\n"),
  },
  {
    id: "soc2-report-2026",
    title: "SOC 2 Type II report, 2026",
    location: "Acme-SOC2-Type-II-2026.pdf",
    kind: "pdf",
    file: { name: "Acme-SOC2-Type-II-2026.pdf", mime: "application/pdf" },
    by: "maya@acme.test",
    agent: "Cursor",
    text: [
      "SOC 2 Type II report for Acme, Inc. Period: January 1 to June 30, 2026.",
      "CC6.1 Access to production is reviewed every quarter by the engineering manager.",
      "CC6.2 Departing employees lose access within one business day.",
      "CC7.2 Backups are encrypted at rest and restored in a test once a quarter.",
      "CC8.1 Every change to production goes through a reviewed pull request.",
      "No exceptions were noted in the period.",
    ].join("\n\n"),
  },
  {
    id: "support-call-2026-09-12",
    title: "Support planning call, Sep 12, 2026",
    location: "support-planning-2026-09-12.vtt",
    kind: "transcript",
    file: { name: "support-planning-2026-09-12.vtt", mime: "text/vtt" },
    by: "dev@acme.test",
    agent: "Codex",
    text: [
      "Maya: Customers keep asking when we answer. Let's write it down.",
      "Dev: We answer within one business day now, nine to five Eastern.",
      "Ops: Weekends are pager only, and only for outages.",
      "Maya: Agreed. One business day, nine to five Eastern, and the pager for outages.",
    ].join("\n"),
  },
  // No concept cites it yet: Home lists it as a file waiting for an agent.
  {
    id: "new-hire-notes",
    title: "New hire notes",
    location: "new-hire-notes.md",
    kind: "md",
    by: "maya@acme.test",
    agent: "Claude Code",
    text: [
      "# New hire notes",
      "Day one: IT ships the laptop. Sign in with your Acme Google account, then install the VPN client from the self-service portal.",
      "Week one: shadow the on-call engineer for a day, and ship one small change to production.",
      "Ask in #eng-help when stuck. Nobody minds.",
    ].join("\n\n"),
  },
];

/**
 * What the team's agents searched the library for this week (convex/reference.ts):
 * `found` is the concepts each search found (none: Home's "Your agents
 * couldn't find"), `opened` the one the agent read next.
 */
export const DEMO_QUESTIONS: { text: string; found: string[]; opened?: string }[] = [
  {
    text: "How do we deploy to production?",
    found: ["deploys/release-process"],
    opened: "deploys/release-process",
  },
  { text: "roll back a bad deploy", found: ["deploys/rollback"], opened: "deploys/rollback" },
  { text: "rollback deploy", found: ["deploys/rollback"], opened: "deploys/rollback" },
  {
    text: "Stripe webhook failed, how to replay",
    found: ["billing/stripe-webhooks"],
    opened: "billing/stripe-webhooks",
  },
  { text: "refund policy", found: ["billing/refund-policy"], opened: "billing/refund-policy" },
  { text: "Team plan price per seat", found: ["billing/team-pricing"] },
  { text: "who is on call this week", found: ["oncall/rotation"], opened: "oncall/rotation" },
  {
    text: "incident checklist",
    found: ["oncall/incident-checklist", "oncall/postmortem-template"],
    opened: "oncall/incident-checklist",
  },
  {
    text: "API rate limit",
    found: ["api/rate-limits", "api/rate-limiting"],
    opened: "api/rate-limiting",
  },
  { text: "why did we pick Postgres", found: ["decisions/postgres"], opened: "decisions/postgres" },
  { text: "support hours", found: ["decisions/support-hours"] },
  { text: "VPN setup", found: [] },
  { text: "SSO for staging", found: [] },
  { text: "on-call pay", found: [] },
  { text: "laptop setup", found: [] },
  { text: "VPN setup", found: [] },
];

const cite = (id: string) => `source:${id}`;

export const DEMO_CONCEPTS: DemoConcept[] = [
  // billing/
  {
    id: "billing/team-pricing",
    type: "Note",
    title: "Team plan pricing",
    description: "What a Team seat costs, monthly and yearly, and how seat changes are billed.",
    tags: ["billing", "pricing"],
    body: "Team is $15 a person a month, or $12.50 a month billed yearly.\n\nAdding or removing a seat is prorated and billed at once. Failed payments are retried by Stripe: see [Replaying a failed Stripe webhook](/billing/stripe-webhooks.md).",
    by: "maya@acme.test",
    agent: "Claude Code",
    age: 1,
  },
  {
    id: "billing/stripe-webhooks",
    type: "Note",
    title: "Replaying a failed Stripe webhook",
    description:
      "Find the failed event in Stripe, replay it, and check the customer's plan changed.",
    tags: ["billing", "stripe"],
    body: "1. In Stripe, open Developers › Events and filter by failed deliveries.\n2. Open the event and click Resend.\n3. Check the customer's plan in the admin panel.\n\nIf it fails again, page the on-call engineer: [Incident checklist](/oncall/incident-checklist.md).",
    by: "dev@acme.test",
    agent: "Codex",
    age: 21,
  },
  {
    id: "billing/refund-policy",
    type: "Decision",
    title: "Refunds within 14 days",
    description: "A new subscription is refunded in full within 14 days, no questions asked.",
    tags: ["billing", "support"],
    body: "We refund a new subscription in full when asked within 14 days of the first charge. After that, we refund the unused part of a yearly plan only when we caused the problem.",
    by: "maya@acme.test",
    agent: "Cursor",
    age: 40,
  },
  {
    id: "billing/coupon-codes-2025",
    type: "Note",
    title: "Black Friday 2025 coupon codes",
    description: "The three codes sales used in the 2025 campaign, all expired on Dec 1, 2025.",
    tags: ["billing", "marketing"],
    body: "BF25-TEAM (30% off Team, first year), BF25-IND (20% off Individual), BF25-EDU (50% off for schools). All three expired on Dec 1, 2025.",
    by: "maya@acme.test",
    agent: "Claude Code",
    age: 320,
  },
  {
    id: "billing/invoice-emails",
    type: "Note",
    title: "Who gets invoice emails",
    description: "Stripe sends invoices to the billing contact on the account, not to every admin.",
    tags: ["billing", "stripe"],
    body: "Invoices go to the billing contact set in Stripe. A customer who wants them elsewhere changes the contact in the billing portal; we don't forward invoices by hand.",
    by: "dev@acme.test",
    agent: "Cursor",
    age: 55,
  },
  // deploys/
  {
    id: "deploys/release-process",
    type: "Note",
    title: "Release process",
    description: "Merge to main; GitHub Actions builds, deploys, and runs the smoke tests.",
    tags: ["deploys", "ci", "kubernetes"],
    body: "1. Merge the pull request to main.\n2. GitHub Actions builds the image and deploys it to the cluster.\n3. Watch the smoke tests in the Actions run, then check /health.\n\nIf it goes wrong: [Rolling back a bad release](/deploys/rollback.md).",
    by: "dev@acme.test",
    agent: "Claude Code",
    age: 2,
    // SOC 2's CC8.1: every change to production goes through a reviewed pull request.
    sources: [cite("soc2-report-2026")],
  },
  {
    id: "deploys/manual-deploy",
    type: "Note",
    title: "Deploying by hand over SSH",
    description: "The old way: SSH to the app server, pull, and restart the service.",
    tags: ["deploys", "k8s"],
    body: "ssh deploy@app1.acme.test, then git pull and sudo systemctl restart acme. Written before we moved to Kubernetes.",
    by: "ops@acme.test",
    agent: "Codex",
    age: 400,
  },
  {
    id: "deploys/rollback",
    type: "Note",
    title: "Rolling back a bad release",
    description: "Redeploy the previous image from GitHub Actions; it takes under five minutes.",
    tags: ["deploys", "kubernetes", "incident"],
    body: "In GitHub Actions, open the last good run of Deploy and click Re-run all jobs. The cluster rolls back to that image. Then tell #incidents what happened.",
    by: "ops@acme.test",
    agent: "Codex",
    age: 12,
  },
  {
    id: "deploys/feature-flags",
    type: "Note",
    title: "Feature flags",
    description: "New features ship dark behind a flag, then turn on for one customer at a time.",
    tags: ["deploys", "flags"],
    body: "Every feature that changes what customers see ships behind a flag, off. We turn it on for our own workspace first, then for customers who asked, then for everyone. A flag older than 90 days gets removed.",
    by: "dev@acme.test",
    agent: "Cursor",
    age: 30,
  },
  {
    id: "deploys/staging",
    type: "Note",
    title: "Staging environment",
    description: "staging.acme.test mirrors production, with a nightly copy of anonymized data.",
    tags: ["deploys", "k8s"],
    body: "Staging runs the same images as production on a smaller cluster. Its database is restored every night from an anonymized copy of production.",
    by: "ops@acme.test",
    agent: "Claude Code",
    age: 65,
  },
  // oncall/
  {
    id: "oncall/escalation-contacts",
    type: "Note",
    title: "Escalation contacts",
    description: "Who to page after the on-call engineer, in order, with their hours.",
    tags: ["oncall", "incident"],
    body: "1. The on-call engineer (PagerDuty).\n2. Ops lead: ops@acme.test, 8 to 6 Eastern.\n3. Engineering manager: maya@acme.test, any time for an outage.",
    by: "ops@acme.test",
    agent: "Claude Code",
    age: 120,
  },
  {
    id: "oncall/incident-checklist",
    type: "Note",
    title: "Incident checklist",
    description: "Declare it, name a lead, open the status page, and keep a timeline.",
    tags: ["oncall", "incident"],
    body: "1. Declare it in #incidents with /incident.\n2. The first responder leads until they hand off.\n3. Open the status page within 15 minutes.\n4. Keep a timeline as you go.\n\nWho to call next: [Escalation contacts](/oncall/escalation-contacts.md). To undo a release: [Rolling back](/deploys/rollback.md).",
    by: "ops@acme.test",
    agent: "Claude Code",
    age: 3,
    sources: [cite("incident-handbook")],
  },
  {
    id: "oncall/rotation",
    type: "Note",
    title: "On-call rotation",
    description: "One engineer a week, Monday to Monday, handed over at standup.",
    tags: ["oncall"],
    body: "Each engineer is on call one week in four, Monday to Monday. The handover happens at Monday standup: open incidents, noisy alerts, and anything half done.",
    by: "maya@acme.test",
    agent: "Cursor",
    age: 45,
  },
  {
    id: "oncall/postmortem-template",
    type: "Note",
    title: "Postmortem template",
    description: "Impact, timeline, cause, and follow-ups with owners, written without blame.",
    tags: ["oncall", "incident"],
    body: "## Impact\nWho was affected, and for how long.\n\n## Timeline\nFrom the incident channel.\n\n## Cause\nWhat let it happen, not who.\n\n## Follow-ups\nEach with an owner and a date.",
    by: "ops@acme.test",
    agent: "Codex",
    age: 25,
    sources: [cite("incident-handbook")],
  },
  {
    id: "oncall/pager-noise",
    type: "Decision",
    title: "Page only for customer impact",
    description: "Alerts that don't affect customers go to Slack, not to the pager.",
    tags: ["oncall", "alerts"],
    body: "The pager is for problems customers feel: errors, slowness, or data loss. Everything else (disk at 70%, a slow batch job) goes to #alerts and is looked at during the day.",
    by: "ops@acme.test",
    agent: "Claude Code",
    age: 80,
    sources: [cite("incident-handbook"), cite("support-call-2026-09-12")],
  },
  // api/
  {
    id: "api/rate-limits",
    type: "Note",
    title: "API rate limits",
    description: "100 requests a minute per API key, answered with 429 and Retry-After past it.",
    tags: ["api", "limits"],
    body: "Each API key may make 100 requests a minute. Past that the API answers 429 Too Many Requests with a Retry-After header in seconds.",
    by: "dev@acme.test",
    agent: "Codex",
    age: 4,
  },
  {
    id: "api/rate-limiting",
    type: "Note",
    title: "How the API limits requests",
    description: "A token bucket per API key: bursts up to 100, refilled over a minute.",
    tags: ["api", "limits"],
    body: "Every API key has a token bucket that holds 100 requests and refills over one minute, so a client can burst and then settle at the rate.",
    by: "dev@acme.test",
    agent: "Claude Code",
    age: 0,
  },
  {
    id: "api/versioning",
    type: "Decision",
    title: "Date-based API versions",
    description: "Each breaking change gets a dated version; old versions live 12 months.",
    tags: ["api"],
    body: "A client pins a version with the Acme-Version header, such as 2026-06-01. A breaking change ships as a new dated version, and each old one keeps working for 12 months.",
    by: "maya@acme.test",
    agent: "Claude Code",
    age: 90,
  },
  {
    id: "api/auth-tokens",
    type: "Note",
    title: "API keys and their scopes",
    description: "Keys belong to a workspace; a scope limits a key to reading or writing.",
    tags: ["api", "security"],
    body: "An API key belongs to one workspace. Its scope is read or write; a read key can't change anything. Keys are shown once, when made.",
    by: "dev@acme.test",
    agent: "Cursor",
    age: 50,
  },
  {
    id: "api/errors",
    type: "Note",
    title: "API error format",
    description: "Every error is JSON with a code, a message, and a link to the docs.",
    tags: ["api"],
    body: 'Errors look like {"error": {"code": "rate_limited", "message": "...", "docs": "https://docs.acme.test/errors#rate_limited"}}. See [API rate limits](/api/rate-limits.md).',
    by: "dev@acme.test",
    agent: "Codex",
    age: 33,
  },
  // decisions/
  {
    id: "decisions/postgres",
    type: "Decision",
    title: "Postgres, not MongoDB",
    description: "Chosen in 2024 for transactions and joins across the billing tables.",
    tags: ["database"],
    body: "Billing needs transactions across invoices, seats, and credits, and reports need joins. Postgres gives both; we chose it over MongoDB in March 2024.",
    by: "maya@acme.test",
    agent: "Claude Code",
    age: 200,
  },
  {
    id: "decisions/monorepo",
    type: "Decision",
    title: "One monorepo with pnpm",
    description: "Every service and the web app live in one repository, built with Turborepo.",
    tags: ["tooling"],
    body: "One repository, pnpm workspaces, Turborepo for builds. A change that spans the API and the web app is one pull request.",
    by: "dev@acme.test",
    agent: "Cursor",
    age: 150,
  },
  {
    id: "decisions/kubernetes",
    type: "Decision",
    title: "Run on managed Kubernetes",
    description: "We moved from VMs to managed Kubernetes in 2025 for autoscaling.",
    tags: ["kubernetes", "k8s"],
    body: "In May 2025 we moved from three VMs to a managed Kubernetes cluster, so the API scales with traffic. See [Release process](/deploys/release-process.md).",
    by: "ops@acme.test",
    agent: "Codex",
    age: 160,
  },
  {
    id: "decisions/soc2-controls",
    type: "Note",
    title: "SOC 2 controls we committed to",
    description: "Quarterly access reviews, encrypted backups, and offboarding within a day.",
    tags: ["security", "compliance"],
    body: "From the 2026 report: production access is reviewed every quarter, departing people lose access within one business day, backups are encrypted and test-restored each quarter, and every change goes through a reviewed pull request.",
    by: "maya@acme.test",
    agent: "Cursor",
    age: 14,
    sources: [cite("soc2-report-2026")],
  },
  {
    id: "decisions/support-hours",
    type: "Decision",
    title: "Support hours",
    description:
      "Support answers within one business day, 9 to 5 Eastern; weekends are pager only.",
    tags: ["support"],
    body: "We answer support within one business day, 9 to 5 Eastern. On weekends only outages are handled, through the pager: see [Page only for customer impact](/oncall/pager-noise.md).",
    by: "dev@acme.test",
    agent: "Codex",
    age: 5,
    sources: [cite("support-call-2026-09-12")],
  },
];

export type DemoProposal = {
  kind: "supersede" | "merge" | "deprecate" | "synonym" | "stale" | "date";
  subject: string;
  target?: string;
  reason: string;
  by: "libro" | "agent";
  agent?: DemoAgent;
  person?: DemoPerson;
  draft?: { title: string; description: string; tags: string[]; body: string };
  support?: number;
};

/**
 * One proposal of each kind. The date proposal is on a concept no other
 * proposal would replace or retire (libro.ts aboutToGo).
 */
export const DEMO_PROPOSALS: DemoProposal[] = [
  {
    kind: "supersede",
    subject: "deploys/manual-deploy",
    target: "deploys/release-process",
    reason:
      "The release process now deploys through GitHub Actions; these SSH steps are from before Kubernetes.",
    by: "libro",
  },
  {
    kind: "merge",
    subject: "api/rate-limits",
    target: "api/rate-limiting",
    reason: "Both say how the API limits requests per key. One concept is easier to keep right.",
    by: "agent",
    agent: "Codex",
    person: "dev@acme.test",
    support: 0.93,
    draft: {
      title: "API rate limits",
      description:
        "100 requests a minute per API key, as a token bucket; 429 with Retry-After past it.",
      tags: ["api", "limits"],
      body: "Each API key has a token bucket that holds 100 requests and refills over one minute, so a client can burst and then settle at the rate. Past it, the API answers 429 Too Many Requests with a Retry-After header in seconds.",
    },
  },
  {
    kind: "deprecate",
    subject: "billing/coupon-codes-2025",
    reason: "The codes expired on Dec 1, 2025, and no agent has read this since.",
    by: "libro",
  },
  {
    kind: "synonym",
    subject: "k8s",
    target: "kubernetes",
    reason: '"k8s" reads as "kubernetes": used on 3 concepts each.',
    by: "libro",
  },
  // The stale and date proposals' dates, and so their reasons, are set when
  // seeding (dev.ts seedDemo): three weeks ago, and 90 days out.
  { kind: "stale", subject: "oncall/escalation-contacts", reason: "", by: "libro" },
  { kind: "date", subject: "billing/team-pricing", reason: "", by: "libro" },
];
