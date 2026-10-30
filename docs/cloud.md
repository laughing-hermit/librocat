# The hosted library

librocat.com: the managed knowledge base, and the default way to use
librocat. A remote MCP endpoint on Vercel, backed by Convex. The same code
self-hosts with Docker (SELF_HOSTING.md), the way Supabase does. The dashboard (Next.js on
Vercel) is the control plane: billing, connected agents, the team,
export/delete, and read-only browsing.

## Stack

| Piece | Service |
|-------|---------|
| Remote MCP endpoint | Next.js route on Vercel (`/mcp`): [mcp-handler](https://github.com/vercel/mcp-handler) 2.x over the official MCP SDK v2 |
| Database + functions + scheduled indexation | Convex |
| Auth | Better Auth on Convex (`@convex-dev/better-auth`): email + password with emailed codes for the dashboard, and the OAuth 2.1 authorization server for the MCP |
| Dashboard + landing | Next.js on Vercel (shadcn/ui) |
| Billing | Stripe Checkout + a Billing Meter for pay-as-you-go descriptions and tags |
| Automatic indexation and Libro's screens | Vercel AI Gateway: Jev (`typesafe-ai/jev`, typed judgments), the one model. No writing model: the person's agent writes. No embedding model: search goes by words |

## How the remote MCP works

- The endpoint is `https://librocat.com/mcp` (in development
  `http://localhost:3000/mcp`). It speaks stateless Streamable HTTP: the
  2026-07-28 MCP revision natively, and 2025-era clients through the SDK's
  stateless fallback. GET/DELETE session calls answer 405 by design.
- Clients authenticate with OAuth 2.1, the way remote MCP servers such as
  Stripe's, Vercel's, and Resend's do: no header to configure, no token to
  copy. A call without a token gets a 401 whose `WWW-Authenticate` names the
  protected-resource metadata (`/.well-known/oauth-protected-resource/mcp`),
  which names the authorization server (`https://librocat.com/api/auth`).
  The agent registers itself (dynamic client registration), opens the
  browser for the user to sign in and approve it on `/consent`, and comes
  back with a one-hour JWT access token bound to `https://librocat.com/mcp`
  plus a refresh token.
- The route verifies the token against Better Auth's JWKS, registers the
  tool table (`packages/mcp/src/tools.ts`) over a
  Convex backend (`apps/web/src/lib/mcp-backend.ts`), and calls each Convex
  function in `apps/web/convex/mcp.ts` with that same token. Convex checks it
  again (`convex/auth.config.ts`), resolves the workspace from the user it
  names, and checks the agent still holds the user's grant, so a disconnect
  on the dashboard takes effect on the agent's next call.
- Tools: twenty. See
  [mcp-tools.md](./mcp-tools.md). Concept bodies are capped at 16 KB (64 KB
  self-hosted).
- Concepts live in a Convex table with search indexes, and `search` goes by
  words, expanded through the thesaurus, with the catalog record above the
  body: see docs/architecture.md, "Search". Links live in a second
  table, so a concept's `links` and `graph` stay indexed queries. Revisions
  live in a third: every `ingest`, `update` (a move with `new_id` too), and
  automatic indexation appends a full snapshot, so `get_concept` with
  `history: true` is the workspace's commit log and any past revision is
  readable (`revision`). librocat.com needs no Git repo; export the OKF zip when you
  want the files in one.
- **The catalog index** (`facets`, `facetCounts`; `model.ts` facetsOf and
  reindexConcept): what each concept is filed under (type, status, tags,
  authors, the sources it cites, what supersedes it) and how many concepts
  carry each type and tag, kept as concepts change. `status`, `list`,
  `get_source`'s citations, cataloging's vocabulary, retag, and rename read
  it, so no call reads the whole library: a Convex function may read 16 MiB,
  and a Team library of 15,000 concepts is about 15 MB. The passes that
  look at a whole library (Libro's review, Libro's report, the weed
  report on `review_shelf`, `list` in Markdown, and `files_changed`) read
  at most 5,000 concepts at a
  time (`SCAN`: every Free and Individual library whole), choosing the most
  recently changed, the longest unchanged, or the first by id, and say so on
  a bigger library.
  `migrations:indexCatalog` files libraries from before the index.

### Connecting agents

The four coding agents (Claude Code, Codex, Cursor, GitHub Copilot) each
install librocat's plugin their own way;
`npx plugins add laughing-hermit/librocat` installs it in every agent that
takes Agent Plugins; and the desktop agents install it from this repository
as a marketplace (README, "Install"). Any MCP client that speaks remote MCP
connects to `https://librocat.com/mcp` and runs the OAuth sign-in (the
Agent Plugin's `mcp.json` is exactly that URL). `npx add-mcp https://librocat.com/mcp --name librocat -g` writes that
entry into the agents on a machine, and `npx skills add laughing-hermit/librocat -g`
installs the Agent Skills; a self-hosted librocat swaps the URL. An agent
that can only spawn stdio servers reaches the endpoint through mcp-remote.
librocat ships no client of its own: agents, the dashboard, and the e2e
suites are the only callers.

An agent does the library's work without the dashboard: it writes, searches,
reads, keeps sources, works Libro's review shelf with the person, and fills
what `review_shelf` lists as `missing` (the questions no concept answered,
the files no concept cites). What only the person does stays on the
dashboard, behind their own sign-in: the team and roles, billing, deleting
a library or the account, and disconnecting agents. An agent's token is
refused there (`identity.ts` personId), so a prompt it read can't do them;
the MCP's instructions give it each page's link to hand the person.

### Auth: OAuth 2.1, one identity for both doors

Better Auth runs inside the Convex deployment (`convex/auth.ts`, installed
locally under `convex/betterAuth` because the OAuth provider adds tables).
The same user signs in to the dashboard and approves agents; a write through
the MCP records both (`revisions.userId`, `revisions.client`). Next.js
proxies `/api/auth/*` to the Convex site (`src/lib/auth-server.ts`) and
serves the discovery documents at the site root (`src/app/.well-known`),
which Vercel's CDN keeps for an hour (`s-maxage`; a deploy purges it), so
an agent connecting runs no function. On Vercel, BotID (Basic, free; Deep
Analysis stays off) checks the posts of the sign-up, sign-in, and
email-code forms (`src/lib/bot-check.ts`, `src/instrumentation-client.ts`):
a bot gets a 403. It needs Vercel's network, so local runs, e2e, and
self-hosted installs skip it, and an agent's OAuth calls are never checked.

- Access tokens: RS256 JWTs, `iss` = `SITE_URL/api/auth`, `aud` =
  `SITE_URL/mcp`, one hour. Refresh tokens rotate on use.
- Cleanup (`convex/authCleanup.ts`, daily at 05:30 UTC): expired sessions,
  emailed codes, and tokens are deleted. OAuth clients stay, approved or
  not: an agent may come back with its registration any time. Registering
  needs no sign-in and is never limited, so nobody connecting an agent is
  turned away; past 5,000 registrations in a day, the owner gets a note
  (`LIBROCAT_FUNNEL_EMAIL`).
- Connected agents: the Connect page lists every agent in the user's
  libraries, theirs and their teammates' (`convex/agents.ts`): its app, its
  person, its library, and when it was last used. An `agents` row is made
  when an agent is approved (the `oauthConsent` trigger in
  `convex/auth.ts`), moves to the library its calls reach, and records its
  use at most hourly. Only its own person can disconnect it, immediately.
- Teams: each person has their own account; an admin shares an invite link
  (`convex/team.ts`, `/invite/[code]`), as many as Team's seats.
- Roles, one per person in each library (`members.role`, `convex/membership.ts`
  canWrite): an **Admin** runs it (team, billing, deleting it; the owner is
  always one), an **Editor** (`member`) and their agents change it, and a
  **Reader** and their agents only read it: search, read, export. Every
  change checks the role in Convex, the agent's (`mcp.ts` writerOf, the URL
  fetch before it fetches) and the dashboard's (`requireWritableWorkspace`),
  since an agent's token reaches every public function. Admins set roles on
  the Team page, and an invite link says who joins as what (Editors by
  default). Readers take a seat like everyone.
- What only a person does: an agent's token acts as its person, but names
  its agent (`azp`), and is refused for their account, their libraries
  (create, switch, rename, delete, leave, empty), the team, billing and
  pay-as-you-go, and disconnecting agents (`convex/identity.ts` personId).
  An agent tricked by what it read can't do any of these.
- Not built yet: client ID metadata documents (the MCP 2026-07-28
  preference over dynamic registration) wait for `@convex-dev/better-auth`
  to support Better Auth 1.7 (`@better-auth/cimd`).

## Automatic cataloging and the monthly allowance

What librocat does when an agent leaves a catalog record blank. librocat
composes no text of its own: the agent writes (the librocat-write skill asks
it to), and what it leaves blank, librocat fills only by selecting. After an
`ingest` or `update` that leaves a concept **without a description or
without tags**, a
scheduled Convex action (`convex/indexation.ts`) catalogs it:

1. It reserves one **index credit** in a mutation (atomic).
2. **Code** builds the candidates: up to eight prose sentences from the body
   (5 to 40 words each) for the description, and up to 40 tags from the
   library's vocabulary (tags used on the concept's shelf first, then the
   rest, then the thesaurus's unused preferred tags). Each tag carries its
   scope note and up to three titles already filed under it, the shelf list
   a cataloger checks before choosing a heading.
3. **Jev** (`typesafe-ai/jev` through the AI Gateway's `/v1/evaluate`,
   override with `LIBROCAT_EVAL_MODEL`) answers typed questions in one
   request: which candidate sentence works as the description (or none), and
   one yes/no per candidate tag, judged against its scope note and shelf
   list. Jev selects; it never writes text, so a transcribed description
   cannot invent a fact. Its input costs $0.042 per million tokens and its
   output is free, a small fraction of a generative call; each call's real
   cost is in the log line below.
4. It writes only what the writer left blank, files under the most specific
   tag (a broader tag goes when a narrower one is there, Cutter's rule of
   specific entry), records how in `cataloged` (`description: transcribed`,
   `tags: selected`, `by`, `at`), and stamps `indexed_at`. What Jev can't
   pick stays blank for the agent, and the credit is refunded: when nothing
   could be filled, or there is no Jev. The log line
   `{"indexation":{"jev":…}}` records the call and its cost.
5. A concept Libro couldn't catalog **waits** (`catalogWaiting`): when Jev
   couldn't be asked (down, or slow; its credit is refunded), or no credit
   was left. A daily job (`resumeWaiting`, 04:30 UTC) tries again, each
   spending its credit as above, as far as the library's credits reach
   (`creditsLeft`: what's left of the month's, then pay-as-you-go to its
   cap), up to 50 a library a day, a library's two half a second apart; a
   library with none waits, for free, until they renew. One Jev answered
   but found nothing to pick for isn't asked again, and one its writer
   fills stops waiting.

Every Jev request asks the gateway for zero data retention, from TypeSafe
only (`providerOptions.gateway`: `zeroDataRetention: true`,
`only: ["typesafe-ai"]`, convex/jev.ts; no extra cost on Vercel Pro). The
gateway keeps no prompt or output, and TypeSafe's ZDR terms with it keep
neither past answering, except where the law requires. Without the `only`,
the gateway may route Jev through DigitalOcean, a passthrough with no ZDR.
With no ZDR route up, the request fails (400) and the caller retries later:
a concept's credit is refunded and it waits for the daily job, as a file
read does.

Credits per calendar month (UTC): Free 200, Individual 500, Team 2,500
(`INDEX_CREDITS` in `convex/model.ts`). Past the included credits, a paid
workspace continues only when it turned **pay-as-you-go** on in Billing:
$0.01 per extra credit (`INDEX_CREDIT_OVERAGE_CENTS`), reported to a Stripe
Billing Meter once the work it paid for is done, up to the library's
monthly cap. The cap is $10 unless its admins set another, in whole dollars
from $1 to $1,000 (`PAY_AS_YOU_GO_CAP_CENTS`). The admins get an email at
80% of the cap and at the cap (`convex/billing.ts`), each once a month, and
again after a change to the cap. Past the cap, or without pay-as-you-go,
cataloging waits until credits renew, and the daily job goes on with it. While a payment is overdue (Stripe's
`past_due`: the plan stays on while Stripe retries the card),
pay-as-you-go waits too (`payAsYouGoOn`), and Billing says so, until
Stripe collects. Only a library's admins change
pay-as-you-go and its cap. `status` reports `index_credits` (`included`,
`used`, `remaining`, `overage`, `pay_as_you_go`, `overage_cents`,
`cap_cents`, `period`); Settings › Billing shows them as "Libro catalogs
concepts and reads your files", and on a paid plan has the switch (in the
Pay-as-you-go card's header), the month's spend as a meter against the
cap, and the cap in dollars. Agents that already catalog fully (the
librocat-write skill) spend nothing, and so does a file an agent attaches; a
file a person adds is read for credits (`convex/fileCatalog.ts`).

Env on the Convex deployment: `AI_GATEWAY_API_KEY`, optional
`AI_GATEWAY_API_KEY_FREE`, `LIBROCAT_EVAL_MODEL`, `LIBROCAT_AI_GATEWAY_URL`.
That is librocat.com's pipeline, and its users don't choose the model. A
self-hosted librocat brings its own System One (`convex/ai.ts`;
SELF_HOSTING.md, "Models"): Jev through the gateway or from TypeSafe's own
API (`TYPESAFE_API_KEY`), an open-source one on a server that speaks
TypeSafe's API (`LIBROCAT_JEV_URL`), or none. An LLM doesn't stand in for
it; without one, cataloging and Jev's screens are off, and search works the
same. `npx convex run probe:models` checks it on any deployment: what runs
it, and one small call; `probe:judge` scores it on librocat's own
questions.

## Libro, the library cat

librocat's librarian is a library cat named Libro. Libro is library rules
and one model, Jev: the checks of a whole library that an agent can't do
alone, run unattended. Libro fills in a description and tags an agent left
out (automatic indexation, above), and proposes everything else: it puts
what it finds on a review shelf, nothing there changes until a person
approves it, and every change is a new revision. The person's own agent
works the shelf with them, through the MCP tools `review_shelf`,
`propose`, and `decide` (docs/mcp-tools.md; the knowledge-review skill says
how). Libro is the same on every plan, and self-hosted:

- **Automatic cataloging** (the monthly allowance, above): Libro selects a missing
  description or tags after `ingest`/`update`.
- **Source watch** (paid plans, `convex/fetching.ts`): in the weekly review,
  Libro fetches again the kept source pages that concepts cite (up to 50,
  each at most once a week). A page whose text changed replaces its copy,
  and Jev judges whether the change matters: one request a page, with what
  changed (the paragraphs that went and came, a few hundred characters a
  side) and the catalog record (title, description) of up to 20 citing
  concepts. Only those it judges affected (60% sure or more) come up for
  review, with a `stale` proposal naming the page; the others stay as they
  are. When Jev can't be asked (an outage, or a self-hosted librocat with no
  Jev), every citing concept comes up, as before, and so does any past the
  first 20. The log line `sourceWatch` counts the pages checked, changed,
  and failed, the concepts put up for review or judged unaffected, and the
  pages that fell back. The reading list, the kept
  sources no concept cites yet, is in Libro's report (docs/mcp-tools.md,
  "Sources: attach documents and pictures, then catalog them").
- **Attached files** (`convex/attachments.ts`, every plan): a document or a
  picture attached on the dashboard, or by an agent through `add_source`, goes
  straight to Convex file storage (an upload URL; never through the MCP
  route). librocat keeps text and pictures only: audio, video, and other
  files are refused before the upload (`accepted` and `refusal` in
  `@librocat/core/sources`, checked again in `convex/sources.ts`). A Node action
  reads its text where code can (unpdf for PDF, and `convex/officeText.ts`
  for Word and OpenDocument text with their headings as `#` and lists as `-`,
  spreadsheets as CSV, slides with their notes, RTF, and EPUB) and splits it
  into parts of about a page. A picture is kept as a part of its own, for
  the dashboard and `get_source` to show; pictures other than PNG and JPEG
  (HEIC, WebP, GIF, AVIF, TIFF, SVG) get a JPEG copy (`convex/pictures.ts`:
  sharp, an external package in `convex.json`, and heic-convert).
  `npx convex run --prod fileProbe:run` checks the pictures and the office
  documents. An agent's attaching doesn't count toward descriptions and tags; a file a person
  adds costs one a read, about three pages, as Libro reads it end to end (convex/fileCatalog.ts: its description and tags, and the
  concepts it changes, which come up as Outdated). A stored file nothing holds
  (an upload never attached, a picture whose conversion stopped) is deleted
  after a day (`sources.pruneUnattached`, daily at 05:00 UTC;
  `migrations:pruneUnattached` sweeps older ones once). Search returns the
  matching sources after the concepts: a part by its words (`sourceParts`),
  and a source by its stemmed title (`sources.titleStem`), so a picture or a
  scanned PDF is found by its title and by the concepts written about it.
  No model reads a file, and deleting a source deletes its file.
  A source's page has a Preview tab (the file as it is: a PDF's pages drawn
  by PDF.js through react-pdf, the picture, Markdown formatted, a
  transcript's lines, a spreadsheet's first 200 rows; `previewable` in
  `@librocat/core/sources`) and a Text tab (what agents read). A PDF or a
  picture previews from its file link, so it counts as a download: up to
  5 MB it shows at once, up to 16 MB on "Show preview" (`AUTO_PREVIEW_BYTES`,
  `src/components/preview-on-demand.tsx`), and a bigger one only downloads.
  Office documents and web pages show their text alone.
- **The review shelf** (`convex/libro.ts`, table `proposals`): once a week
  (cron, Monday 07:00 UTC, 200 libraries a run, each review a little
  apart), Libro reads
  the library and files proposals: *supersede* (two concepts with the same
  title, or the same name on two shelves; the older is superseded by the
  newer), *retire* (a stable concept that already carries `superseded_by`,
  or one never read in 90 days), *merge tag* (two spellings of one tag; the
  rarer becomes a `use_for` of the common one in the thesaurus). Libro
  proposes, the user disposes: Approve applies the change as a revision by
  the proposal's author (`by: "libro"`, or the agent that filed it),
  Dismiss files it away for good (one proposal per kind,
  subject, target, ever). `status` reports `review_shelf`, the open count.
  *Past its date*: a live concept whose OKF `stale_after` has passed. **Still
  true** records the person's check (OKF `verified`, `human:<id>`) and moves
  the date 90 days ahead; **Retire** deprecates it. The date is part of the
  proposal's key, so a concept comes back when its new date passes.
  Every plan gets this mechanical pass; it calls no model. On Free the
  weekly pass runs when something was written since the last one, and
  monthly while the library sits idle, so an idle library costs nothing.
- **What Jev does, and what it leaves to the agent.** Jev takes work that
  runs unattended (the review, crons, the source watch), that is a bounded
  judgment (a probability or a choice, never new text), and that is capped
  per run or metered. The person's own agent does the writing, the reading
  of files, the reasoning in several steps, the talking with the person,
  and the judgments made at write time (`possible_duplicates` on `ingest`),
  at no cost to librocat. There is no Jev call per search or per write.
- **Jev's screens, every plan**, after every review, when the deployment
  has Jev (`AI_GATEWAY_API_KEY`). No generative model; a fraction of a cent
  a run.
  - **Pairs** (`libro.pairsScreen`): code pairs concepts on one shelf that
    share two or more tags or most of a title, and each concept written
    since the last review (up to 50, newest first) with its 5 nearest by
    words on any shelf (the catalog index, stemmed and through the
    thesaurus). Jev judges up to 20 pairs ("the same subject?") in one
    request. Pairs it confirms go on the shelf as supersede proposals,
    older by newer. It compares within shelves each time and skips a pair
    already proposed, so a same-shelf pair Jev missed waits for the next
    review; a pair by words comes back when either concept changes.
  - **Review dates** (`libro.datesScreen`): up to 20 concepts changed since
    it last looked, none already suggested or with an open supersede, merge,
    or deprecate. A date one writes out that hasn't come yet (ISO, "October
    15, 2026", "Q4 2026") is read by code: the review is the day after it.
    For the rest, one Jev request with four yes/no questions each, a
    schedule (30 days), a price (90), a version (90), an owner (182); the
    soonest kind at 80% or more sets the date. The *Review date* proposal
    says why ("States a price (Libro is 92% sure). Check it again by Jan 19,
    2027?"): set it, change the date first, or dismiss it.
  - **Synonyms by meaning** (`libro.synonymsScreen`): the mechanical pass
    folds spellings of one tag; this finds tags that mean one thing under
    other words (`k8s`, `kubernetes`). Code pairs the tags of live concepts
    that two or more concepts carry together, or whose words share a stem,
    leaving out what the thesaurus settles (a use-for term, two preferred
    tags, a pair related there) and pairs proposed before. Jev reads up to
    20 pairs, each tag with a few titles of the concepts that carry it, in
    one request ("the same meaning in this library?"), and a pair it is 85%
    sure of goes on the shelf as *merge tag*: the rarer tag under the more
    used one (or under the preferred one). Approving files it as a
    `use_for` in the thesaurus and retags the library, so search finds
    either word.
  - **Failures:** when a call fails, nothing is marked done, and the next
    review retries.
  - **Checking the live model:** `npx convex run --prod probe:models`.
- **The person's agent works the shelf** (`convex/mcp.ts`): `review_shelf`
  lists the open proposals, with the weeding report, kept a day while the
  library is unchanged (table `weedings`); `propose` files a `merge` (with a draft of the
  target: every fact and link from both, nothing invented), `supersede`,
  `deprecate`, or `synonym`, `by: "agent"`, with the person and the agent
  as a revision names them; and `decide` approves, dismisses, or verifies
  one, on the person's say-so. A merge rewrites the target with the draft
  and supersedes the subject, and closes a screen's supersede of the same
  pair. A merge draft is agent-written, so Jev checks it against its two
  source concepts (`libro.checkDraft`) and the shelf shows the result:
  "The draft matches its sources (95%).", or a warning to read both first
  when it is under 80 %.

## The reference desk and Libro's report

**The ready-reference file** (`convex/reference.ts`). Every MCP `search` is
a question put to the library, so `search` files it in the same mutation
that answers it (`mcp.ts searchWords`), with no model call:

- **What is kept:** the query (capped at 300 characters), how many results
  it found and the first five ids, and who asked (the person and the
  agent).
- **The answer:** the first of those results the same asker opens within
  ten minutes (`get_concept`).
- **Secrets:** a query that looks like it carries one is never kept.
- **Retention:** questions are kept 90 days (a daily cron prunes them) and
  go with the index when it is deleted.

How questions are grouped and counted:

- **One question, its content words.** A question's key is its content
  words, lowercased, plurals dropped, deduplicated, and sorted
  (`foldQuestion`), so "rotate the Stripe keys" and "Stripe key: rotate"
  are one question. A rewording in other words is a new question. No model
  groups questions, and none judges a search.
- **Unanswered** means it found nothing.

What it gives back:

- **Ready reference:** a question asked again (the same content words) gets
  the concept that answered it before as the first hit, marked
  `ready_reference: true`.
- **The reference desk:** the questions split into "Asked most" (and what
  answered each) and "No answer yet": what agents looked for and the
  collection doesn't have, what to write down next. Libro's report carries
  the week's.

**Libro's report** (`convex/report.ts`):

- **What it covers:** what arrived and changed this week, what is past its
  review date, what waits on the review shelf, what agents read, and the
  questions that found no answer.
- **When it comes:** by email (Resend) at 08:00 UTC, an hour after Libro's
  review: every Monday on paid plans and on a self-hosted librocat, and on
  the month's first Monday on Free; its link opens the Library's Needs you
  tab, where what needs a decision is live, ten at a time, filtered by the
  kind its badge names (two or more review dates, or tag pairs, approve in
  one click).
- **In Needs you, from the same questions:** "Couldn't find" (the report's
  "No answer yet") and "File waiting" (sources added in the last 30 days no
  concept cites), each with Copy prompt and a Dismiss that holds until it
  is asked again or the source changes (`convex/dashboard.ts`).
- **Who gets the email:** admins by default. Each member turns it on or off
  in Account (the menu under their email).
- **Unsubscribing:** every email carries a one-click unsubscribe (RFC 8058
  `List-Unsubscribe`) that needs no sign-in: `/api/unsubscribe`, with an
  HMAC of the member's id signed with `BETTER_AUTH_SECRET`. Opening the
  link only asks, with a button, since mail scanners open links too; the
  button and the mail client's one-click POST.
- **Empty libraries** get no email.

## The weekly funnel

Every Monday at 09:00 UTC, `convex/funnel.ts` emails the owner how far
people got, to `LIBROCAT_FUNNEL_EMAIL` (one address, or several separated by
commas; unset, nothing is sent). It reads what librocat already records,
and one count of its own: the files librocat refused, by kind alone.

- **The last 7 days:** sign-ups (and those who never entered their emailed
  code), agents connected (by app: the name each agent registered with,
  matched to an app librocat knows, else "other"; never the name itself),
  concepts written, searches, paying libraries (by plan, and by which agents
  their members connected: coding agents, desktop agents, or other, so the
  marketing can follow the agents that pay; one library can count in more
  than one), and files refused (audio, video, or other; `refusals` in the schema, one row
  per refusal with no name, library, or person). That last line says whether
  people want recordings kept. Page views, a few named events (sign-ups,
  agents approved, files attached, install commands copied, checkouts
  started), and page speed are in Vercel Web Analytics and Speed Insights,
  by route and with no content; the email links to them.
- **The funnel** of the people who signed up the week before, each with a
  full first week: signed up (verified their email), connected an agent
  (approved one), wrote a concept (one was written for them), and came back
  (wrote or searched on a later day). The email names the step that lost
  the most people, which is the one to work on first.

`npx convex run --prod funnel:preview` returns the numbers without sending;
`funnel:send` sends now.

## Projects are shelves, not libraries

One workspace is one library: one thesaurus, one graph, one weeding report,
one review shelf for Libro. Projects live on **shelves**, the leading
directory of the concept id (`acme/…`, `billing/…`). `search` and `list`
take `shelf` to scope a read to one project; an agent working in that
project reads its shelf first and the whole library second, so a decision
made in one project is still found from another. Every shelf gets a finding
aid. Make a second library only when access must differ (a client under
NDA, personal vs employer), never to get a per-project view.

## Several libraries

A person can belong to several libraries, like Supabase projects: their own,
and the teams they joined. Each library has its own members, plan, quota,
and review shelf. An agent works in one of them, picked when it signs in,
the way Notion's and Linear's MCPs pick a workspace:

- `https://librocat.com/mcp` reaches the library the agent's person picked
  on the consent page when they approved it (the dashboard's open library
  is picked first; `agentLibraries` in `convex/schema.ts`). An agent
  approved with one library, or before the pick existed, reaches the
  **default** library, the first you joined. So the plugins, which all use
  this URL, reach any library, and the dashboard's Connect page is the same
  on every library.
- An agent never changes library by itself. Installing it again keeps the
  library it has; to move it, disconnect it on Connect, and its next
  sign-in asks again. If its library is deleted, or you leave it, the
  agent's calls stop with a message saying just that. One agent works in
  one library at a time; a repo that needs another pins it with
  `?library=` below.
- `https://librocat.com/mcp?library=<slug>` reaches that library whatever
  the agent picked. A repo pins its library with this URL in its
  `.mcp.json`.
- One OAuth sign-in covers all of them. The library is never in the token:
  the token's audience stays `/mcp` (a resource has no query, RFC 9728; the
  `/api/auth` proxy drops one a client sends), and every call checks
  membership (`convex/mcp.ts`, `convex/membership.ts`). A library you don't
  belong to answers "no library", never a fallback.
- The dashboard shows one library at a time (the switcher at the top of the
  sidebar). Switching changes the dashboard only; agents keep their own.
- **New library** makes one on the Free plan, or, for a person on a Team
  with room, under their Team (below). A person can own one Free
  library (`FREE_LIBRARIES` in `convex/model.ts`); a paid one never counts.
  Past it, New library asks for a plan: it makes the library, switches to
  it, and opens its Checkout (`createLibrary` with `checkout`, which lets one
  more wait on Free for its payment).
  **Delete library** (its owner) removes it and everything in it and cancels
  its plan. Deleting an account deletes every library its person owns.
  Either cancels at once and bills the month's pay-as-you-go credits then,
  if there are any (`stripe.cancelSubscription` with `invoice_now`, from
  `model.usedPayAsYouGo`; none, no $0 invoice); the plan's unused time isn't
  refunded. Deleting your last library makes you a new one at once.
- Joining a team through an invite folds away your own library only if it is
  empty and has no plan, so the team's becomes your default; one holding
  knowledge stays, and the team's is reached by its slug.

## Plans and quota

Account memory is measured in **concepts**, never in bytes. The one
exception is kept sources, files and text together (docs/mcp-tools.md,
"Sources"): 100 MB per library on Free, 5 GB on Individual, and 25 GB on
Team (`SOURCE_BYTES` in `convex/model.ts`), one file up to 50 MB on Free and
200 MB on paid plans (`MAX_FILE_BYTES`). A self-hosted librocat has no cap.
Storage costs little (Convex Pro: 100 GB included, then $0.03 a GB a
month); Jev's cataloging and file reading are what cost, and Libro's credits
meter them: a credit
costs librocat about $0.0001 to $0.0003, so a Free library's 200 credits
come to at most about $0.06 of model time a month.

- Free: every new account, one library each. 1 user, 1,000 concepts,
  200 of Libro's credits a month (a concept cataloged, or about three pages
  of a file you add; files use at most half), Libro's review shelf (reviewed when something was
  written), and Libro's report emailed on the month's first Monday. No
  pay-as-you-go. No card.
- **Every plan has a ceiling on everything that costs**, so no library can
  cost more than its plan brings in (`convex/limits.ts`, `convex/model.ts`,
  `convex/ai.ts`). The monthly ones are token buckets
  (`@convex-dev/rate-limiter`) that refill over 30 days, day by day; over
  one, the agent is told which and when it can go on, and `status` reports
  what's left (`monthly`, `index_credits`). On Free
  each is its allowance; on a paid plan, a ceiling about fifteen times what
  a busy agent uses, sized so a library that maxes every ceiling at once
  still costs less than its plan brings in.

  | Per library | Free | Individual | Team |
  | --- | --- | --- | --- |
  | Concepts (`CONCEPT_QUOTAS`) | 1,000 | 5,000 | 15,000 |
  | Files and kept text (`SOURCE_BYTES`) | 100 MB | 5 GB | 25 GB |
  | …of which text (`TEXT_BYTES`) | 10 MB | 250 MB | 1 GB |
  | Largest file (`MAX_FILE_BYTES`) | 50 MB | 200 MB | 200 MB |
  | Libro's credits a month (`INDEX_CREDITS`) | 200 | 500, then pay-as-you-go to its cap | 2,500, then pay-as-you-go to its cap |
  | Calls a month, each counted by what it reads (`CALLS_PER_MONTH`) | 10,000 | 30,000 | 30,000 a person |
  | Writes a month (`WRITES_PER_MONTH`) | 1,500 | 5,000 | 5,000 a person |
  | File transfer a month, downloaded or attached (`TRANSFER_BYTES_PER_MONTH`) | 1 GB | 10 GB | 50 GB |
  | Revisions kept (`REVISIONS_PER_CONCEPT`, `REVISIONS_KEPT`) | 100 a concept, 2,000 in all | 100 a concept, 10,000 | 100 a concept, 30,000 |
  | Concept body (`MAX_BODY_BYTES`) | 16 KB | 16 KB | 16 KB |
  | Calls a minute, writes and searches (`CALLS_PER_MINUTE`) | 60 | 300 | 600 |
  | Pay-as-you-go a month (`PAY_AS_YOU_GO_CAP_CENTS`) | none | $10 unless the admins set $1 to $1,000 | the same |

  On Team, the column is the Team's: the libraries it covers share it
  (below), except the calls a minute, which stay each library's.

  - A write is a concept written, changed, renamed, or deleted, a source
    kept or deleted (on the dashboard too: an upload, an attach, a saved
    link, counted before librocat fetches it), a proposal, or a decision; a
    write that changes nothing keeps no revision.
  - A call counts by what it reads, as Convex bills reads by the byte: once,
    and once more for each 256 KB past the first (`convex/metered.ts`).
    Almost every call reads far less, so it counts once; a pull, an export,
    or a pass over a big library counts what it copies. The count happens
    inside Convex, in the call's own mutation, so an agent's token or a
    dashboard session calling Convex directly counts the same: every
    function that reads a library is a mutation (the MCP tools, and one
    counted call per dashboard page: `dashboard.overview`,
    `dashboard.concept`, `concepts.list`/`search`, `sources.list`/`read`,
    the export's pages). The small reads (who you are, your libraries, the
    team, the plan) stay queries, so Billing always opens. The count past
    the first 256 KB may go into debt: the work is done, and the next call
    waits until the month refills past it.
  - No call nears what one Convex function may read (16 MiB): a pass over
    concepts stops at 5,000 of them or about 4 MB (`scanConcepts`), and says
    what it covered; questions at 1,000 or 2 MB; a search reads at most 120
    bodies and returns at most 50; a concept's `links` and `graph` read at
    most 100 links each way, and `graph` reads only its own nodes; the shelf
    lists its oldest 100 and `status` counts open proposals up to 100; the
    export's source pages hold two sources; a move (`update` with `new_id`)
    refuses a concept more than 500 concepts link to.
  - `list` pages with Convex's own cursors (`model.listPage`), led by the
    filter's facet when one value names it, so going through a whole
    library reads one page a call; `offset` reaches the first 500.
    `get_concept` with `ids` reads 20 at once, so an agent copies a
    library a page of 100, then five reads.
  - `files_changed` looks up instead of scanning: each live concept's code paths
    are in the catalog index (`facets`, kind `path`; a directory ends in
    `/`), and a changed file looks up itself and each directory above it
    (`pathsAbove` in @librocat/core). `migrations:indexPaths` files them
    for concepts written before.
  - Sizes are capped when written: a concept's catalog record (its
    frontmatter: title, description, tags, sources) holds at most 4 KB and
    it links to at most 200 concepts (`MAX_RECORD_BYTES`, `MAX_LINKS`;
    16 KB and 1,000 self-hosted), and the thesaurus at most 64 KB.
  - Text lives in the database, where a GB costs about $4 a month with
    its daily backup and word-search index, against $0.03 for a GB of
    files; so text has its own ceiling inside the storage quota. Text past
    it is refused; a file past it is kept without its text, found by its
    title, and says why.
  - File transfer counts the bytes a download serves, as it serves them,
    and each file attached, which librocat reads to index it. No
    storage URL leaves Convex: `get_source` and the dashboard hand out
    librocat's own file links (`convex/files.ts`), served by an HTTP action
    on the deployment's site (`/files/<token>/<name>`). A link is signed
    (HMAC with `BETTER_AUTH_SECRET`), names its library, file, and bytes,
    and lasts one to two hours, the same URL all hour so a browser's cache
    keeps a preview; a shared link stops working when it expires, and
    counts until then. An HTTP action answers at most 20 MiB, so a file
    over 16 MiB comes as `download_parts`, which an agent and the
    dashboard join. Past the allowance a link answers 429 and says when
    more comes back, `get_source` returns the text without links, and a
    new file waits. Convex bills each byte once, as data egress (reading a
    file inside a function); an HTTP action's response isn't egress.
  - Free libraries' model calls use `AI_GATEWAY_API_KEY_FREE` when it is
    set: a gateway key with its own monthly budget, so all free traffic
    together has a hard ceiling and never spends the paid plans' key.
- Individual ($12/mo, or $10/mo billed yearly): 1 user, 5,000 concepts,
  500 of Libro's credits a month, then pay as you go; the reading list, source watch, and
  Libro's review and report every week.
- Team ($15 per person a month, or $12.50 billed yearly; three people or
  more): 15,000 concepts, 2,500 of Libro's credits a
  month, then pay as you go; the
  same, shared by the team. Each person signs in with their own account and joins
  through an invite link (Settings › Team). The subscription's quantity is the
  seats (`MIN_TEAM_SEATS` 3 to `MAX_TEAM_SEATS` 100 in `convex/model.ts`):
  Checkout starts at the people already in the library and lets the buyer
  change it, and an admin changes it later in Settings › Billing
  (`stripe.updateSeats`; Stripe prorates it and bills it at once). The Stripe customer portal
  can't change quantities on a subscription with a metered item (one with
  pay-as-you-go), so seats change there, not in the portal, for every Team
  alike. An invite past the seats is refused.
- **The card a plan charges is the subscription's own**: Checkout saves it
  there, and it wins over the customer's default, so a card added in the
  portal on its own (even marked Default) isn't what a renewal charges. It
  changes with the pencil next to the plan's card in the portal; under
  Managed Payments the API can't change it. Billing says so, and Stripe's
  expiring-card and failed-payment emails link to a page that changes it.
- **A Team covers its buyer's libraries**, up to 10 (`TEAM_LIBRARIES` in
  `convex/teamCover.ts`), on one bill. The library holding the subscription
  is the home; the others take the Team plan with `coveredBy` pointing at it,
  and follow it (`syncCover`, run when the home's plan, status, or seats
  change, and when it's deleted).
  - Seats count each person once across the libraries (`teamPeople`), for
    invites (`team.accept`) and for the fewest seats Billing allows.
  - The libraries share the plan's ceilings: concepts, files and text,
    credits and pay-as-you-go, and the month's calls, writes, and file
    transfer (`poolOf`). A check compares a library's own count with its
    room, the plan's ceiling less what the others use (`roomOf` in
    `convex/model.ts`); the monthly buckets count under the home's key
    (`poolKey`); credits are spent from the home, and its pay-as-you-go
    meters to the home's Stripe customer (`payerOf`, `billing.customerOf`).
    So a Team's worst case is one Team library's, however many it covers.
  - A library that comes under a Team keeps what it paid for: its own
    subscription ends at the end of its period (`cancel_at:
    "max_period_end"`, `stripe.endAtPeriodEnd`), not prorated, since a
    proration credit would sit on that library's own Stripe customer. Its
    old subscription's events change nothing after (`billing.setStatus`),
    and a Checkout completed for it anyway ends the same way
    (`billing.activate`).
  - A library made on a Team with room comes under it (`createLibrary`);
    past 10, New library asks for a plan.
  - Billing on a covered library says where it's billed and hides the
    plan, seats, and pay-as-you-go controls (Checkout, seats, the switch to
    Team, and pay-as-you-go refuse it too); the home lists what it covers.
    Billing and the "Almost full" banner count the Team's libraries
    together.
  - When the Team ends, or its home is deleted, its libraries go back to
    Free with everything in them; Free's limits apply again.
- Both paid plans check out through Stripe (one price per plan per
  interval: `STRIPE_PRICE_ID_INDIVIDUAL`, `STRIPE_PRICE_ID_TEAM`,
  `STRIPE_PRICE_ID_INDIVIDUAL_ANNUAL`, `STRIPE_PRICE_ID_TEAM_ANNUAL`, plus
  the metered `STRIPE_PRICE_ID_INDEXATION` on a subscription whose library
  turns pay-as-you-go on). Checkout sells the plan alone, in Stripe's
  flexible billing mode: it refuses a yearly price and a monthly one in the
  same session, while a flexible-mode subscription can carry both. Turning
  pay-as-you-go on adds the monthly metered price
  (`stripe.meterPayAsYouGo`, then `withMeteredItem` in the webhook, once per
  subscription), and it stays when pay-as-you-go goes off. Until then
  Stripe's pages show the plan's price; with it, they say "Price varies with
  usage". A yearly plan's pay-as-you-go credits bill each month. A plan cancelled in
  the portal keeps working to the end of its period, and Billing says the
  date (`cancelAt`, from the subscription's `cancel_at`). Individual moves to
  Team from Billing in one click (`stripe.switchToTeam`): the same
  subscription's plan item goes to Team's price for the same billing period,
  with a seat for each person (at least three), and the webhook confirms
  it. Both changes bill the prorated difference at once
  (`proration_behavior: "always_invoice"`): on the next invoice, a yearly
  plan's could wait for its renewal. Billing says first what the switch
  charges today and bills from then on (`stripe.switchPrice`, from Stripe's
  invoice preview), and the switch is prorated at that same moment
  (`prorationMoment`), so it charges what was shown. Both are made with
  `payment_behavior: "pending_if_incomplete"`: the change applies once its
  invoice is paid (`approvalFor`). A card whose bank asks its owner to
  approve the charge (3-D Secure) sends them to Stripe's page for the
  invoice, and the change applies when it's paid; a declined card's invoice
  is voided, so nothing changes, and Billing says the card was declined. The
  webhook reads a subscription's plan from its price (`planOf`), so a change
  still waiting for its payment never shows; for a price that isn't one of
  the four (one replaced since), it reads the subscription's `plan`
  metadata, which Checkout sets and a switch sets once it's paid. A payment overdue
  (`past_due`) keeps the plan while Stripe retries, and Billing says so to
  the admins. Team to Individual goes through
  support, since the team's people would lose access. On a paid plan
  Billing shows usage and the subscription, not the plan grid.
  With `STRIPE_MANAGED_PAYMENTS=1`, Checkout sells through Stripe's Managed
  Payments: Link is the merchant of record, charges and remits sales tax
  and VAT, and statements read `LINK.COM* LIBROCAT`. It needs the account
  to accept Managed Payments' terms in the Dashboard first, and each
  product a tax code Managed Payments accepts.
  When a subscription ends, the workspace returns to Free and keeps every
  concept; new ones wait until it is under the Free limit. Only a Team
  shares a library: on any other plan its other members are paused
  (`convex/membership.ts` `pausedIn`), their memberships and roles kept, so
  the plan's return brings them back. Their agents stop with the reason, and
  their dashboard says so.
  A library has one subscription: Checkout refuses a library that has one
  (switching plans runs through support), the webhook acts on each
  subscription as Stripe has it when the event arrives (Stripe doesn't
  promise their order) and ignores one that isn't the library's own, and a
  Checkout whose payment settles later (a bank debit) records the
  subscription while the plan waits for it to turn `active`.
- The `ingest` mutation enforces the quota. Overwrites of existing concepts
  always pass.
- Every write is checked for secrets first (`assertNoSecrets` in
  `packages/core/src/format.ts`: private keys and the key formats of AWS,
  GitHub, Stripe, Anthropic, OpenAI, Slack, Google, and npm). A match is
  refused with a pointer to record where the secret lives instead.
- Self-hosting: `LIBROCAT_SELF_HOST=1` on the Convex deployment lifts every
  limit, and on the Next.js app it hides Billing and the plan bars. Without
  the flag the plan limits apply, so a hosted deployment never falls open by
  accident. `self-host/` runs the whole service with Docker Compose on a
  self-hosted Convex, with the flag set ([SELF_HOSTING.md](../SELF_HOSTING.md)).

## Your data: export, import, and delete

Settings › General has three controls (the control plane, not the editor):

- **Export** downloads the library as plain OKF zips, in parts
  (`src/lib/export-parts.ts`), since one Vercel function streams each and
  stops after about 13 minutes: the library part (the concepts, a finding
  aid, `index.md`, per directory, and the kept sources' text, with no size
  cutoff), then file parts of about a gigabyte each (the attached files, in
  `okf/_sources/files/<id>/`, with their records). Unzipped into one folder,
  the parts are the library's OKF files, to commit to Git.
- **Import** takes those zips back, all parts at once, or any OKF folder
  zipped, of any size:
  its concepts, the thesaurus's terms, the kept sources' text, and the
  attached files, into the library that's open. The browser reads the zip
  and writes each item through the functions an agent's `ingest`,
  `thesaurus`, and `add_source` use (`convex/imports.ts`), one counted write
  each, so the plan's limits and the secret check hold. A concept already
  there by the same id is overwritten, as `ingest` does.
- **Delete everything** erases every concept, link, and revision after a
  confirmation. (`delete` in the MCP weeds one concept the same way.)

The entrance is as open as the exit: Import reads an export from a
self-hosted librocat, or OKF files from Git zipped, and writes every concept
into the library that's open, so moving does not mean starting from an empty
library.

Data gravity is the moat — lock-in is not. The exit door stays open on purpose.

## Local development

The Convex project is `librocat` (managed through the Vercel marketplace). `pnpm exec convex dev` gives every logged-in developer
their own dev deployment of it and writes `NEXT_PUBLIC_CONVEX_URL` to
`apps/web/.env.local`:

```bash
cd apps/web
pnpm exec convex login                            # once per machine
pnpm exec convex dev                              # your dev deployment, keeps running
pnpm exec convex env set SITE_URL http://localhost:3000   # once per deployment
pnpm exec convex env set BETTER_AUTH_SECRET "$(openssl rand -base64 32)"
pnpm exec convex env set LIBROCAT_E2E 1                  # dev only: the e2e fixtures below
pnpm run dev                                      # dashboard + /mcp on :3000
```

Without a Convex account, `CONVEX_AGENT_MODE=anonymous pnpm exec convex dev`
runs a local Convex on :3210 instead; the rest is the same.

Signing up in the dashboard sends a verification code through Resend. With no
`AUTH_RESEND_KEY` on the deployment, set `AUTH_DEV_LOG_CODES=1`
(`pnpm exec convex env set AUTH_DEV_LOG_CODES 1`) and the code is written to
the Convex log instead (`pnpm exec convex logs`). Never set it on prod.

**Every e2e suite in one command:** `pnpm run e2e` at the repo root. It
builds a throwaway stack from a git worktree of `HEAD`, or of the ref you
pass (a pull request's branch, after `git fetch`). The stack is an anonymous
local Convex with the settings below, the fake gateway, and `next dev`. It runs
the six suites in the order below and the limits
(`tests/limits.e2e.test.ts`), then stops everything and removes the
worktree. A failing suite leaves its logs and prints where. It needs ports
3210, 3211, and 8787 free, takes the first free of 3000, 3100, 3200,
and 3300 for the site, and sees commits only. It stops only what it started. The rest of
this section is the same, by hand.

Then, with an access token signed for a fixture user (what an agent gets from
the OAuth flow, minus the browser):

```bash
LIBROCAT_MCP_TOKEN=$(pnpm exec convex run dev:issueTestAccessToken '{"plan":"individual"}' | jq -r .token) \
LIBROCAT_MCP_URL=http://localhost:3000/mcp pnpm test                              # remote MCP e2e
LIBROCAT_MCP_URL=http://localhost:3000/mcp LIBROCAT_E2E_CLI_CWD=. pnpm test         # the whole OAuth flow
LIBROCAT_E2E_CONVEX_URL=https://<your-dev>.convex.cloud pnpm test               # dashboard functions (or http://127.0.0.1:3210)
```

To exercise automatic indexation and Jev without an AI Gateway key, start
the fake gateway (`node tests/fake-gateway.ts`: `/v1/evaluate`), point the
local deployment at it (`pnpm exec convex env set AI_GATEWAY_API_KEY test`
and `pnpm exec convex env set LIBROCAT_AI_GATEWAY_URL
http://127.0.0.1:8787/v1`), and run the MCP and Libro e2e
(`tests/libro.e2e.test.ts`) with `LIBROCAT_FAKE_GATEWAY=1`. The
Libro suite needs the Convex CLI (`dev:` fixtures) to administer
the *same* deployment the test client connects to: already true for the
anonymous local backend above (`http://127.0.0.1:3210`). Pointed anywhere
else, set `LIBROCAT_E2E_CLI_CWD` to that directory. Unset the key again
before the dashboard e2e, which expects no cataloging.


Production: the Vercel project `librocat` builds `apps/web` and runs `convex
deploy` in the same build (`apps/web/vercel.json`; the marketplace resource
syncs `CONVEX_DEPLOY_KEY`), so the functions on the prod deployment
always match the site. Every push to `main`
deploys, and nothing else does: a pull request's branch gets no preview
(`git.deploymentEnabled` in `apps/web/vercel.json`), since build minutes are
most of librocat's Vercel bill and e2e runs locally (`pnpm run e2e`).
Until launch the project carries `LIBROCAT_COMING_SOON=1`: landing page
only, no sign-up (`src/lib/coming-soon.ts`).
Env: `.env.example` lists every variable, with where it is set.
