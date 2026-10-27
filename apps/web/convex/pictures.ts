"use node";

/**
 * Pictures that aren't a PNG or a JPEG, converted to a JPEG kept beside the
 * original (convex/attachments.ts), so the dashboard and an agent that reads
 * images can show them: HEIC and HEIF, the iPhone's photos, with
 * heic-convert; WebP, GIF (its first frame), AVIF, TIFF, and SVG with sharp.
 * sharp doesn't read BMP, so a BMP is kept as it is. The longer side is cut
 * to 2,048 pixels, plenty to look at, and the picture turned upright. sharp
 * is an external package on Convex (convex.json); where it isn't installed,
 * only HEIC converts, full size. Search finds a picture by its title.
 */

import convert from "heic-convert";

/** The longest side a converted picture keeps. */
const MAX_SIDE = 2048;
/** The most pixels a picture may have to be converted: about 200 MB once decoded. */
const MAX_PIXELS = 50_000_000;

const HEIC = new Set(["image/heic", "image/heif"]);
const SHARP = new Set(["image/webp", "image/gif", "image/avif", "image/tiff", "image/svg+xml"]);

type Sharp = typeof import("sharp")["default"];

/** sharp, where it's installed (an external package on Convex: convex.json). */
async function loadSharp(): Promise<Sharp | null> {
  try {
    return (await import("sharp")).default;
  } catch {
    return null;
  }
}

/** Whether librocat converts pictures of this type to JPEG. */
export const convertible = (mime: string): boolean => HEIC.has(mime) || SHARP.has(mime);

/** A picture as a JPEG; null when it can't be converted here. */
export async function toJpeg(mime: string, bytes: Buffer): Promise<Buffer | null> {
  if (!convertible(mime)) return null;
  const sharp = await loadSharp();
  let input = bytes;
  if (HEIC.has(mime)) {
    try {
      input = Buffer.from(await convert({ buffer: bytes, format: "JPEG", quality: 0.9 }));
    } catch (exc) {
      // A HEIF that isn't HEVC (AV1, say) is sharp's to read.
      if (!sharp) throw exc;
    }
    if (!sharp) return input;
  }
  if (!sharp) return null;
  return await sharp(input, { animated: false, density: 144, limitInputPixels: MAX_PIXELS })
    .rotate()
    .resize({ width: MAX_SIDE, height: MAX_SIDE, fit: "inside", withoutEnlargement: true })
    .flatten({ background: "#ffffff" })
    .jpeg({ quality: 85, mozjpeg: true })
    .toBuffer();
}
