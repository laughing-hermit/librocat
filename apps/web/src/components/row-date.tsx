import { shortDate } from "@/lib/utils";

/**
 * A row's date on a sorted list, one way everywhere: a word and a short date
 * ("Updated Oct 23"), quiet beside the title, so the order explains itself.
 */
export function RowDate({ label, at }: { label: string; at: number }) {
  return (
    <span className="text-xs font-normal text-muted-foreground">
      {label} {shortDate(at)}
    </span>
  );
}
