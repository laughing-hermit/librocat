import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ConceptLibrary } from "@/components/concept-library";
import { conceptPage } from "@/components/concept-view";
import type { LibraryFilters } from "@/lib/librocat";
import { requireSession } from "@/lib/require-session";

type Props = {
  params: Promise<{ id: string[] }>;
  searchParams: Promise<
    LibraryFilters & { rev?: string; libro?: string; page?: string; tab?: string }
  >;
};

const idOf = (segments: string[]) => segments.map(decodeURIComponent).join("/");

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const [{ id }, { rev }] = await Promise.all([params, searchParams]);
  const { data } = await conceptPage(idOf(id), rev);
  return { title: `${data?.concept?.title || "Concept"} | librocat` };
}

/** A concept's address: the Library's list, with it open. */
export default async function ConceptPage({ params, searchParams }: Props) {
  await requireSession();
  const [{ id: segments }, { rev, libro, page, tab, q, type, tag, shelf, after, sort }] =
    await Promise.all([params, searchParams]);
  const id = idOf(segments);
  // An error is the backend failing (the open concept says so); a null concept with no error does not exist.
  const { data, error } = await conceptPage(id, rev);
  if (!error && !data?.concept) notFound();
  return (
    <ConceptLibrary
      filters={{ q, type, tag, shelf, after, sort }}
      open={id}
      rev={rev}
      libro={libro}
      page={page}
      tab={tab}
    />
  );
}
