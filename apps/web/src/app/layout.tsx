import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { SiteAnalytics } from "@/components/site-analytics";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { site } from "@/lib/site";
import "./globals.css";

// The type system: IBM Plex Sans for the app and every page's text, Literata
// (a book face — libro) only for the public pages' headlines (`font-serif`),
// and IBM Plex Mono for the wordmark, commands, and code (globals.css). The files live in ./fonts (latin subsets, OFL),
// so a build never fetches Google Fonts: one production build failed on that
// fetch alone (2026-09-22). Literata and Plex Sans are variable fonts, one
// file each; Plex Mono ships static weights.
const plexSans = localFont({
  variable: "--font-sans",
  src: [{ path: "./fonts/plex-sans-variable.woff2", weight: "400 600" }],
});
const plexMono = localFont({
  variable: "--font-mono",
  src: [
    { path: "./fonts/plex-mono-400.woff2", weight: "400" },
    { path: "./fonts/plex-mono-500.woff2", weight: "500" },
  ],
});
const literata = localFont({
  variable: "--font-serif",
  src: [{ path: "./fonts/literata-variable.woff2", weight: "500 600" }],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://librocat.com"),
  title: `${site.name}: ${site.tagline}`,
  // What a search result shows, in the 160 characters it shows.
  description: site.summary,
  applicationName: site.name,
  // Each public page names its own canonical URL; one set here would claim
  // every page is the landing page.
  openGraph: { type: "website", siteName: site.name, locale: "en_US" },
  // opengraph-image.tsx is the card; X shows it large only with this card type.
  twitter: { card: "summary_large_image" },
};

// One theme, light, on every device: `only light` also stops a browser's
// automatic dark mode from inverting the page (globals.css).
export const viewport: Viewport = { colorScheme: "only light" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${plexSans.variable} ${plexMono.variable} ${literata.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <TooltipProvider>{children}</TooltipProvider>
        <Toaster />
        {/* librocat.com only: elsewhere (self-hosted, local) there is nothing to report to. */}
        {process.env.VERCEL === "1" && <SiteAnalytics />}
      </body>
    </html>
  );
}
