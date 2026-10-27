"use client";

import { deleteAccount } from "@/app/dashboard/billing/actions";
import { ConfirmButton } from "@/components/confirm-button";

/**
 * GDPR account deletion, separate from emptying a library (data-controls.tsx):
 * every library the person owns goes, with its subscription, then their
 * identity; the libraries others own stay, without them. A paid plan ends at
 * once, with no refund for the time left (convex/account.ts), and it says so.
 */
export function DeleteAccountControl({ paid }: { paid: boolean }) {
  return (
    <ConfirmButton
      label="Delete account"
      title="Delete your account?"
      description={`Every library you own goes, and you leave the others.${paid ? " Their plans end now, with no refund for the time left, and any pay-as-you-go used this month is billed." : ""} There is no undo: export first to keep a copy.`}
      confirm="Delete the account"
      action={deleteAccount}
    />
  );
}
