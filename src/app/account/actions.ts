"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { supabaseAdmin } from "@/lib/supabase-admin";

export type AccountActionState = {
  ok: boolean;
  message: string;
  signatureUrl?: string;
};

async function getCurrentUserId() {
  const session = await auth();
  if (!session?.user?.oid) {
    throw new Error("Not signed in.");
  }

  const { data: user, error } = await supabaseAdmin()
    .from("users")
    .select("id")
    .eq("m365_oid", session.user.oid)
    .single();

  if (error || !user) {
    throw new Error("Could not find the signed-in user in Supabase.");
  }

  return user.id as string;
}

export async function updatePosition(
  _prevState: AccountActionState,
  formData: FormData,
): Promise<AccountActionState> {
  try {
    const userId = await getCurrentUserId();
    const position = String(formData.get("position") ?? "").trim();

    const { error } = await supabaseAdmin()
      .from("users")
      .update({ position: position || null })
      .eq("id", userId);

    if (error) throw new Error(error.message);

    revalidatePath("/account");
    return { ok: true, message: "Position saved." };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "Could not save position.",
    };
  }
}

export async function saveSignature(
  formData: FormData,
): Promise<AccountActionState> {
  try {
    const userId = await getCurrentUserId();
    const file = formData.get("signature");

    if (!(file instanceof File) || file.size === 0) {
      throw new Error("Add a signature before saving.");
    }

    const path = `${userId}.png`;
    const bytes = Buffer.from(await file.arrayBuffer());
    const storage = supabaseAdmin().storage.from("signatures");

    const { error: uploadError } = await storage.upload(path, bytes, {
      contentType: "image/png",
      cacheControl: "3600",
      upsert: true,
    });

    if (uploadError) throw new Error(uploadError.message);

    const {
      data: { publicUrl },
    } = storage.getPublicUrl(path);

    const { error: updateError } = await supabaseAdmin()
      .from("users")
      .update({ signature_path: publicUrl })
      .eq("id", userId);

    if (updateError) throw new Error(updateError.message);

    revalidatePath("/account");
    return {
      ok: true,
      message: "Signature saved.",
      signatureUrl: publicUrl,
    };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "Could not save signature.",
    };
  }
}
