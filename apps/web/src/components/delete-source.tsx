import { Trash2 } from "lucide-react";
import { deleteSource } from "@/app/dashboard/sources/actions";
import { ConfirmButton } from "@/components/confirm-button";

/** Delete a kept file, after asking: its file and text go, back to the Files tab. */
export function DeleteSource({ id }: { id: string }) {
  return (
    <ConfirmButton
      label={
        <>
          <Trash2 /> Delete
        </>
      }
      title="Delete this file?"
      description="Its text goes too. Concepts that cite it keep a citation that stops working."
      confirm="Delete the file"
      action={deleteSource}
      fields={{ id }}
    />
  );
}
