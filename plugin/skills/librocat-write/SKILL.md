---
name: librocat-write
description: >-
  How to write to a librocat library: what belongs and what doesn't, one
  concept per idea, the concept types, and a complete catalog record (title,
  description, tags from the thesaurus, sources, review date). Use whenever
  the user says "remember this", "save this", "note that", "put this in
  librocat", or asks to capture a decision, a runbook, a fact, or how some
  code works; and before any `ingest` or `update`.
---

# Writing to librocat

librocat stores knowledge as OKF concepts: Markdown with YAML frontmatter.
A concept is a catalog record (type, title, description, tags, sources)
plus a body. The record is what makes it findable later, by every agent
that reads this library, so never skip it. Write for two readers at once:
a person skimming and an agent retrieving.

## What belongs

Write a concept when it is **durable, decision-bearing, and not cheap to
re-derive**:

- a decision and why: the trade-offs, the option chosen, what it rules out;
- how to do a recurring task: deploy, migrate, rotate a key, debug the
  known flaky thing;
- a fact a newcomer or a fresh agent would otherwise ask: names, limits,
  conventions, who owns what;
- how the system fits together, which no single file states;
- instructions agents must follow every session (a `Note` tagged
  `instructions`).

Do **not** write: whole files, pages, or transcripts (summarize and cite
them; to keep the original, `add_source`, or the ingest-document skill),
what the code already says line for line, small talk, secrets or
credentials, or a second concept about a subject the library already has.
Ask before storing personal data or anything the user may not want shared.

## Before you write

1. `search` for the subject in the words a concept about it would use: your
   project's shelf first (`shelf`), then the whole library. If a concept
   already covers it, `update` that one.
2. `status` for the live vocabulary (`by_type`, `by_tag`), and `thesaurus`
   for the preferred tags and their scope notes. If its `library.role` is
   `reader`, the person can read this library but not change it: don't
   write; tell them one of its admins can make them an Editor.

## One concept, one idea

- If a title needs "and", split it. A long document is its decisions,
  facts, and procedures, typically 3 to 15 concepts, not one per page.
- Put the answer in the first paragraph; details follow. A reader stops as
  soon as they have enough.
- A body holds at most 16 KB (16,000 bytes, about 2,500 words) on
  librocat.com, and 64 KB on a self-hosted librocat. Long before that, split it
  into concepts and link them.
- Link related concepts with Markdown links to `.md` targets:
  `[the index layer](/architecture/index.md)` from the bundle root, or
  `./sibling.md`. Those links are the graph (`get_concept`'s `links`,
  `graph`); prose mentions are not.

## Types

Two types, so a person sees at a glance what a concept is:

| Type | For |
|------|-----|
| `Decision` | What was chosen and why: context, decision, consequences |
| `Note` | Everything else: how something works, steps for a recurring task, facts to look up, a module of a repository, agent instructions (tagged `instructions`) |

librocat files any other type as a `Note`. Say what kind of note it is in
the title and tags instead (`Deploying the site`, tag `runbook`). A concept
that cites a file shows it; there's no separate type for that.

## The catalog record

- **`id`**: a path without `.md`, grouped by directory
  (`decisions/use-postgres`). **One library, many shelves:** put a
  project's concepts under one leading directory, its shelf (`acme/…`).
  Make a shelf for a project, never a separate library; separate libraries
  only when access must differ.
- **`title`**: the claim, not the topic. Weak: "Auth". Good: "Sessions
  expire after 30 days".
- **`description`**: one standalone sentence a reader can act on without
  opening the body; it is what `search` and `list` show first. Weak:
  "Notes about the parser". Good: "The parser reads frontmatter in one pass
  and never rejects unknown keys."
- **`tags`**: 2 to 4, from the thesaurus. Reuse a preferred tag; read its
  scope note; file under the most specific tag that fits (`oauth`, not
  `oauth` and `auth`). Writes map a `use_for` synonym onto its preferred
  tag. For a new synonym, `set_term` it as `use_for` on the preferred tag
  instead of coining a tag; give a new tag a `scope_note`.
- **`sources`**: what the concept describes or came from: repository paths
  (`src/auth/login.ts`, or `src/auth/` for a directory), links, or a kept
  source's `cite`. Then `files_changed` after a commit brings the concept
  up for review when its code moves, instead of letting it go quietly wrong.
  Always include the `cite` of every kept source you drew on: the
  dashboard's Library shows a file's concepts by it, and nothing else ties
  a concept to its file.
- **`stale_after`**: an ISO date, on anything time-bound (a plan, a price,
  a version, an owner, a deadline), so the library asks later whether it
  still holds. When you check one and it does, `update` it with
  `verify: true`.
- **`status`**: `draft` while you write, `stable` (the default) when it
  holds, `deprecated` when it no longer does, with `superseded_by` naming
  its replacement.

A record left without a description or tags is filled in by Libro, the
library's cataloger; one you write yourself is better.

## Writing

- `ingest` with the full record and the body; several at once with
  `concepts: [...]` (up to 100, a result per item).
- **`possible_duplicates`**: a new concept may come back with up to 3
  concepts that share its words. Read them. If one is about the same
  subject, `update` that concept with what's new and `delete` the one you
  just wrote, or `propose` a merge when the person should decide. Two
  concepts about one subject split every later search.
- `update` with only the fields that change; `new_id` moves a concept and
  rewrites every link to it.
- After you commit code, call `files_changed` with the paths the commit
  touched (`git diff-tree --no-commit-id --name-only -r HEAD`) and your
  `shelf`, then `update` what the change made wrong, or `verify` what still
  holds.
- Tell the user what you saved: each id and title.

## For plugin authors

A plugin that saves to librocat saves what this skill says belongs, and
nothing else, and tells the user what it saved.
