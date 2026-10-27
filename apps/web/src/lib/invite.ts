import { getInvite } from "@/lib/librocat";

type Invite = { invitedBy: string | null; role: "editor" | "reader" };

/** Who invited the person, and as what: the first line on each page of an invite. */
export function invitedLine(invite: Invite): string {
  const as =
    invite.role === "reader"
      ? "a Reader: your agents search and read the library"
      : "an Editor: your agents read the library and add to it";
  return `${invite.invitedBy ?? "A teammate"} invited you as ${as}.`;
}

/**
 * The invite a sign-up or sign-in goes on to (`?next=/invite/<code>`), for
 * the page to name the library it joins; null for any other `next`.
 */
export async function inviteFrom(next: string | string[] | undefined) {
  const code = typeof next === "string" ? /^\/invite\/(\w+)$/.exec(next)?.[1] : undefined;
  return code ? (await getInvite(code)).data : null;
}
