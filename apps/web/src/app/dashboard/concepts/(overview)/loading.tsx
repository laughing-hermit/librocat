import { PageHeader } from "@/components/page-header";
import { ListRowSkeleton, Loading, ROWS } from "@/components/page-skeleton";
import { ItemGroup } from "@/components/ui/item";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

// The Library while it loads, as concept-library.tsx lays it out: its title
// with its two buttons, the three tabs with their counts (none picked: it
// may open on Concepts), a toolbar's search and two filters, and a page of
// rows. Each tab's list has these rows, so it fits whichever opens.
export default function LibraryLoading() {
  return (
    <Loading>
      <PageHeader title="Library">
        <Skeleton className="h-8 w-28 rounded-lg" />
        <Skeleton className="h-8 w-28 rounded-lg" />
      </PageHeader>
      <Tabs value={null}>
        <TabsList variant="line">
          {["Needs you", "Concepts", "Files"].map((tab) => (
            <TabsTrigger key={tab} value={tab}>
              {tab} <Skeleton className="h-5 w-7 rounded-full" />
            </TabsTrigger>
          ))}
        </TabsList>
        <div className="flex flex-col gap-4 pt-2">
          <div className="flex flex-wrap items-center gap-2">
            <Skeleton className="h-8 min-w-48 flex-1 rounded-lg" />
            <Skeleton className="h-8 w-20 rounded-lg" />
            <Skeleton className="h-8 w-20 rounded-lg" />
          </div>
          <ItemGroup>
            {ROWS.map((k) => (
              <ListRowSkeleton key={k} />
            ))}
          </ItemGroup>
        </div>
      </Tabs>
    </Loading>
  );
}
