/**
 * Regenerate convex/betterAuth/schema.ts from the Better Auth options in
 * convex/auth.ts — the tables of every plugin in use (users, sessions,
 * accounts, verifications, JWKS, OAuth clients/tokens/consents).
 * Run after adding or removing a Better Auth plugin:
 *
 *   pnpm run auth:schema
 */

import * as fs from "node:fs";
import { getAuthTables } from "better-auth/db";
import { createAuthOptions } from "../convex/auth";

const options = createAuthOptions({} as never);
const adapter = options.database(options as never);
const out = "convex/betterAuth/schema.ts";
const { code } = await (
  adapter as unknown as {
    createSchema: (o: { tables: unknown; file: string }) => Promise<{ code: string }>;
  }
).createSchema({ tables: getAuthTables(options), file: out });
// The generator names the Better Auth CLI; this repo regenerates with the script.
fs.writeFileSync(out, code.replace("npx auth generate", "pnpm run auth:schema   (in apps/web)"));
console.log(`wrote ${out}`);
