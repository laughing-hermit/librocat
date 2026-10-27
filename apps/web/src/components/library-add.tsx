"use client";

import { Link as LinkIcon, Paperclip } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { saveLink } from "@/app/dashboard/sources/actions";
import { AttachInput, useAttach } from "@/components/attach-files";
import { Button } from "@/components/ui/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Spinner } from "@/components/ui/spinner";

/**
 * The Library's two ways in, one click each: attach files (the picker
 * opens at once), or save a web page to read later, typed right where the
 * buttons were (Individual and Team; on Free it leads to Billing). Nothing
 * pops up over the page.
 */
export function LibraryAdd({ canSaveLinks }: { canSaveLinks: boolean }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const { busy, attach } = useAttach();
  const [linking, setLinking] = useState(false);

  if (linking) {
    return (
      <form action={saveLink} className="flex w-full max-w-md items-center gap-2">
        <InputGroup>
          <InputGroupAddon>
            <LinkIcon />
          </InputGroupAddon>
          <InputGroupInput
            name="url"
            type="url"
            required
            autoFocus
            placeholder="https://"
            aria-label="A page's URL"
            onKeyDown={(e) => {
              if (e.key === "Escape") setLinking(false);
            }}
          />
          <InputGroupAddon align="inline-end">
            <SaveButton />
          </InputGroupAddon>
        </InputGroup>
        <Button type="button" variant="ghost" onClick={() => setLinking(false)}>
          Cancel
        </Button>
      </form>
    );
  }
  return (
    <>
      <AttachInput ref={input} attach={attach} />
      <Button
        variant="outline"
        onClick={() => (canSaveLinks ? setLinking(true) : router.push("/dashboard/billing"))}
      >
        <LinkIcon />
        {canSaveLinks ? "Save a link" : "Save links: upgrade"}
      </Button>
      <Button disabled={busy !== null} onClick={() => input.current?.click()}>
        {busy ? <Spinner /> : <Paperclip />}
        {busy ? `Uploading ${busy}` : "Attach files"}
      </Button>
    </>
  );
}

/** The link's submit: it reads the page first, so it says so while it does. */
function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <InputGroupButton type="submit" variant="secondary" disabled={pending}>
      {pending && <Spinner />}
      {pending ? "Reading…" : "Save link"}
    </InputGroupButton>
  );
}
