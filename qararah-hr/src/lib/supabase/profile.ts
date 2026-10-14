import type { SupabaseClient } from "@supabase/supabase-js";

type AccessFields = { user_roles?: string[] | null; additional_permissions?: string[] | null };

/** Read access-aware profile data while the additive-access migration is pending. */
export async function loadAccessProfile<T extends Record<string, unknown>>(
  supabase: SupabaseClient,
  userId: string,
  extendedColumns: string,
  legacyColumns: string,
): Promise<{ data: (T & AccessFields) | null; error: { message: string } | null; accessColumnsAvailable: boolean }> {
  const extended = await supabase.from("profiles").select(extendedColumns).eq("id", userId).maybeSingle();
  if (!extended.error) {
    return { data: extended.data as unknown as (T & AccessFields) | null, error: null, accessColumnsAvailable: true };
  }
  if (!/user_roles|additional_permissions/i.test(extended.error.message)) {
    return { data: null, error: extended.error, accessColumnsAvailable: false };
  }
  const legacy = await supabase.from("profiles").select(legacyColumns).eq("id", userId).maybeSingle();
  return {
    data: legacy.data ? { ...(legacy.data as unknown as T), user_roles: [], additional_permissions: [] } : null,
    error: legacy.error,
    accessColumnsAvailable: false,
  };
}
