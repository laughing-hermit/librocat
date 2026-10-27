import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * A day, one way everywhere: "Oct 20, 2026". In UTC, so a server render and
 * a date-only value ("2027-01-01") read the same for everyone.
 */
export function formatDate(at: number | string): string {
  const ms = typeof at === "number" ? at : Date.parse(at);
  if (!Number.isFinite(ms)) return String(at);
  return new Date(ms).toLocaleDateString("en-US", { dateStyle: "medium", timeZone: "UTC" });
}

/** "Oct 22", or "Oct 22, 2025" outside this year: for a list's one-line dates. */
export function shortDate(at: number | string): string {
  const ms = typeof at === "number" ? at : Date.parse(at);
  if (!Number.isFinite(ms)) return String(at);
  const d = new Date(ms);
  const sameYear = d.getUTCFullYear() === new Date().getUTCFullYear();
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
    timeZone: "UTC",
  });
}

/** "0 KB", "820 KB", "12 MB", "1.5 GB": decimal units, a decimal only below 10. */
export function formatBytes(n: number): string {
  const units = [
    ["GB", 1e9],
    ["MB", 1e6],
  ] as const;
  for (const [unit, size] of units) {
    if (n >= size) {
      const x = n / size;
      return `${x >= 10 ? Math.round(x) : Number(x.toFixed(1))} ${unit}`;
    }
  }
  return `${Math.ceil(n / 1e3)} KB`;
}

/** Every link, one look: library green, underlined. Green underlined text takes you somewhere. */
export const link = "font-medium text-primary underline underline-offset-4 hover:text-primary/80";

/**
 * A file librocat may still be reading: one in "processing" attached in the
 * last 10 minutes, the longest a read runs. Its page refreshes while it is
 * (refresh-while.tsx); an older one won't finish by waiting.
 */
export const stillReading = (s: { status?: string; updated_at: number }) =>
  s.status === "processing" && Date.now() - s.updated_at < 10 * 60_000;

/** A message as a sentence: Convex's errors start lowercase so they read inside others. */
export const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
