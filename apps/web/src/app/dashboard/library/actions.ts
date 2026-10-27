"use server";

import { fetchAction, fetchMutation } from "convex/nextjs";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getToken } from "@/lib/auth-server";
import { errorMessage } from "@/lib/convex-error";
import { type FilePart, fileParts } from "@/lib/export-parts";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";

export type LibraryResult = { ok: true } | { ok: false; error: string };

async function run(fn: (token: string | undefined) => Promise<unknown>): Promise<LibraryResult> {
  try {
    await fn(await getToken());
    // Every dashboard page shows the current library.
    revalidatePath("/dashboard", "layout");
    return { ok: true };
  } catch (exc) {
    return { ok: false, error: errorMessage(exc) };
  }
}

/** Show another of your libraries on the dashboard. Agents keep their own. */
export async function switchLibrary(id: string): Promise<LibraryResult> {
  return run((token) =>
    fetchMutation(api.workspaces.switchLibrary, { id: id as Id<"workspaces"> }, { token }),
  );
}

/** A new library, then its Connect page, which shows the URL that reaches it. */
export async function createLibrary(name: string): Promise<LibraryResult> {
  const result = await run((token) =>
    fetchMutation(api.workspaces.createLibrary, { name }, { token }),
  );
  if (result.ok) redirect("/dashboard/connect?done=created");
  return result;
}

export async function renameLibrary(name: string): Promise<LibraryResult> {
  return run((token) => fetchMutation(api.workspaces.renameLibrary, { name }, { token }));
}

/** Delete a library for good, then back to the Overview of another. */
export async function deleteLibrary(id: string): Promise<LibraryResult> {
  const result = await run((token) =>
    fetchMutation(api.workspaces.deleteLibrary, { id: id as Id<"workspaces"> }, { token }),
  );
  if (result.ok) redirect("/dashboard/concepts?done=removed");
  return result;
}

/** Leave a library someone else owns, then back to the Library of another. */
export async function leaveLibrary(id: string): Promise<LibraryResult> {
  const result = await run((token) =>
    fetchMutation(api.workspaces.leaveLibrary, { id: id as Id<"workspaces"> }, { token }),
  );
  if (result.ok) redirect("/dashboard/concepts?done=left");
  return result;
}

/** An upload URL for a zip to import (convex/imports.ts). */
export async function startImport(size: number): Promise<{ url?: string; error?: string }> {
  try {
    const token = await getToken();
    return await fetchMutation(api.imports.uploadUrl, { size }, { token });
  } catch (exc) {
    return { error: errorMessage(exc, "the zip could not be uploaded") };
  }
}

export type ImportResult = {
  concepts: number;
  terms: number;
  sources: number;
  failed: number;
  failures: { id: string; error: string }[];
};

/** Import an uploaded zip into the open library (convex/importZip.ts). */
export async function finishImport(
  storageId: string,
): Promise<{ result?: ImportResult; error?: string }> {
  try {
    const token = await getToken();
    const result = await fetchAction(
      api.importZip.run,
      { storageId: storageId as Id<"_storage"> },
      { token },
    );
    revalidatePath("/dashboard", "layout");
    return { result };
  } catch (exc) {
    return { error: errorMessage(exc, "the import failed") };
  }
}

/** Export's file parts (src/lib/export-parts.ts), from the attached files' sizes. */
export async function exportParts(): Promise<{ parts?: FilePart[]; error?: string }> {
  try {
    const token = await getToken();
    const files: { id: string; bytes: number }[] = [];
    let cursor: string | null = null;
    do {
      const page: { files: { id: string; bytes: number }[]; cursor: string | null } =
        await fetchMutation(api.sources.exportFileSizes, { cursor }, { token });
      files.push(...page.files);
      cursor = page.cursor;
    } while (cursor);
    return { parts: fileParts(files) };
  } catch (exc) {
    return { error: errorMessage(exc, "the export's parts could not be listed") };
  }
}
