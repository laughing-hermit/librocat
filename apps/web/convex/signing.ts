/**
 * Signed tokens: HMAC-SHA256 keyed by the deployment's BETTER_AUTH_SECRET,
 * each kind domain-separated by the words its message starts with. An
 * email's unsubscribe link (report.ts) and a file link (files.ts) use them.
 */

/** Bytes as base64url, unpadded. */
export const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

/** HMAC-SHA256 of `message` keyed by `secret`, as base64url. */
export async function hmac(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return b64url(new Uint8Array(sig));
}

/** Compare two strings in time independent of where they differ. */
export function sameToken(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
