"use client";

import { Search, X } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { SortOrder } from "@/components/sort-order";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Spinner } from "@/components/ui/spinner";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

/** The Library's filters, as its URL carries them. */
const KEYS = ["q", "type", "tag", "shelf"] as const;
type Key = (typeof KEYS)[number];

/**
 * Search and the type over the Library's list: each change is a new URL, the
 * list staying on screen until the new one arrives. The search runs on
 * Enter: each one asks the server (a request and a counted call), so typing
 * costs none; it finds tags too, so there's no tag filter, though a link's
 * `?tag=` still narrows the list. The type is one click: All, Notes, or
 * Decisions (`types`: the counts by type).
 */
export function LibraryToolbar({ types }: { types: Record<string, number> }) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, start] = useTransition();
  const current = (key: Key) => params.get(key) ?? undefined;
  const [typed, setTyped] = useState(current("q") ?? "");
  const q = current("q") ?? "";
  // A search set elsewhere (Clear all, a link) is what the box shows.
  useEffect(() => setTyped(q), [q]);

  /** The list with `key` set (or cleared), from its first page, with no concept open. */
  const go = (changes: Partial<Record<Key, string | undefined>>) => {
    const next = new URLSearchParams();
    for (const key of KEYS) {
      const value = key in changes ? changes[key] : current(key);
      if (value) next.set(key, value);
    }
    // The toolbar is the Concepts view's: clearing it stays there, in its order.
    next.set("tab", "concepts");
    const sort = params.get("sort");
    if (sort) next.set("sort", sort);
    const query = `?${next}`;
    start(() => router.push(`/dashboard/concepts${query}`, { scroll: false }));
  };

  const shelf = current("shelf");
  const tag = current("tag");
  const active = Boolean(KEYS.some((k) => current(k)));
  // Two types; a concept filed before there were two counts as a Note.
  const decisions = types.Decision ?? 0;
  const notes = Object.entries(types)
    .filter(([t]) => t !== "Decision" && t !== "Thesaurus")
    .reduce((n, [, c]) => n + c, 0);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <SearchBox
          value={typed}
          onChange={setTyped}
          onEnter={() => typed.trim() !== q && go({ q: typed.trim() || undefined })}
          onClear={() => q && go({ q: undefined })}
          placeholder="Search your library"
        />
        <FilterChips
          label="Type"
          options={[
            { value: "Note", label: "Notes", count: notes },
            { value: "Decision", label: "Decisions", count: decisions },
          ]}
          value={current("type")}
          onPick={(v) => go({ type: v })}
        />
        {/* A search's results are by best match. */}
        {!q && <SortOrder />}
        {pending && <Spinner />}
      </div>
      {(shelf || tag || active) && (
        <div className="flex flex-wrap items-center gap-2">
          {tag && (
            <Badge variant="secondary">
              Tag: {tag}
              <button
                type="button"
                aria-label="Clear the tag"
                onClick={() => go({ tag: undefined })}
              >
                <X />
              </button>
            </Badge>
          )}
          {shelf && (
            <Badge variant="secondary">
              Shelf: <span className="font-mono">{shelf}</span>
              <button
                type="button"
                aria-label="Clear the shelf"
                onClick={() => go({ shelf: undefined })}
              >
                <X />
              </button>
            </Badge>
          )}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => go(Object.fromEntries(KEYS.map((k) => [k, undefined])))}
          >
            Clear all
          </Button>
        </div>
      )}
    </div>
  );
}

/** A filter's choice: its value, its word, and how many it would show. */
export type Chip = { value: string; label: string; count: number };

/**
 * A list's filter, the same on every tab: a few chips with counts. None
 * picked shows everything; a click picks one, and a second click on it
 * clears it. A chip with nothing to show is left out, unless it's picked.
 */
export function FilterChips({
  label,
  options,
  value,
  onPick,
}: {
  label: string;
  options: Chip[];
  value?: string;
  onPick: (value: string | undefined) => void;
}) {
  const shown = options.filter((o) => o.count > 0 || o.value === value);
  if (shown.length === 0) return null;
  return (
    <ToggleGroup
      variant="outline"
      aria-label={label}
      value={value ? [value] : []}
      onValueChange={(v: string[]) => onPick(v[0])}
    >
      {shown.map((o) => (
        <ToggleGroupItem key={o.value} value={o.value}>
          {o.label}
          <span className="text-muted-foreground tabular-nums">{o.count}</span>
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

/**
 * A list's search box: it filters as you type a list already on the page,
 * or, with `onEnter`, runs a search that asks the server.
 */
export function SearchBox({
  value,
  onChange,
  onEnter,
  onClear,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  /** Enter (a phone keyboard's Search key): run the search. */
  onEnter?: () => void;
  /** The X: after the box is emptied, for a search that has run. */
  onClear?: () => void;
  placeholder: string;
}) {
  return (
    <InputGroup className="min-w-48 flex-1">
      <InputGroupAddon>
        <Search />
      </InputGroupAddon>
      <InputGroupInput
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onEnter?.();
        }}
        enterKeyHint={onEnter ? "search" : undefined}
        placeholder={placeholder}
        aria-label={placeholder}
      />
      {value && (
        <InputGroupAddon align="inline-end">
          <InputGroupButton
            aria-label="Clear the search"
            onClick={() => {
              onChange("");
              onClear?.();
            }}
          >
            <X />
          </InputGroupButton>
        </InputGroupAddon>
      )}
    </InputGroup>
  );
}

/** Whether every word of `query` is in `text`, ignoring case. */
export const matchesWords = (text: string, query: string) => {
  const hay = text.toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => hay.includes(w));
};
