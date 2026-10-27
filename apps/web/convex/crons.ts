import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Libro's weekly round: Monday morning UTC, minute left to Convex to spread.
crons.weekly(
  "Libro reviews every library",
  { dayOfWeek: "monday", hourUTC: 7 },
  internal.libro.reviewAll,
  {},
);

// An hour later, Libro's report goes to whoever keeps each library (report.ts).
crons.weekly(
  "Libro sends the weekly report",
  { dayOfWeek: "monday", hourUTC: 8 },
  internal.report.reportAll,
  {},
);

// The owner's funnel, an hour after Libro's report: how far last week's
// sign-ups got (funnel.ts). Sent only when LIBROCAT_FUNNEL_EMAIL is set.
crons.weekly(
  "The owner gets the weekly funnel",
  { dayOfWeek: "monday", hourUTC: 9 },
  internal.funnel.send,
);

// The ready-reference file keeps questions 90 days (reference.ts).
crons.daily(
  "The ready-reference file forgets old questions",
  { hourUTC: 3, minuteUTC: 0 },
  internal.reference.prune,
);

// Files Libro was reading when the month's file credits ran out go on
// (convex/fileCatalog.ts); one whose credits haven't renewed waits again.
crons.daily(
  "Libro goes on reading the files that waited for credits",
  { hourUTC: 4, minuteUTC: 0 },
  internal.fileCatalog.resumeWaiting,
  {},
);

// Concepts Libro couldn't catalog (Jev unreachable, or no credit left) go
// again, as far as each library's credits reach (convex/indexation.ts).
crons.daily(
  "Libro catalogs the concepts that waited",
  { hourUTC: 4, minuteUTC: 30 },
  internal.indexation.resumeWaiting,
  {},
);

// Stored files no source holds (an upload never attached) go after a day
// (convex/sources.ts pruneUnattached).
crons.daily(
  "Stored files nothing holds are deleted",
  { hourUTC: 5, minuteUTC: 0 },
  internal.sources.pruneUnattached,
  {},
);

// Better Auth's expired sessions, codes, and tokens (convex/authCleanup.ts).
crons.daily(
  "Sign-in rows nobody needs are deleted",
  { hourUTC: 5, minuteUTC: 30 },
  internal.authCleanup.prune,
  {},
);

export default crons;
