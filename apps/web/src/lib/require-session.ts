import { redirect } from "next/navigation";
import { isAuthenticated } from "@/lib/auth-server";
import { ensureWorkspace, getMe } from "@/lib/librocat";

// Guard for dashboard pages. The proxy also checks, but each page verifies the
// session itself so a revoked/expired session stops serving data.
//
// Everyone has a library: sign-up makes the first (convex/auth.ts), and
// leaving, being removed from, or deleting your last one makes a new one.
// Should one still be missing, it's made here, then the dashboard again to
// show it. `me` is the request's own read, shared with the layout (getMe is
// cached per request), so the check costs no call of its own.
//
// Without NEXT_PUBLIC_CONVEX_URL (local build before `pnpm exec convex dev`), the
// guard passes through and pages render their "Convex is not configured" state.
export async function requireSession(): Promise<void> {
  if (!process.env.NEXT_PUBLIC_CONVEX_URL) return;
  if (!(await isAuthenticated())) redirect("/sign-in");
  const { data: me } = await getMe();
  if (me && !me.workspace && (await ensureWorkspace())) redirect("/dashboard");
}
