import { ButtonLink } from "@/components/button-link";
import { SitePage } from "@/components/site-chrome";

export const metadata = { title: "Not found | librocat" };

/** Any address the site doesn't have. */
export default function NotFound() {
  return (
    <SitePage
      title="Nothing here"
      lede="This address isn't a page on librocat.com. It may have moved, or it was mistyped."
    >
      <div className="flex flex-wrap gap-3">
        <ButtonLink href="/">Go to the home page</ButtonLink>
        <ButtonLink href="/dashboard" variant="outline">
          Open your library
        </ButtonLink>
      </div>
    </SitePage>
  );
}
