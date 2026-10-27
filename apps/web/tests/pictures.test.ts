/** Pictures that aren't a PNG or a JPEG, converted to a JPEG to show (convex/pictures.ts). */
import sharp from "sharp";
import { describe, expect, test, vi } from "vitest";

// heic-convert, standing in for a real HEIC: the decoder is the library's to
// test, and an iPhone photo is too big to keep here. It returns a JPEG.
vi.mock("heic-convert", () => ({
  default: async () =>
    sharp({ create: { width: 4000, height: 3000, channels: 3, background: "#3366cc" } })
      .jpeg()
      .toBuffer(),
}));

const { convertible, toJpeg } = await import("../convex/pictures");

/** A test picture: `width` by `height`, half transparent, in `format`. */
async function picture(format: "webp" | "gif" | "tiff" | "avif", width = 64, height = 48) {
  return await sharp({
    create: { width, height, channels: 4, background: { r: 200, g: 40, b: 40, alpha: 0.5 } },
  })
    .toFormat(format)
    .toBuffer();
}

const isJpeg = (b: Buffer | null) => b !== null && b[0] === 0xff && b[1] === 0xd8;

describe("pictures that aren't a PNG or a JPEG become a JPEG", () => {
  test.each(["webp", "gif", "tiff", "avif"] as const)("%s", async (format) => {
    const jpeg = await toJpeg(`image/${format}`, await picture(format));
    expect(isJpeg(jpeg)).toBe(true);
    const meta = await sharp(jpeg as Buffer).metadata();
    expect([meta.width, meta.height, meta.hasAlpha]).toEqual([64, 48, false]);
  });

  test("an SVG, on white where it's transparent", async () => {
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><rect width="20" height="20" fill="#000"/></svg>',
    );
    const jpeg = (await toJpeg("image/svg+xml", svg)) as Buffer;
    expect(isJpeg(jpeg)).toBe(true);
    const { data } = await sharp(jpeg).raw().toBuffer({ resolveWithObject: true });
    // The right half was transparent: white now, not black.
    expect(data[data.length - 3]).toBeGreaterThan(240);
  });

  test("a HEIC, through heic-convert, cut to 2,048 pixels on its longer side", async () => {
    const jpeg = (await toJpeg("image/heic", Buffer.from("heic"))) as Buffer;
    const meta = await sharp(jpeg).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(["jpeg", 2048, 1536]);
  });

  test("a big picture shrinks, a small one doesn't grow", async () => {
    const big = (await toJpeg("image/webp", await picture("webp", 5000, 1000))) as Buffer;
    expect((await sharp(big).metadata()).width).toBe(2048);
    const small = (await toJpeg("image/webp", await picture("webp", 30, 30))) as Buffer;
    expect((await sharp(small).metadata()).width).toBe(30);
  });
});

test("PNG and JPEG stay as they are, and BMP isn't converted", async () => {
  for (const mime of ["image/png", "image/jpeg", "image/bmp", "image/x-icon"]) {
    expect(convertible(mime)).toBe(false);
    expect(await toJpeg(mime, Buffer.from("x"))).toBeNull();
  }
  for (const mime of ["image/heic", "image/heif", "image/webp", "image/svg+xml"]) {
    expect(convertible(mime)).toBe(true);
  }
});
