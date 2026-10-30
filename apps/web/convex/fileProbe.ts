"use node";

/**
 * Whether this deployment converts pictures and reads office documents
 * (attachments.ts): a WebP converted to a JPEG (pictures.ts, which needs
 * sharp, an external package: convex.json) and a spreadsheet read as CSV
 * (officeText.ts). Fixed inputs made here, never a library's.
 *
 *   npx convex run fileProbe:run          # librocat.com, or a dev deployment
 *   ./models.sh files                     # self-hosted (self-host/)
 */

import { v } from "convex/values";
import JSZip from "jszip";
import { internalAction } from "./_generated/server";
import { officeText } from "./officeText";
import { toJpeg } from "./pictures";

const why = (exc: unknown) => (exc instanceof Error ? exc.message : String(exc));

export const run = internalAction({
  args: {},
  returns: v.object({ pictures: v.string(), documents: v.string() }),
  handler: async () => {
    let pictures: string;
    try {
      const sharp = (await import("sharp")).default;
      const webp = await sharp({
        create: { width: 8, height: 8, channels: 3, background: "#22aa66" },
      })
        .webp()
        .toBuffer();
      const jpeg = await toJpeg("image/webp", webp);
      pictures =
        jpeg && jpeg[0] === 0xff && jpeg[1] === 0xd8
          ? `ok: a WebP became a ${jpeg.length}-byte JPEG`
          : "failed: no JPEG came back";
    } catch (exc) {
      pictures = `off: ${why(exc)}. PNG and JPEG are kept as they are; HEIC still converts.`;
    }

    let documents: string;
    try {
      const zip = new JSZip();
      zip.file(
        "xl/workbook.xml",
        '<workbook><sheets><sheet name="Probe" r:id="rId1"/></sheets></workbook>',
      );
      zip.file(
        "xl/_rels/workbook.xml.rels",
        '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
      );
      zip.file(
        "xl/worksheets/sheet1.xml",
        '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>probe</t></is></c>' +
          '<c r="B1"><v>42</v></c></row></sheetData></worksheet>',
      );
      const { text } = await officeText(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        await zip.generateAsync({ type: "nodebuffer" }),
      );
      documents = text.includes("probe,42") ? "ok: a spreadsheet read as CSV" : `failed: ${text}`;
    } catch (exc) {
      documents = `failed: ${why(exc)}`;
    }
    return { pictures, documents };
  },
});
