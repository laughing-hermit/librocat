import { AlertTriangle } from "lucide-react";
import { DeleteIndexButton, ExportButton, ImportButton } from "@/components/data-controls";
import { ErrorAlert } from "@/components/error-alert";
import {
  DeleteLibraryControl,
  LeaveLibraryControl,
  RenameLibraryForm,
} from "@/components/library-controls";
import { PageHeader } from "@/components/page-header";
import { SettingsTabs } from "@/components/settings-tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from "@/components/ui/item";
import { deleteLibraryCopy } from "@/lib/delete-copy";
import { getLibraries, getMe } from "@/lib/librocat";
import { requireSession } from "@/lib/require-session";
import { selfHost } from "@/lib/self-host";

export const metadata = { title: "Settings | librocat" };

export default async function LibrarySettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  await requireSession();
  const { error: failed } = await searchParams;
  const [{ data: libraries, error }, { data: me }] = await Promise.all([getLibraries(), getMe()]);
  const current = libraries?.find((l) => l.current) ?? libraries?.[0];
  // What deleting it does to its plan: a Team's home ends the Team for all
  // its libraries (src/lib/delete-copy.ts).
  const ws = me?.workspace?.id === current?.id ? me?.workspace : null;
  const deleting =
    current &&
    deleteLibraryCopy({
      name: current.name,
      plan: ws?.plan ?? current.plan,
      billedWith: ws?.billedWith ?? null,
      covers: ws?.covers ?? [],
    });
  const admin = current ? current.role === "admin" || current.owner : false;
  // A Reader only reads: export, but no import.
  const reader = current?.role === "reader" && !current.owner;

  return (
    <>
      <PageHeader title="Settings" />
      <SettingsTabs selfHost={selfHost} />
      {!current ? (
        <ErrorAlert>{error ?? "No library yet."}</ErrorAlert>
      ) : (
        <div className="flex flex-col gap-6">
          {failed === "empty" && (
            <Alert variant="destructive">
              <AlertTriangle />
              <AlertDescription>
                The library couldn't be emptied. Please try again.
              </AlertDescription>
            </Alert>
          )}
          {admin && (
            <Card>
              <CardHeader>
                <CardTitle>Name</CardTitle>
                <CardDescription>
                  Renaming keeps the address, so agents keep working.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <RenameLibraryForm name={current.name} />
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Your data</CardTitle>
              <CardDescription>
                Everything in it is plain Markdown you can take anywhere.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ItemGroup>
                <Item variant="outline" size="sm">
                  <ItemContent>
                    <ItemTitle>Export</ItemTitle>
                    <ItemDescription>
                      Download everything as Markdown, with your files.
                    </ItemDescription>
                  </ItemContent>
                  <ItemActions>
                    <ExportButton />
                  </ItemActions>
                </Item>
                {!reader && (
                  <Item variant="outline" size="sm">
                    <ItemContent>
                      <ItemTitle>Import</ItemTitle>
                      <ItemDescription>Add the concepts and files from an export.</ItemDescription>
                    </ItemContent>
                    <ItemActions>
                      <ImportButton />
                    </ItemActions>
                  </Item>
                )}
              </ItemGroup>
            </CardContent>
          </Card>

          {/* Everyone has a way out: admins delete it, and everyone but its owner can leave. */}
          <Card>
            <CardHeader>
              <CardTitle>Danger zone</CardTitle>
              <CardDescription>These can't be undone.</CardDescription>
            </CardHeader>
            <CardContent>
              <ItemGroup>
                {admin && (
                  <Item variant="outline" size="sm">
                    <ItemContent>
                      <ItemTitle>Empty this library</ItemTitle>
                      <ItemDescription>
                        Every concept, link, and source goes. The library and its plan stay.
                      </ItemDescription>
                    </ItemContent>
                    <ItemActions>
                      <DeleteIndexButton />
                    </ItemActions>
                  </Item>
                )}
                {!current.owner && (
                  <Item variant="outline" size="sm">
                    <ItemContent>
                      <ItemTitle>Leave this library</ItemTitle>
                      <ItemDescription>
                        It goes from your list. The library stays for its team.
                      </ItemDescription>
                    </ItemContent>
                    <ItemActions>
                      <LeaveLibraryControl id={current.id} name={current.name} />
                    </ItemActions>
                  </Item>
                )}
                {admin && deleting && (
                  <Item variant="outline" size="sm">
                    <ItemContent>
                      <ItemTitle>Delete this library</ItemTitle>
                      <ItemDescription>{deleting.row}</ItemDescription>
                    </ItemContent>
                    <ItemActions>
                      <DeleteLibraryControl
                        id={current.id}
                        title={deleting.title}
                        description={deleting.description}
                      />
                    </ItemActions>
                  </Item>
                )}
              </ItemGroup>
            </CardContent>
          </Card>
        </div>
      )}
    </>
  );
}
