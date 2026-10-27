import { PageHeader } from "@/components/page-header";
import { ButtonSkeleton, FieldSkeleton, ItemSkeleton, Loading } from "@/components/page-skeleton";
import { SettingsTabs } from "@/components/settings-tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ItemGroup } from "@/components/ui/item";
import { selfHost } from "@/lib/self-host";

// Settings › General while it loads: the same tabs and cards, in their own words.
export default function LibrarySettingsLoading() {
  return (
    <Loading>
      <PageHeader title="Settings" />
      <SettingsTabs selfHost={selfHost} />
      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Name</CardTitle>
            <CardDescription>Renaming keeps the address, so agents keep working.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex max-w-md gap-2">
              <FieldSkeleton />
              <ButtonSkeleton />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Your data</CardTitle>
            <CardDescription>
              Everything in it is plain Markdown you can take anywhere.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ItemGroup>
              <ItemSkeleton
                media={false}
                title="Export"
                description="Download everything as Markdown, with your files."
              />
              <ItemSkeleton
                media={false}
                title="Import"
                description="Add the concepts and files from an export."
              />
            </ItemGroup>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Danger zone</CardTitle>
            <CardDescription>These can't be undone.</CardDescription>
          </CardHeader>
          <CardContent>
            {/* Gray, not words: which of Empty, Leave, and Delete you get depends on your role. */}
            <ItemGroup>
              <ItemSkeleton media={false} />
              <ItemSkeleton media={false} />
            </ItemGroup>
          </CardContent>
        </Card>
      </div>
    </Loading>
  );
}
