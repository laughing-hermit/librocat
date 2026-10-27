import { PageHeader } from "@/components/page-header";
import { ButtonSkeleton, ItemSkeleton, Loading } from "@/components/page-skeleton";
import { SettingsTabs } from "@/components/settings-tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ItemGroup } from "@/components/ui/item";
import { Skeleton } from "@/components/ui/skeleton";
import { selfHost } from "@/lib/self-host";

// Settings › Team while it loads: the invite card and the members.
export default function TeamLoading() {
  return (
    <Loading>
      <PageHeader title="Settings" />
      <SettingsTabs selfHost={selfHost} />
      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Invite people</CardTitle>
            <CardDescription>
              <Skeleton className="inline-block h-3.5 w-80 max-w-full align-middle" />
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ButtonSkeleton />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Members</CardTitle>
            <CardDescription>
              <Skeleton className="inline-block h-3.5 w-28 align-middle" />
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ItemGroup>
              <ItemSkeleton action={false} />
            </ItemGroup>
          </CardContent>
        </Card>
      </div>
    </Loading>
  );
}
