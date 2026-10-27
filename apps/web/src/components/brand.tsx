import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * The mark: Libro, the library cat, as a die-cut sticker (a green rounded
 * square with a paper border and hairline). One kitten, two
 * crops in `public/`: `logo.svg` is the line mark (the kitten on the book,
 * for the hero) and `logo-head.svg` is the head mark: the head as a plain
 * green silhouette on a paper rounded square, the same file as the favicon,
 * so the tab and the header show one icon (the 28 px lockups). Both carry
 * their own colors.
 */
export function LogoMark({
  className,
  line = false,
  alt = "",
}: {
  className?: string;
  /** The full kitten-on-a-book drawing (above 32 px); the head mark otherwise. */
  line?: boolean;
  alt?: string;
}) {
  return (
    // biome-ignore lint/performance/noImgElement: a static SVG; next/image would not optimize it
    <img
      src={line ? "/logo.svg" : "/logo-head.svg"}
      alt={alt}
      width={28}
      height={28}
      className={cn("inline-block size-7 shrink-0", className)}
    />
  );
}

export function Brand({ className }: { className?: string }) {
  return (
    <Link
      href="/"
      className={cn(
        "inline-flex items-center gap-2.5 font-mono text-2xl font-semibold tracking-tight lowercase",
        className,
      )}
    >
      <LogoMark />
      <span>
        libro<span className="text-brand">cat</span>
      </span>
    </Link>
  );
}
