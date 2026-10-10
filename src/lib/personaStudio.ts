import { supabase } from "@/integrations/supabase/client";

export {
  PERSONA_DOMAINS, NARRATIVE_ROLES, checkLifeChronology,
  type PersonaDomain, type NarrativeRole, type PersonaSuggestion, type PersonaDraft, type AuthorFact, type PersonaField,
} from "../../supabase/functions/_shared/narrative/personaGeneration";
export { resolveIdentity, type IdentityResolution } from "../../supabase/functions/_shared/narrative/identityResolution";

export type StudioResult = { status?: string; error?: string; [k: string]: any };

/** Calls the Persona Studio server. Returns the JSON body even for 409/422 so the UI can react. */
export async function personaStudio(action: string, payload: Record<string, unknown> = {}): Promise<{ httpStatus: number; data: StudioResult }> {
  const { data: { session } } = await supabase.auth.getSession();
  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/persona-studio`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${session?.access_token ?? ""}`,
    },
    body: JSON.stringify({ action, ...payload }),
  });
  let data: StudioResult = {};
  try { data = await res.json(); } catch { data = { error: "Unexpected response" }; }
  return { httpStatus: res.status, data };
}

export const labelOf = (s: string) => s.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
