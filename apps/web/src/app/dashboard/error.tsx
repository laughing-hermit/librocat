"use client";

import { AlertTriangle } from "lucide-react";
import { useEffect } from "react";
import { ButtonLink } from "@/components/button-link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";

/**
 * A page that failed, inside the dashboard: the sidebar stays, and "Try
 * again" fetches the page anew (Next 16's `retry`). Shaped like not-found.tsx.
 */
export default function DashboardError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <Card className="mt-6">
      <CardContent>
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <AlertTriangle />
            </EmptyMedia>
            <EmptyTitle>This page didn't load</EmptyTitle>
            <EmptyDescription>
              Something went wrong on our side. Try again, or go back to the Library.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <div className="flex gap-2">
              <Button onClick={() => retry()}>Try again</Button>
              <ButtonLink href="/dashboard" variant="outline" prefetch={false}>
                Back to the Library
              </ButtonLink>
            </div>
          </EmptyContent>
        </Empty>
      </CardContent>
    </Card>
  );
}
