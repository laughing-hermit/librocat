import { Brand } from "@/components/brand";
import { ButtonLink } from "@/components/button-link";
import { SiteMenu } from "@/components/site-menu";
import { comingSoon } from "@/lib/coming-soon";
import { site } from "@/lib/site";

// The public site's header and footer, shared by the landing page and the
// standalone pages (About, Terms, Privacy, Security, Disclaimer), so they
// read as one site. On a phone the links move into a menu and only the main
// button stays.
export function SiteHeader({ home = false }: { home?: boolean }) {
  const anchor = (id: string) => (home ? `#${id}` : `/#${id}`);
  // Before launch the main button is GitHub's, so the link isn't said twice.
  const sections = [
    { href: anchor("how"), label: "How it works" },
    { href: anchor("pricing"), label: "Pricing" },
    ...(comingSoon ? [] : [{ href: site.repo, label: "GitHub" }]),
  ];
  return (
    <header className="sticky top-0 z-40 border-b bg-background/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <Brand />
        <nav className="flex items-center gap-1">
          {sections.map(({ href, label }) => (
            <ButtonLink key={href} variant="ghost" href={href} className="hidden md:inline-flex">
              {label}
            </ButtonLink>
          ))}
          {comingSoon ? (
            <ButtonLink href={site.repo} className="ml-2">
              Star on GitHub
            </ButtonLink>
          ) : (
            <>
              <ButtonLink variant="ghost" href="/sign-in" className="hidden md:inline-flex">
                Sign in
              </ButtonLink>
              <ButtonLink href="/sign-up" className="ml-2">
                Start free
              </ButtonLink>
            </>
          )}
          <SiteMenu
            className="md:hidden"
            links={comingSoon ? sections : [...sections, { href: "/sign-in", label: "Sign in" }]}
          />
        </nav>
      </div>
    </header>
  );
}

const FOOTER_LINKS = [
  { href: "/about", label: "About" },
  { href: "/privacy", label: "Privacy" },
  { href: "/terms", label: "Terms" },
  { href: "/security", label: "Security" },
  { href: "/disclaimer", label: "Disclaimer" },
  { href: site.status, label: "Status" },
  { href: site.changelog, label: "Changelog" },
  { href: site.repo, label: "GitHub" },
];

export function SiteFooter() {
  return (
    <footer className="border-t">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-12 text-sm text-muted-foreground">
        <div className="flex flex-col items-center justify-between gap-6 sm:flex-row">
          <Brand />
          <nav className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
            {FOOTER_LINKS.map((l) => (
              <a key={l.label} href={l.href} className="hover:text-foreground">
                {l.label}
              </a>
            ))}
          </nav>
        </div>
        <p className="text-center sm:text-left">
          {site.productLine} © 2026 {site.company} Open source under Apache-2.0.
        </p>
      </div>
    </footer>
  );
}

// The standalone page shell: a title, one line under it, then the sections
// as cards, at one reading width.
export function SitePage({
  title,
  lede,
  children,
}: {
  title: string;
  lede: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-6 py-16">
        <div className="flex flex-col gap-3 pb-4">
          <h1 className="font-serif text-4xl font-semibold tracking-tight text-balance">{title}</h1>
          <p className="text-lg text-muted-foreground">{lede}</p>
        </div>
        {children}
      </main>
      <SiteFooter />
    </>
  );
}
