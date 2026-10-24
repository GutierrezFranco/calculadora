"use server";

import { createClient } from "@/lib/supabase/server";

export type FormState = { ok: boolean; message: string } | null;

export async function changePassword(_prev: FormState, formData: FormData): Promise<FormState> {
  const password = String(formData.get("password") ?? "");
  if (password.length < 8) return { ok: false, message: "La contraseña tiene que tener al menos 8 caracteres" };
  if (password !== formData.get("confirm")) return { ok: false, message: "Las contraseñas no coinciden" };
  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { ok: false, message: error.message };
  return { ok: true, message: "Contraseña cambiada" };
}
