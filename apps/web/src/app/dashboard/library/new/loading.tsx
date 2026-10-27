import { PageHeader } from "@/components/page-header";
import { ButtonSkeleton, FieldSkeleton, Loading } from "@/components/page-skeleton";
import { Card, CardContent } from "@/components/ui/card";
import { selfHost } from "@/lib/self-host";

// A new library's form while it loads (without it, Settings' own loading
// state would stand in, with tabs this page doesn't have): its title and
// line, as the page has them, and the form's field and button.
export default function NewLibraryLoading() {
  return (
    <Loading>
      <PageHeader
        title="New library"
        description={
          selfHost
            ? "A separate library, with its own concepts, people, and address."
            : "A separate library, with its own concepts, people, address, and plan."
        }
      />
      <Card>
        <CardContent className="flex flex-col gap-4">
          <FieldSkeleton />
          <ButtonSkeleton />
        </CardContent>
      </Card>
    </Loading>
  );
}
