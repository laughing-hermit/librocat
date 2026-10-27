import { ConceptLibrary } from "@/components/concept-library";
import type { LibraryFilters } from "@/lib/librocat";
import { requireSession } from "@/lib/require-session";

export const metadata = { title: "Library | librocat" };

export default async function LibraryPage({
  searchParams,
}: {
  searchParams: Promise<
    LibraryFilters & { error?: string; page?: string; tab?: string; libro?: string }
  >;
}) {
  await requireSession();
  const { error, page, tab, libro, q, type, tag, shelf, after, sort } = await searchParams;
  return (
    <ConceptLibrary
      filters={{ q, type, tag, shelf, after, sort }}
      error={error}
      page={page}
      tab={tab}
      libro={libro}
    />
  );
}
