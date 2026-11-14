import { supabase } from "@/integrations/supabase/client";
import { buildSpec, composeDeterministic, extractFeatures } from "../../../supabase/functions/_shared/pageDesign/compose";
import { validateChoice, validateSpec } from "../../../supabase/functions/_shared/pageDesign/validate";
import { compatibleLayouts } from "./layoutCatalog";
import type { CompositionChoice, CompositionMode, PageCompositionInput, PageCompositionSpec } from "@/types/pageDesign";

export type Invoke = (name: string, body: unknown) => Promise<{ data: any; error: any }>;
const defaultInvoke: Invoke = (name, body) => supabase.functions.invoke(name, { body: body as Record<string, unknown> });

/**
 * Composes one page in the requested mode. Dynamic AI uses the compose-page backend function;
 * any AI failure or invalid answer yields a deterministic spec whose provenance discloses it.
 */
export async function composePage(input: PageCompositionInput, mode: CompositionMode, bookId: string, invoke: Invoke = defaultInvoke): Promise<PageCompositionSpec> {
  if (mode !== "dynamic-ai") {
    const s = composeDeterministic(input, mode);
    return { ...s, provenance: { ...s.provenance, createdAt: new Date().toISOString() } };
  }
  const features = extractFeatures(input.text, input.images);
  let reason = "";
  try {
    const { data, error } = await invoke("compose-page", { bookId, pageKey: input.pageKey, styleFamily: input.settings.styleFamily, accentFamily: input.settings.accentFamily, imageCount: input.images.length, features, recentLayouts: input.recentLayouts, heading: input.heading, excerpt: input.text.slice(0, 2400) });
    if (error || !data?.choice) reason = data?.error || (error?.message ?? "AI service unavailable");
    else {
      const candidates = compatibleLayouts(input.bookType, input.images.length).map((l) => l.id);
      const v = validateChoice(data.choice, { candidates, styleFamily: input.settings.styleFamily, accentFamily: input.settings.accentFamily });
      if (!v.ok) reason = `AI answer rejected: ${v.errors.join("; ")}`;
      else {
        const spec = buildSpec(input, v.value as CompositionChoice, { source: "ai", mode, model: String(data.model || "unknown"), rationale: v.value!.rationale, createdAt: new Date().toISOString() });
        const sv = validateSpec(spec); if (sv.ok) return spec; reason = `AI spec invalid: ${sv.errors.join("; ")}`;
      }
    }
  } catch (e) { reason = e instanceof Error ? e.message : "AI service unavailable"; }
  const s = composeDeterministic(input, mode, reason || "AI unavailable");
  return { ...s, provenance: { ...s.provenance, createdAt: new Date().toISOString() } };
}
