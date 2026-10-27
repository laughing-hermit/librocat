"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupText,
} from "@/components/ui/input-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { count, type InstallMethod } from "@/lib/analytics";
import { cn } from "@/lib/utils";

/**
 * Copy through the clipboard API, or the older way where it is missing
 * (plain http, such as a self-hosted librocat at a LAN address) or refused.
 */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.append(area);
    area.select();
    try {
      return document.execCommand("copy");
    } catch {
      return false;
    } finally {
      area.remove();
    }
  }
}

type Counted = { method: InstallMethod; where: "landing" | "connect" };

/** Copy `value`, say so, and count it when it is an install command. */
function useCopy(value: string, label = "Copied to clipboard", counted?: Counted) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    if (!(await copyText(value))) {
      toast.error("Could not copy. Select the text and copy it by hand.");
      return;
    }
    setCopied(true);
    if (counted) count("install_copied", counted);
    toast.success(label);
    setTimeout(() => setCopied(false), 1500);
  };
  return { copied, copy };
}

export function CopyButton({
  value,
  label,
  tip = "Copy",
  text,
  className,
  counted,
}: {
  value: string;
  label?: string;
  /** What the button copies, in its tooltip and to a screen reader. */
  tip?: string;
  /** A visible label ("Copy prompt"), where copying is the row's action: no tooltip needed. */
  text?: string;
  className?: string;
  /** An install command: counted when copied, by what it installs and where. */
  counted?: Counted;
}) {
  const { copied, copy } = useCopy(value, label, counted);
  if (text) {
    return (
      <Button type="button" variant="outline" size="sm" onClick={copy}>
        {copied ? <Check /> : <Copy />}
        {copied ? "Copied" : text}
      </Button>
    );
  }
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={cn("size-8 shrink-0", className)}
            onClick={copy}
            aria-label={tip}
          />
        }
      >
        {copied ? <Check className="size-4 text-primary" /> : <Copy className="size-4" />}
      </TooltipTrigger>
      <TooltipContent>{copied ? "Copied" : tip}</TooltipContent>
    </Tooltip>
  );
}

/**
 * A command or address to copy: one line of text that never wraps (it
 * scrolls sideways when the screen is narrow, and a command never breaks
 * mid-flag), a `$` before a command, and the copy button inside (shadcn's
 * input group). Text, not an input, so search engines and AI assistants
 * read it.
 */
export function CopyField({
  value,
  command = false,
  label,
  counted,
  className,
}: {
  value: string;
  /** A shell command: shown after a `$`. */
  command?: boolean;
  label?: string;
  counted?: Counted;
  className?: string;
}) {
  const { copied, copy } = useCopy(value, label, counted);
  return (
    <InputGroup className={className}>
      {command && (
        <InputGroupAddon>
          <InputGroupText className="font-mono">$</InputGroupText>
        </InputGroupAddon>
      )}
      <code
        data-slot="input-group-control"
        className="no-scrollbar min-w-0 flex-1 overflow-x-auto px-2.5 font-mono text-sm whitespace-nowrap"
      >
        {value}
      </code>
      <InputGroupAddon align="inline-end">
        <InputGroupButton size="icon-xs" onClick={copy} aria-label="Copy">
          {copied ? <Check /> : <Copy />}
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  );
}
