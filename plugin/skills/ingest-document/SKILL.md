---
name: ingest-document
description: >-
  Attach a source to librocat (a PDF, a document, a spreadsheet, slides, a
  picture, a web page, a video or podcast's transcript) or read a code
  repository, then turn it into concepts that cite it. Use when the user
  points at a file, a URL, or a repo ("attach this", "read this doc / page /
  video and keep what matters", "catalog this repo"), and for files people
  attached on the dashboard that no concept cites yet.
---

# Attach, then catalog

First attach the source: librocat keeps the original and reads its text
where code can, so any agent finds it by its words and its title at once,
even before anyone writes about it. Then catalog it: read it and write what
matters as concepts that cite it. The rules for those concepts (what
belongs, one concept per idea, the types, the catalog record, acting on
`possible_duplicates`) are the **librocat-write** skill's; follow it.

librocat keeps text and pictures only. For a recording, keep its
transcript as text, never the audio or video file.

## Attach the source

- **A file, with a shell:** `add_source` with `file` (name, type, size in
  bytes). POST the bytes to the `upload_url` it returns
  (`curl -X POST -H 'Content-Type: <type>' --data-binary @<file> '<upload_url>'`
  answers `{"storageId": …}`), then `add_source` with that `storage_id`,
  the file's name, and a title. librocat reads PDFs and Office files itself.
- **A file, without a shell** (some desktop agents can't send the bytes):
  ask the person to attach it on the dashboard (the Library's Attach files), then find it
  with `get_source` (no arguments: files no concept cites come first). Or
  keep the text you read with `add_source`, `title` and `text`.
- **A web page:** `add_source` with its text, its title, and its URL as
  `location`. A PDF, an Office file, or a picture at a URL: on paid plans, `add_source`
  with only the URL as `location` keeps the file itself; otherwise
  download it and upload it as a file. A site that doesn't let apps read
  it (LinkedIn, X): read the page yourself if you can, and keep its text
  with the URL as `location`.
- **Text you already have** (a pasted note, a transcript): `add_source`
  with the title, the text, and the `location`.
- **A picture or a scan** has no words to find: give it a title that says
  what it shows.
- **"Save this for later"** (paid plans): `add_source` with only the URL as
  `location` keeps the page on the reading list, unread until a concept
  cites it.
- A file reads `status: processing`, then `ready` within a minute;
  `get_source` shows what librocat read. Adding the same file or text again
  returns the kept copy; new text for a kept URL replaces it, and the
  concepts citing it come up for review.
- Skip this for code in a repository (the repository is the source) and
  for anything the user doesn't want kept.

## Reading each kind of source

- **Documents** (PDF, Word, a spreadsheet, slides, Markdown, meeting notes,
  a spec): note the title, author, date, and path or URL.
- **Web pages**: read the article, not the navigation, ads, or comments.
  Keep the canonical URL (no tracking parameters) and the page's date.
- **Videos and podcasts**: work from a transcript (the page's captions, the
  show notes, or one the user gives you), never from a title alone. If none
  is within reach, say so and ask for one. Cite timestamps (`12:34`), and
  link to the moment where the platform allows it (YouTube's `&t=754s`).
- **Code repositories**: one `Note` per module or
  component, with `sources` naming its files, and the decisions and
  runbooks the files don't state. A repository's own docs (README, `docs/`,
  ADRs) are documents. After a commit, `files_changed` brings the concepts
  that cite the changed files up for review.

Read only what the user can already read: never work around a paywall or a
sign-in.

## Procedure

1. Attach the source (above) and note its title, author, date, location,
   and the returned `cite`.
2. List the candidate concepts (idea, type, one-line description). Show the
   list to the user if there are more than ten, and let them cut.
3. `search` each one's key terms: new concept, `update`, or skip. Then
   look for what the source contradicts: `search` each fact it states that
   can go stale (a price, a version, an owner, a date, a limit, a step),
   and `update` the concepts it changes, citing it, or `propose` the change
   when the person should decide.
4. `ingest` them in one call with `concepts: [...]`. Each gets the full
   catalog record, the `cite` in `sources`, and a body in your own words
   that ends with a `## Source` section: title, author or channel, date,
   URL or path, and the timestamps it draws on. Quote only the short lines
   that must be exact (numbers, names, commands, contract terms).
5. Act on any `possible_duplicates` (librocat-write).
6. Report how many concepts you wrote, their ids, the `cite`, and what you
   left out.

When a question later needs the exact wording, `get_source` with the
concept's `sources` entry and a `query` returns the passages.
