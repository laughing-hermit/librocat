import { redirect } from "next/navigation";

/**
 * The dashboard's address opens the Library, its one page (what Home
 * showed is there now, under Needs you). Whatever the address carried,
 * such as a Settings action's `?done=`, comes along.
 */
export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>;
}) {
  const params = new URLSearchParams(await searchParams);
  redirect(`/dashboard/concepts${params.size ? `?${params}` : ""}`);
}
