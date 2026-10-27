import { HeaderSkeleton, ItemSkeleton, Loading } from "@/components/page-skeleton";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ItemGroup } from "@/components/ui/item";
import { Skeleton } from "@/components/ui/skeleton";

// Account while it loads: its title and the line naming who signs in, then
// its cards, Name, Email and Danger zone, in their own words where they're
// always the same.
export default function AccountLoading() {
  return (
    <Loading>
      <HeaderSkeleton title="Account" />
      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Name</CardTitle>
            <CardDescription>
              What your teammates see, on Team and next to your agents.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Skeleton className="h-8 w-full max-w-md rounded-lg" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Email</CardTitle>
            <CardDescription>
              <Skeleton className="inline-block h-3.5 w-56 max-w-full align-middle" />
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ItemGroup>
              <ItemSkeleton media={false} title="Libro's report" />
            </ItemGroup>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Danger zone</CardTitle>
            <CardDescription>This can't be undone.</CardDescription>
          </CardHeader>
          <CardContent>
            <ItemGroup>
              <ItemSkeleton
                media={false}
                title="Delete your account"
                description="Your account and every library you own go, for good."
              />
            </ItemGroup>
          </CardContent>
        </Card>
      </div>
    </Loading>
  );
}
