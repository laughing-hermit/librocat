---
name: knowledge-review
description: >-
  Review a librocat library with the user: work Libro's review shelf (merge
  duplicates, confirm review dates, check what's stale), weed, add the
  architecture and decision concepts a codebase lacks, and ship the library
  as a Git PR. Use when the user asks to tidy, audit, or clean up their
  library, or asks what Libro found.
---

# Reviewing a library

A first pass over a repository gives one concept per module or file, each
naming its files in `sources`. That is a floor, not the goal: the value is
the durable, higher-level concepts a person or an agent would otherwise
re-derive every session.

Part of this runs by itself: Libro, the library cat, reviews the library
every week, reads each file a person adds, and puts what it finds on the
review shelf, which the dashboard calls Needs you (`status` reports
`review_shelf`, the open count). Libro fills in a description and
tags a concept was saved without, and proposes the rest. You do the
writing, with the user deciding. For how to write a concept, follow the
**librocat-write** skill. A Reader (`status` gives `library.role`) can read
the shelf, but not `propose`, `decide`, or change a concept.

## Pass 0: the review shelf

Run `review_shelf`. For each proposal, oldest first:

- **`supersede`** (two concepts that likely say the same thing; `reason`
  says whether Libro found it): read both with `get_concept`. When `target`
  already says everything `subject` does, it is a plain supersede. When
  `subject` says something `target` lacks, `propose` a merge instead: a
  `draft` of `target` as it should read, with every fact and link from
  both, nothing invented, and tags from `thesaurus`. Keep `target`'s id, so
  links to it hold.
- **`merge`** (a draft already on the shelf): show the draft and `support`,
  Libro's probability that it says only what the two concepts say. Under 0.8,
  read both again and point out what it adds.
- **`date`** (the concept writes out a date still ahead, or Libro found it
  states a schedule, a price, a version, or an owner; `reason` says which):
  confirm the suggested review date (`target`) with the user and `decide`
  with `approve`, or pass the date they pick as `date` (YYYY-MM-DD, after
  today).
- **`stale`** (past its review date, its code changed, or a cited page
  changed in a way Libro judged affects it, or a file someone added may
  change it; `reason` says which): check it
  still holds, reading the page with `get_source` when one is named. If it
  does, `decide` with `verify`; if not, fix it with `update`, or retire it.
- **`synonym`** (two spellings of a tag, or two tags Libro judged to mean the
  same thing, such as `k8s` and `kubernetes`): check with the user that
  they are one meaning in this library. Approving files the rarer one as a
  `use_for` of the other and retags the concepts that carry it, so a search
  for either word finds both.
- **`deprecate`**: retire the concept. Ask first: retiring is the user's
  call.

Show the user what each changes, and call `decide` only on their yes, one
proposal at a time. For a merge, `propose` it with your draft first, then
`decide` on the proposal it returns. When the user isn't there, `propose`
your merges and stop: the user decides in the dashboard's Library, under Needs you. Never
decide on your own.

Then `missing`, what the library lacks (no decision needed, so no yes to
wait for):

- **A question** (`missing.questions`: asked this week, no concept answered
  it): `search` it first. If you know the answer from this project, write
  it (librocat-write); if not, tell the user. Then `search` the question
  again: once it finds something, it leaves Needs you.
- **A file** (`missing.files`: kept, no concept cites it): read it with
  `get_source`, and save what matters as concepts with its `cite` in their
  `sources`. Once one cites it, it leaves Needs you.

## Pass 1: weeding

`review_shelf` also returns `weeding`, the mechanical review (the library
CREW method): `deprecated`, `broken_links`, `orphans` (nothing links to
them), concepts without a description or tags, `stale` (past their
`stale_after`), `never_retrieved` in `days` days, and `most_retrieved`.
Stale knowledge is worse than missing knowledge: agents act on what they
retrieve. Review each concept on those lists against MUSTIE:

- **M**isleading: no longer true. Fix it, or move its `stale_after` on
  with `update` and `verify: true`.
- **U**gly: unreadable enough that nobody will fix it. Rewrite or drop.
- **S**uperseded: a newer concept replaced it.
- **T**rivial: says nothing a reader could not guess.
- **I**rrelevant: outside what this library is for.
- **E**lsewhere: restates another concept.

For each broken link, write the missing concept or fix the link with
`update`. Link an orphan from where a reader would look for it, or question
it. To retire a concept whose history matters, `update` it with
`status: "deprecated"` and `superseded_by` when something replaced it; when
it doesn't, `delete` it (its revisions go with it). Weeding is also how a
team stays under its concept quota with a better library instead of a
bigger one.

## Pass 2: duplicates Libro missed

Two concepts about one subject in different words can slip past Libro.
After a large accession, sweep a shelf: `list` with
`format: "markdown"` and its `dir`, read the titles and descriptions, and
for each pair about the same subject read both and `propose` a merge with
your draft. `decide` only on the user's yes.

## Pass 3: altitude

Add the concepts no single file states. For a code repository:

- **Architecture** (a `Note`): how the parts fit: the request path, the
  data flow, the module boundaries. Link the notes on each module as
  evidence.
- **Decisions** (`Decision`): why it is built this way, one decision each.
- **Runbooks** (a `Note`, tagged `runbook`): how to deploy, migrate, or
  debug the flaky test.

A `graph` of a central concept shows where links are thin.

## Pass 4: summaries

Open the weak concepts (`list`, then `get_concept`). Rewrite each
`description` as a standalone sentence a reader can act on, and front-load
each body. Fix tags through the thesaurus (`set_term` with `use_for`)
rather than by retagging concepts by hand.

## Pass 5: ship it

Every write is already a revision; `get_concept` with `history: true` shows
the before and after. When the team reviews knowledge like code, write the
library into their Git repository as OKF Markdown: page through it with
`list` (by `cursor`), read 20 concepts at a time with `get_concept` and
`ids`, and write each to `<id>.md`, its frontmatter as YAML between `---`
lines, then its body. (The dashboard's Export gives the same files as a
zip.) Commit them on a branch and open a PR, so reviewers see exactly what
changed.

Write through the MCP, not the dashboard: the dashboard is for seeing and
deciding.
