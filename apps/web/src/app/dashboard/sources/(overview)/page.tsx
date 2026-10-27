import { redirect } from "next/navigation";

/** Files are in the Library now, by its File filter: an old link lands there. */
export default async function SourcesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>;
}) {
  const params = new URLSearchParams(await searchParams);
  params.delete("before");
  redirect(`/dashboard/concepts${params.size ? `?${params}` : ""}`);
}
