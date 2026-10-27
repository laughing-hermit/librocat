import { readFile } from "node:fs/promises";
import path from "node:path";
import { ImageResponse } from "next/og";
import { PLUGINS_COMMAND, site } from "@/lib/site";

/**
 * The link-preview card (1200 × 630), and GitHub's social preview padded to
 * 1280 × 640: the landing page's hero as a card. The header's lockup, what
 * librocat is, the hero's line, and every agent's install command on the left; Libro's
 * tile on the right. In the site's own
 * colors (globals.css, as hex). Rendered once at build.
 */
export const alt = `${site.name}: ${site.tagline}`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const GREEN = "#1F744F";
const INK = "#131915";
const MUTED = "#54615A";
const BORDER = "#DEE7E2";

const HEADLINE = ["The Open-Source", "Knowledge Base", "for AI Agents"] as const;
// The hero's headline, in two lines that fit beside the tile.
const LINE = ["Tell one agent once.", "Every agent remembers."];
const COMMAND = PLUGINS_COMMAND;

// Satori needs the font bytes. Google Fonts serves TTF (which Satori reads)
// to a non-browser fetch, subset to the glyphs the card uses.
async function font(family: string, weight: number, text: string) {
  const css = await (
    await fetch(
      `https://fonts.googleapis.com/css2?family=${family.replaceAll(" ", "+")}:wght@${weight}&text=${encodeURIComponent(text)}`,
    )
  ).text();
  const url = css.match(/src: url\((.+?)\)/)?.[1];
  if (!url) throw new Error(`No font file for ${family} ${weight}`);
  return (await fetch(url)).arrayBuffer();
}

const svg = (bytes: Buffer) => `data:image/svg+xml;base64,${bytes.toString("base64")}`;

export default async function Image() {
  const [heading, sans, mono, monoBold, tile, head] = await Promise.all([
    font("Literata", 600, HEADLINE.join(" ")),
    font("IBM Plex Sans", 400, LINE.join(" ")),
    font("IBM Plex Mono", 400, `$ ${COMMAND}`),
    // Bold: the header's wordmark is semibold over a 500 face (the site loads
    // 400 and 500), which the browser thickens; 700 is the true weight nearest it.
    font("IBM Plex Mono", 700, site.name),
    readFile(path.join(process.cwd(), "public/logo.svg")),
    readFile(path.join(process.cwd(), "public/logo-head.svg")),
  ]);
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 88px",
        background: "#FFFFFF",
        color: INK,
      }}
    >
      <div style={{ display: "flex", flexDirection: "column" }}>
        {/* The site header's lockup: the head mark and the wordmark. */}
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          {/* biome-ignore lint/performance/noImgElement: Satori markup, not the DOM */}
          <img alt="" width={44} height={44} src={svg(head)} />
          <div
            style={{
              display: "flex",
              fontFamily: "IBM Plex Mono",
              fontWeight: 700,
              fontSize: 34,
              letterSpacing: -0.5,
            }}
          >
            <span>libro</span>
            <span style={{ color: GREEN }}>cat</span>
          </div>
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            marginTop: 40,
            fontFamily: "Literata",
            fontWeight: 600,
            fontSize: 68,
            lineHeight: 1.04,
            letterSpacing: -1.5,
          }}
        >
          {HEADLINE.map((l) => (
            <span key={l}>{l}</span>
          ))}
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            marginTop: 22,
            fontFamily: "IBM Plex Sans",
            fontSize: 26,
            lineHeight: 1.35,
            color: MUTED,
          }}
        >
          {LINE.map((l) => (
            <span key={l}>{l}</span>
          ))}
        </div>
        {/* The hero's command box: a muted prompt, the command in ink. */}
        <div
          style={{
            display: "flex",
            alignSelf: "flex-start",
            marginTop: 32,
            padding: "14px 22px",
            fontFamily: "IBM Plex Mono",
            fontSize: 26,
            border: `2px solid ${BORDER}`,
            borderRadius: 12,
          }}
        >
          <span style={{ color: MUTED, marginRight: 16 }}>$</span>
          <span>{COMMAND}</span>
        </div>
      </div>
      {/* biome-ignore lint/performance/noImgElement: Satori markup, not the DOM */}
      <img alt="" width={340} height={340} src={svg(tile)} />
    </div>,
    {
      ...size,
      fonts: [
        { name: "Literata", data: heading, weight: 600, style: "normal" },
        { name: "IBM Plex Sans", data: sans, weight: 400, style: "normal" },
        { name: "IBM Plex Mono", data: mono, weight: 400, style: "normal" },
        { name: "IBM Plex Mono", data: monoBold, weight: 700, style: "normal" },
      ],
    },
  );
}
