import Link from "next/link";
import type { ReactNode } from "react";
import { conceptHref } from "@/lib/hrefs";
import { link } from "@/lib/utils";

/**
 * A concept named anywhere (in a concept's text, its links, a file's
 * page): a link, green like every link, that opens it in the Library's
 * list, as its row does. Back returns.
 */
export function ConceptLink({ id, children }: { id: string; children: ReactNode }) {
  return (
    <Link href={`${conceptHref(id)}?tab=concepts`} className={link} prefetch={false}>
      {children}
    </Link>
  );
}
