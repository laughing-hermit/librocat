import {
  ButtonSkeleton,
  HeaderSkeleton,
  ItemSkeleton,
  Loading,
  ROWS,
} from "@/components/page-skeleton";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

// A source while it loads, as its page lays it out: its title and line with
// its buttons (Download, Delete), the card its text arrives in, and under it
// the concepts drawn from it, with a row for them (or the prompt).
export default function SourceLoading() {
  return (
    <Loading>
      <HeaderSkeleton>
        <ButtonSkeleton />
        <ButtonSkeleton />
      </HeaderSkeleton>
      <div className="flex flex-col gap-6">
        <Card>
          <CardContent className="flex flex-col gap-2">
            {ROWS.slice(0, 5).map((k) => (
              <Skeleton key={k} className="inline-block h-3.5 w-full align-middle" />
            ))}
            <Skeleton className="inline-block h-3.5 w-1/2 align-middle" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Concepts from this source</CardTitle>
            <CardDescription>
              <Skeleton className="inline-block h-3.5 w-40 align-middle" />
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ItemSkeleton media={false} />
          </CardContent>
        </Card>
      </div>
    </Loading>
  );
}
