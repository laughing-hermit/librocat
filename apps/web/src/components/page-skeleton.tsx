import { ChevronRight } from "lucide-react";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import { Skeleton } from "@/components/ui/skeleton";
import { TableCell, TableRow } from "@/components/ui/table";

/*
 * Loading states are built from the same components as the pages, with the
 * same static words (titles, labels, column names), and a gray bar only
 * where the data will be. A bar sits inline in the real type, so every line
 * keeps the height it will have, and nothing moves when the page arrives.
 */

/** Stable keys for rows of placeholders (they never reorder). */
export const ROWS = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"];

/** The wrapper every loading state shares: announced, and busy. */
export function Loading({ children }: { children: React.ReactNode }) {
  return (
    <div role="status" aria-busy="true" aria-label="Loading" className="flex flex-col">
      {children}
    </div>
  );
}

/**
 * PageHeader's shape (its classes) for a page whose title or line is data
 * (a source; who you are): the same type sizes on divs, since a bar can't
 * sit inside an <h1> or <p>. A `title` that's always the same is its words.
 */
export function HeaderSkeleton({
  title,
  children,
}: {
  title?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 pb-6">
      <div className="min-w-0 space-y-1">
        <div className="text-2xl font-semibold tracking-tight">
          {title ?? <Skeleton className="inline-block h-6 w-72 max-w-full align-middle" />}
        </div>
        <div className="text-muted-foreground">
          <Skeleton className="inline-block h-4 w-96 max-w-full align-middle" />
        </div>
      </div>
      {children && <div className="flex shrink-0 flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}

/** An empty state: the real Empty, its icon square blank, a bar for each line. */
export function EmptySkeleton() {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon" />
        <EmptyTitle>
          <Skeleton className="inline-block h-3.5 w-20 align-middle" />
        </EmptyTitle>
        <EmptyDescription>
          <Skeleton className="inline-block h-3.5 w-48 align-middle" />
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

/** A plan meter: its label line, then the track (Progress's layout). */
export function MeterSkeleton() {
  return (
    <div className="flex flex-col gap-3">
      <div className="text-sm">
        <Skeleton className="inline-block h-3.5 w-full align-middle" />
      </div>
      <Skeleton className="h-1 w-full rounded-full" />
    </div>
  );
}

/** A copy field or input group (InputGroup's height and corners). */
export function FieldSkeleton() {
  return <Skeleton className="h-8 w-full rounded-lg" />;
}

/** A small button. */
export function ButtonSkeleton() {
  return <Skeleton className="h-7 w-20 rounded-lg" />;
}

/**
 * An outline item: an icon (unless `media` is off), a title, a line under
 * it, and a button. A title or line that's always the same is its words.
 */
export function ItemSkeleton({
  action = true,
  media = true,
  title,
  description,
}: {
  action?: boolean;
  media?: boolean;
  title?: string;
  description?: string;
}) {
  return (
    <Item variant="outline" size="sm">
      {media && (
        <ItemMedia variant="icon">
          <Skeleton className="size-4 rounded-full" />
        </ItemMedia>
      )}
      <ItemContent>
        <ItemTitle>
          {title ?? <Skeleton className="inline-block h-3.5 w-40 align-middle" />}
        </ItemTitle>
        {description ? (
          <ItemDescription>{description}</ItemDescription>
        ) : (
          // ItemDescription's type on a div: a bar can't sit inside its <p>.
          <div className="text-sm leading-normal">
            <Skeleton className="inline-block h-3.5 w-72 max-w-full align-middle" />
          </div>
        )}
      </ItemContent>
      {action && (
        <ItemActions>
          <ButtonSkeleton />
        </ItemActions>
      )}
    </Item>
  );
}

/**
 * A row of the Library's lists (concept-row.tsx's box, and Needs you's and
 * Files' alike): a title with a badge, a line under it, and its chevron.
 */
export function ListRowSkeleton() {
  return (
    <div className="rounded-lg border">
      <Item size="sm">
        <ItemContent className="min-w-0">
          <ItemTitle className="max-w-full">
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <Skeleton className="inline-block h-3.5 w-48 max-w-full align-middle" />
              <Skeleton className="h-5 w-16 rounded-full" />
            </span>
          </ItemTitle>
          {/* One line, as the row's description is; two on a phone, where it wraps. */}
          <div className="text-sm leading-normal">
            <Skeleton className="inline-block h-3.5 w-96 max-w-full align-middle" />
          </div>
          <div className="text-sm leading-normal sm:hidden">
            <Skeleton className="inline-block h-3.5 w-40 align-middle" />
          </div>
        </ItemContent>
        <ItemActions>
          <ChevronRight />
        </ItemActions>
      </Item>
    </div>
  );
}

/** Where an extra column shows: always, from sm, md, or lg (as the page's table does). */
type Shown = "always" | "sm" | "md" | "lg";

function CellSkeleton({ shown }: { shown: Shown }) {
  const bar = <Skeleton className="inline-block h-3.5 w-16 align-middle" />;
  if (shown === "sm") return <TableCell className="hidden sm:table-cell">{bar}</TableCell>;
  if (shown === "md") return <TableCell className="hidden md:table-cell">{bar}</TableCell>;
  if (shown === "lg") return <TableCell className="hidden lg:table-cell">{bar}</TableCell>;
  return <TableCell>{bar}</TableCell>;
}

/** A table row whose first cell has a title and a line under it, like a concept or a source. */
export function RowSkeleton({ extra }: { extra: Shown[] }) {
  return (
    <TableRow>
      <TableCell>
        <div>
          <Skeleton className="inline-block h-3.5 w-48 align-middle" />
        </div>
        <div>
          <Skeleton className="inline-block h-3.5 w-28 align-middle" />
        </div>
      </TableCell>
      {extra.map((shown, i) => (
        <CellSkeleton key={ROWS[i]} shown={shown} />
      ))}
    </TableRow>
  );
}
