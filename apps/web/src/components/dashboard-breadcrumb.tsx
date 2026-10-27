"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";

/** The Library's Files tab: where a file's page comes from. */
const FILES = "/dashboard/concepts?tab=files";

/**
 * On a file's page, the way back to the Library's Files. Elsewhere the page's own
 * heading says where you are, so nothing shows.
 */
export function DashboardBreadcrumb() {
  const pathname = usePathname();
  if (!pathname.startsWith("/dashboard/sources/")) return null;
  return (
    <Breadcrumb className="mb-4">
      <BreadcrumbList>
        <BreadcrumbItem>
          <BreadcrumbLink render={<Link href={FILES} prefetch={false} />}>Library</BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <BreadcrumbLink render={<Link href={FILES} prefetch={false} />}>Files</BreadcrumbLink>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  );
}
