"use server";

import { fetchAction, fetchMutation } from "convex/nextjs";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getToken } from "@/lib/auth-server";
import { sourceHref } from "@/lib/hrefs";
import { api } from "../../../../convex/_generated/api";
import { errorMessage } from "../../../lib/convex-error";

/** Delete one kept source and its text, then back to the Library. The page confirms before calling. */
export async function deleteSource(form: FormData): Promise<void> {
  const id = String(form.get("id") ?? "");
  let query = "";
  if (id && process.env.NEXT_PUBLIC_CONVEX_URL) {
    try {
      const token = await getToken();
      await fetchMutation(api.sources.remove, { id }, { token });
      query = "?tab=files&done=deleted";
    } catch (exc) {
      query = `?error=${encodeURIComponent(errorMessage(exc, "the source could not be deleted"))}`;
    }
  }
  revalidatePath("/dashboard/concepts");
  redirect(`/dashboard/concepts${query}`);
}

/** The reading list: librocat fetches the page and keeps its text (paid plans), then opens it. */
export async function saveLink(form: FormData): Promise<void> {
  const url = String(form.get("url") ?? "").trim();
  let query = "";
  let saved: string | null = null;
  if (url && process.env.NEXT_PUBLIC_CONVEX_URL) {
    try {
      const token = await getToken();
      const kept = (await fetchAction(api.fetching.saveLink, { url }, { token })) as {
        id: string;
        title?: string;
      };
      saved = kept.id;
    } catch (exc) {
      query = `?error=${encodeURIComponent(errorMessage(exc, "the page could not be saved"))}`;
    }
  }
  revalidatePath("/dashboard/concepts");
  if (saved) redirect(`${sourceHref(saved)}?done=saved`);
  redirect(`/dashboard/concepts${query}`);
}

/** An upload URL for one file: the browser sends the bytes straight to storage. */
export async function startUpload(file: {
  name: string;
  type: string;
  size: number;
}): Promise<{ url?: string; type?: string; error?: string }> {
  try {
    const token = await getToken();
    const r = await fetchMutation(api.sources.uploadUrl, file, { token });
    if ("error" in r) return { error: r.error };
    return { url: r.upload_url, type: r.content_type };
  } catch (exc) {
    return { error: errorMessage(exc, "the file could not be uploaded") };
  }
}

/**
 * Attach an uploaded file to the library; librocat reads it. It doesn't
 * revalidate: that would render the page again for every file, and the
 * browser opens a fresh page once the last one is in (attach-files.tsx,
 * and an import's refresh).
 */
export async function finishUpload(upload: {
  storageId: string;
  name: string;
  title?: string;
  id?: string;
  location?: string;
}): Promise<{ id?: string; error?: string }> {
  try {
    const token = await getToken();
    const r = (await fetchMutation(api.sources.attach, upload, { token })) as { id: string };
    return { id: r.id };
  } catch (exc) {
    return { error: errorMessage(exc, "the file could not be attached") };
  }
}
