import { SearchX } from "lucide-react";
import { ButtonLink } from "@/components/button-link";
import { Card, CardContent } from "@/components/ui/card";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";

/** A concept, source, or page the library doesn't have, inside the dashboard. */
export default function NotFound() {
  return (
    <Card className="mt-6">
      <CardContent>
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <SearchX />
            </EmptyMedia>
            <EmptyTitle>Not in this library</EmptyTitle>
            <EmptyDescription>
              It may have been renamed or deleted, or it's in another of your libraries.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <ButtonLink href="/dashboard/concepts" prefetch={false}>
              Back to the Library
            </ButtonLink>
          </EmptyContent>
        </Empty>
      </CardContent>
    </Card>
  );
}
