import { AlertTriangle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

/** What went wrong, one way on every dashboard page: a destructive Alert. */
export function ErrorAlert({ children }: { children: React.ReactNode }) {
  return (
    <Alert variant="destructive">
      <AlertTriangle />
      <AlertDescription>{children}</AlertDescription>
    </Alert>
  );
}
