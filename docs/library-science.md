# Library science in librocat

librocat is a managed knowledge base for AI agents, kept by Libro, an AI
librarian. The library is an LLM wiki (the pattern in Karpathy's gist:
agents ingest, query, and lint a wiki an LLM maintains) stored as Google's
Open Knowledge Format, and it is run the way a library is run: cataloged,
classified, cross-referenced, and weeded. Your agents write, read, and
search; Libro checks the whole library, with library rules and one model
(Jev): it fills in a description and tags an agent left out, and proposes
everything else for a person to approve. This page checks the library-science half of that claim
against two classic public-domain texts of library and information science
(LIS), and records what they validated, what they changed, and what they put
on the roadmap.

- **John Cotton Dana, _A Library Primer_** (Library Bureau; Project
  Gutenberg #15327). The standard how-to for founding and running a library,
  by a president of the American Library Association. Chapters used:
  General policy (IV), Selecting books (XI), Reference work (XIII),
  Accessioning (XIX), Classifying (XX–XXIII), Shelf list (XXIV),
  Cataloging (XXV), and Checking the library (XXX).
- **Charles A. Cutter, _Rules for a Dictionary Catalogue_** (4th ed., 1904;
  Project Gutenberg #59215). The foundation of subject cataloging. Its
  "objects" of the catalog and its rule of specific entry are still taught.

Both texts are about books on shelves. The mapping below treats a concept as
the book, a tag as the subject heading, the thesaurus as the list of
headings, a shelf (the leading directory of an id) as the class, and the id
as the call number.

## Cutter's objects of the catalog

Cutter says a catalog exists to do three things. Here is how librocat does
each.

| Object (Cutter) | In librocat | Verdict |
| --- | --- | --- |
| Find a book whose **title** or **subject** is known | `search` (title, description, body, tags), expanded through the thesaurus; `get_concept` by id | Met |
| Find a book whose **author** is known | `search`/`list` with `author`: a person (a member's email), `me`, or an agent by name; `get_concept` lists a concept's `authors` | Met (2026-09-26) |
| Show what the library has **on a subject** | `list`/`search` with `tag`, which now includes the tag's narrower terms; `thesaurus` shows the headings | Met, improved here |
| Show what the library has **in a kind** of literature | `list`/`search` with `type` (Note or Decision) and `shelf`; finding aids per directory | Met |
| Help **choose** between books (edition, character) | The one-line `description`, `status` (draft, stable, deprecated), `superseded_by`, revisions, and now `cataloged` (how the record was made) | Met, improved here |

## Validated: what librocat already does the way the books say

- **Controlled vocabulary.** Dana warns that «Domestic animals», «Farm
  animals», and «Animals, domestic» for one subject "scatter the
  references". His cure is a printed list of headings, checked every time.
  librocat's thesaurus, the synonym folding on write (`use_for`), and Libro's
  "merge tag" proposals are that cure, applied automatically.
- **Cross-references.** Dana's cross-reference cards send a reader from
  "pigs" to "swine" (see) and on to "domestic animals" (see also). librocat
  has `use_for` for the first and `broader`/`narrower` for the second.
- **Classify for the reader.** Dana: when unsure, file a book where its
  readers will look for it. Jev's tag question asks exactly that: should the
  concept be filed under the tag "so that someone browsing that tag finds
  it"?
- **The shelf list and the call number.** Dana's shelf list, a catalog in
  shelf order, is librocat's finding aid (`list` with `format: "markdown"`,
  `index.md` per directory). His call number is the concept id: it says where the concept
  stands and tells it apart from its neighbors.
- **Accessioning.** Dana calls the accession book "a life history of every
  book". librocat keeps one: every write is a revision with who, when, and
  which agent.
- **Use is the test.** Dana: "no useless lumber is more useless than unused
  books." The library counts retrievals (circulation), and
  the weeding report on `review_shelf` lists what nobody reads.
- **Inventory.** Dana's periodic check of the library for what is missing or
  out of place is `status` (link health) and `review_shelf`'s weeding
  report (broken links, orphans).
- **Selection fits the users.** Dana's chapter on choosing books is the
  librocat-write skill: what belongs in this library, and for whom.

## Improved in this change

1. **Scope notes** (ANSI/NISO Z39.19 "SN"). Dana says the list of headings
   must be "marked and annotated to fit your special needs". A thesaurus
   term now carries a `scope_note`: what the tag covers, and what belongs
   elsewhere. Cataloging reads it when it chooses tags.
2. **Related terms** (Z39.19 "RT"). Cutter's syndetic catalog also refers
   to "illustrative and coördinate subjects", the "see also" that is neither
   broader nor narrower. A term now has `related`.
3. **A tag filter includes narrower terms.** Cutter's references run from a
   subject down to the subjects under it. `list` and `search` with a `tag`
   now include every narrower term (at any depth), so asking for «auth»
   finds what is filed under «oauth». One function does it
   (`tagFacet`).
4. **Specific entry** (Cutter, rule 93: "Enter a work under its
   subject-heading, not under the heading of a class which includes that
   subject"). Cataloging drops a broader tag when a narrower one
   applies (`specificEntry`).
5. **Check the shelf list before choosing a heading.** Dana: before placing
   a book in a class, "examine your shelf-list and see that the books
   already there are of like nature with it". Jev's tag questions now carry,
   for each candidate tag, its scope note and titles already filed under
   it.
6. **Transcribe; bracket what you supply.** Cutter asks that the title be
   "copied ... exactly" and that information the cataloger supplies be
   marked (in brackets). The agent writes the description; when it leaves
   one blank, librocat's is a sentence transcribed from the concept,
   selected by Jev, never written. The concept records how, in `cataloged`
   (`description: transcribed`, `tags: selected`, `by`, `at`). The entry
   goes as soon as a writer changes the field.
7. **Merge drafts are checked.** The person's agent drafts a merge (Libro
   only proposes one), so Jev checks it against its two sources and the
   review shelf shows the result. A draft that invents is flagged before anyone
   approves it.
8. **Review dates, and a loop that keeps the library current.** OKF's
   `stale_after` marks when a concept should be checked again, and agents
   can now set it on `ingest` and `update`. Every search hit says `stale:
   true` once the date passes, the weeding report lists it (MUSTIE's
   "misleading", made mechanical), and Libro puts it on the review shelf.
   **Still true** records who checked it (OKF `verified`) and moves the date
   a cycle ahead; **Retire** deprecates it. Agents can verify too (`update`
   with `verify: true`).

## How the cataloging pipeline avoids hallucination

Automatic cataloging (`apps/web/convex/indexation.ts`) is built so a
catalog record cannot say something the concept does not:

1. **Select, never generate.** Code gathers candidates (the concept's own
   sentences, the library's own tags). Jev, a small judgment model, picks
   among them. Selection cannot invent a fact, and it is cheap ($0.042 per
   million input tokens, output free).
2. **Leave the rest to the writer.** What selection can't fill stays blank
   for the agent, which writes with the model it already uses (the
   librocat-write skill asks it to write a complete record).
3. **Never overwrite a writer**, and **record provenance** (`cataloged`), so
   a reader can tell what the cataloger supplied.
4. **A person decides on the shelf.** Libro proposes; nothing on the review
   shelf changes until someone approves it, and every approval is a
   revision.

## Libro's job: keep the library current, and say what it shows

Libro, the library cat, is the librarian of a managed library, and its first
duty is the one Dana gives the whole profession: a library is only as good
as its use, and stale books are "useless lumber". Libro's work, in the order
it happens:

1. **Catalog on arrival.** Every concept gets a record (description, tags),
   selected from its own words and the library's vocabulary.
2. **Keep it current.** Flag what may be outdated: past its review date,
   never read, superseded but still marked stable, duplicated. Propose; a
   person decides, and the decision is recorded.
3. **Keep it consistent.** Fold synonyms, fix links on renames, find
   duplicates for the person's agent to merge, and check every merge draft
   against its sources. Synonyms come two ways: the review folds spellings
   of one tag (`api-key`, `api keys`), and, since 2026-10-21, Jev reads the
   tag pairs that concepts carry together or that share a stem (`k8s` and
   `kubernetes`), each with a few titles of the concepts that carry it, and
   Libro proposes a fold for those it judges one meaning. Approved, the
   rarer tag becomes a `use_for` of the other (Dana's "see" card), and a
   search for either finds both.
4. **Report.** Tell the team what the library shows: what arrived, what is
   stale, what agents read most, and what they asked for and did not find.

Libro cannot see the world change, so staleness needs signals. Today:
review dates (`stale_after`), circulation, supersession, duplicates, and,
since 2026-09-26, time-bound claims: after each review, Jev reads what was
written or changed since it last looked, and for anything tied to a date,
a version, a price, or a person, Libro suggests a review date on the shelf.
Since 2026-10-21 the date comes from rules, not from Jev's guess at a
horizon: a date the concept writes out that hasn't come yet (2026-11-01,
October 15, 2026, Q4 2026) is read by code, and the review is the day after
it. Otherwise Jev answers four yes/no questions, which it gets right far
more often than a choice among overlapping horizons: does it state a
deadline or plan (30 days), a price, quota, or plan limit (90), a software
version (90), or a person who owns or approves something (182)? The
soonest kind Jev is 80% sure of sets the date; none, no date. A concept
about to be replaced or retired (an open supersede, merge, or deprecate) gets
none. A person sets the date, picks another, or dismisses it.
And, also since 2026-09-26, the code itself: a concept names the files it
describes (OKF `sources`), and when a commit touches one, `files_changed` sets
its review date to now and Libro puts it on the shelf with the file and
the commit. A kept web page a concept cites is fetched again each week on
paid plans (the source watch), and since 2026-10-21 a change no longer puts
every citing concept on the shelf: Jev reads what changed against each
one's catalog record, and only those it judges affected come up, with the
page named. When Jev can't be asked, they all come up, as before. The questions agents asked and found no answer to are a signal
too, of what's missing rather than what's stale: Libro's report lists them
(the ready-reference file, below).

## What Libro's model does, and what the agent does (2026-10-21)

A librarian's assistant takes the routine checks, and the librarian keeps
the judgment that needs the whole conversation. librocat divides the work
the same way. Jev, Libro's one model, takes work that runs unattended (the
review, crons, the source watch), that is a bounded judgment (a
probability or a choice among named options, never new text), and that is
capped per run or metered. The person's own agent does the writing, the
reading of files, the reasoning in several steps, the talking with the
person, and the judgments made at write time, such as whether a new
concept repeats one of its `possible_duplicates`, at no cost to librocat.
So there is no Jev call per search or per write.

## The ready-reference file, and Libro's report (built 2026-09-25)

Dana, ch. XIII: "Many questions come up again and again. Of these, and of
the references which answered them, notes should be kept." librocat keeps
that file (`convex/reference.ts`):

- Every question an agent asks the library (a `search`) is filed, with what
  it found and the concept the agent opened next: its answer.
- Asked again, the question gets its answer first (`ready_reference`).
- A question with the same content words, in any order, is the same
  question ("rotate the Stripe keys", "Stripe key: rotate"), so it gets the
  same answer. No model groups questions or judges them.
- A question that found nothing marks a gap in the collection, the
  librarian's cue for what to write down next.

Libro reports what the file and the library show by email
(`convex/report.ts`), every Monday on paid plans and on the month's first
Monday on Free, and the Library's Needs you shows what needs a decision:
the library's annual report, a week at a time.

## Accession numbers are never reused (built 2026-09-26)

Dana, ch. XIX: an accession number, once given, is never given again. A
deleted concept's id could otherwise be taken by a new concept with a
different meaning, and links or agents that remembered the old one would
reach the new one. So a deleted id, and the old id of a renamed concept,
are retired: a derived id never takes one again, reading one says what
became of it (deleted on a date, or renamed to what), and an explicit id
that takes one says so. librocat keeps them per library, and the export
writes them as the bundle's `log.md`, OKF's update log.

## Lists of additions (built 2026-09-27)

Dana, ch. XXV: "Print lists of additions." The root finding aid, the
library's front page (`index.md`), opens with what arrived in the last seven
days, newest first, from each concept's creation. Agents read it with
`list` in Markdown, and the export carries it.

## Search by words: the catalog and the controlled vocabulary do the job (2026-10-20)

A library's answer to a reader who uses other words is not a similarity
score. It is vocabulary control: Dana's list of headings, checked every
time, and his cross-reference cards from "pigs" to "swine"; Cutter's
catalog, which finds a book by its title or its subject. librocat's search
works the same way, with the person's agent as the reader at the catalog:

1. **The catalog record comes first.** Every concept has a title, a
   one-line description, and tags from the library's vocabulary, written by
   the agent or selected by Jev. `search` counts a match there twice, so a
   concept cataloged under the words outranks one that only mentions them
   (Cutter's first object: find a book whose title or subject is known).
2. **The thesaurus expands the question.** A synonym brings its preferred
   tag (`use_for`, Dana's "see"), and a preferred tag its narrower terms
   (Z39.19's NT, Cutter's references down to the subjects under a subject).
   Agents that take their tags from `thesaurus` (the librocat-write skill)
   keep the library and its readers on one vocabulary.
3. **Words are stemmed** (the Porter stemmer): "rotated keys" finds "key
   rotation".
4. **The reader tries again.** An agent writes keyword searches, reads the
   hits and their snippets, and searches again with other words when the
   first ones miss, the way a reader at the card catalog tries another
   heading. That is how an LLM wiki is read: the agent drives the search.
5. **Sources are found by their record too.** A kept source is found by its
   words and its title. A picture or a scanned PDF has no words, so its
   title and the concepts written about it, which cite it, are its record:
   the cataloger's job, again.

**What it replaced.** From 2026-09-25 to 2026-10-20, librocat used
embeddings (Gemini Embedding) to propose candidates for Jev to judge:
search by meaning, rewordings of one question in the ready-reference file,
Libro's duplicates by meaning (the same thing under other titles and tags),
and the concepts behind a question that found no answer. Now:
- a question is grouped with others by its content words, so the same words
  in another order are one question;
- duplicates are found three ways, with no embedding model:
  - the mechanical pass: two live concepts with the same title;
  - Jev's pair screen, after each review: pairs on one shelf that share
    tags or most of a title, and each concept written since the last review
    with its 5 nearest by words on any shelf (the catalog index, stemmed
    and through the thesaurus). Jev confirms which are one subject;
  - the agent that writes: `ingest` returns a new concept's
    `possible_duplicates`, the 3 nearest by the same words, and the agent
    judges them, updating the existing concept or proposing a merge (the
    librocat-write and ingest-document skills). Agents also `search`
    before they write, and the knowledge-review skill sweeps a shelf's
    finding aid for the same subject in different words;
- the questions that found nothing stay in Libro's report, as what to write
  down next.

**What words alone cost, measured on 2026-09-28.** Gemini 3.8 Flash played
the agent over librocat's own docs (137 concepts, 69 questions), writing
its own searches with up to two retries. Before stemming, words alone found
the right concept in the top three 93% of the time, against 95% with
meaning. Once stemming and the catalog record's weight shipped, the agent's
first search put the right concept first 75% of the time by words alone,
against 84% with meaning. A duplicate rewritten under another title and
other tags is the hard case: words found 8 of 14, meaning 13 (that count
predates the word-index neighbors above). In return,
there is no embedding model to run, pay for, or calibrate, no vectors to
keep for concepts, questions, and file parts, and no query sent to a second
provider; and a self-hosted librocat searches the same way with no model at
all.
