import { PageHeader } from "@/components/page-header";
import { Loading, MeterSkeleton } from "@/components/page-skeleton";
import { SettingsTabs } from "@/components/settings-tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

// Settings › Billing while it loads: usage first, as the page has it, with
// bars where the counts will be. The plan's own cards come in below it.
export default function BillingLoading() {
  return (
    <Loading>
      <PageHeader title="Settings" />
      <SettingsTabs />
      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Usage</CardTitle>
            <CardDescription>
              <Skeleton className="inline-block h-3.5 w-40 align-middle" />
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <MeterSkeleton />
            <MeterSkeleton />
          </CardContent>
        </Card>
      </div>
    </Loading>
  );
}
