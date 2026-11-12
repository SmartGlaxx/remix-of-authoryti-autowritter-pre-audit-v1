import { useEffect, useState } from "react";
import { Cpu, Loader2, RotateCcw, Save } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ACTIVE_ROLES, DRAFT_MODEL_KEYS, getModel, MODEL_REGISTRY, ROLE_LABELS, USER_ROLES, modelLabel, type Role } from "../../supabase/functions/_shared/ai/registry";
import { PROFILES, PROFILE_ROLE_LABELS, TIERS, writerTierOrDefault, type ProfileRole, type Tier } from "../../supabase/functions/_shared/writers/profiles";
import { draftModelFor, type BookModelConfig } from "../../supabase/functions/_shared/ai/roles";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

type Pipeline = { totalWords: number; per1kWordsUsd: number | null; totalUsd: number | null; note: string; roles: { role: ProfileRole; model: string; thinking: boolean; costUsd: number | null; per1kWordsUsd: number | null }[] };
type Estimate = { operation: string; model: string; estimatedCostUsd: number | null; note: string };

export function ModelConfigCard({ bookId, writerId }: { bookId: string; writerId: string }) {
  const [pricesAt, setPricesAt] = useState<string | null>(null);
  const [config, setConfig] = useState<BookModelConfig>({ mode: "legacy" });
  const [estimates, setEstimates] = useState<Estimate[]>([]);
  const [pipeline, setPipeline] = useState<Pipeline | null>(null);
  const [sources, setSources] = useState<string[]>([]);
  const [userKeys, setUserKeys] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const call = async (action: "get" | "save" | "reset" | "refresh_prices", cfg?: BookModelConfig) => {
    const { data, error } = await supabase.functions.invoke("model-config", { body: { action, bookId, config: cfg } });
    if (error || data?.error) throw new Error(data?.error || error?.message || "Request failed");
    setConfig(data.config);
    setEstimates(data.estimates ?? []);
    setUserKeys(data.userKeyProviders ?? []);
    setPricesAt(data.pricesFetchedAt ?? null);
    setPipeline(data.pipeline ?? null);
    setSources(data.pricesSources ?? []);
    return data;
  };

  useEffect(() => {
    setLoading(true);
    call("get")
      .then((d) => {
        // One-time carry-over of the old browser-only model picker.
        const old = localStorage.getItem("authoryti_ai_model");
        if (old) localStorage.removeItem("authoryti_ai_model");
      })
      .catch((e) => toast.error(e.message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId]);

  const [bookType, setBookType] = useState<string | null>(null);
  const [draftModel, setDraftModel] = useState<string>("anthropic/claude-sonnet-5");
  useEffect(() => {
    supabase.from("books").select("book_type, controls").eq("id", bookId).maybeSingle().then(({ data }) => {
      if (!data) return;
      setBookType(data.book_type);
      const saved = (data.controls as Record<string, unknown> | null)?.draftModel;
      setDraftModel(draftModelFor(typeof saved === "string" ? saved : null, data.book_type));
    });
  }, [bookId]);
  const draftLabel = modelLabel(draftModelFor(draftModel, bookType));
  const toggleDraft = async (next: string) => {
    setSaving(true);
    try {
      const { data } = await supabase.from("books").select("controls").eq("id", bookId).maybeSingle();
      const { error } = await supabase.from("books").update({ controls: { ...((data?.controls as Record<string, unknown>) ?? {}), draftModel: next } }).eq("id", bookId);
      if (error) throw error;
      setDraftModel(next);
      toast.success(`This book will be written with ${getModel(next)?.displayName ?? next}`);
    } catch (e) { toast.error((e as Error).message); } finally { setSaving(false); }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Cpu className="w-4 h-4 text-primary" />
          AI Models
        </CardTitle>
      </CardHeader>
      <CardContent className="min-w-0 space-y-4">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>
        ) : (
          <>
            <div className="flex items-start justify-between gap-4 rounded-md border border-border p-3">
              <div className="min-w-0">
                <Label htmlFor="draft-model" className="text-sm font-medium">Writing model</Label>
                <p className="text-xs text-muted-foreground">Prose is written by {draftLabel}. Every writer uses the same models — their personality and sliders make the difference.</p>
              </div>
              <Select value={draftModel} onValueChange={toggleDraft} disabled={saving}>
                <SelectTrigger id="draft-model" className="w-56 shrink-0"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {DRAFT_MODEL_KEYS.map((k) => { const m = getModel(k)!; return (
                    <SelectItem key={k} value={k}>{m.displayName} · ${m.pricing.inputPerM}/${m.pricing.outputPerM}{m.provider === "deepseek" ? " (your key)" : ""}</SelectItem>
                  ); })}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1 rounded-md border border-border p-3 text-xs">
              <p><span className="text-muted-foreground">Writing:</span> {draftLabel}</p>
              <p><span className="text-muted-foreground">Planning, checks, memory and repairs:</span> {modelLabel("openai/gpt-6-sol")}</p>
              <p><span className="text-muted-foreground">Pictures:</span> OpenAI image mini (low quality)</p>
            </div>

            {estimates.length > 0 && (
              <div className="rounded-md bg-muted/40 p-3 text-xs space-y-1">
                <p className="font-medium">Estimated cost (saved settings)</p>
                {estimates.map((e) => (
                  <p key={e.operation} className="text-muted-foreground">
                    {e.operation.replace("_", " ")}: {e.estimatedCostUsd != null ? `~$${e.estimatedCostUsd.toFixed(4)}` : "Estimate not available"} · {modelLabel(e.model)}{e.estimatedCostUsd != null ? ` · ${e.note}` : ""}
                  </p>
                ))}
                {pipeline && (
                  <div className="space-y-1 pt-2">
                    <p className="font-medium">Whole book (~{pipeline.totalWords.toLocaleString()} words): {pipeline.totalUsd != null ? `~$${pipeline.totalUsd.toFixed(2)}` : "Estimate not available"}{pipeline.per1kWordsUsd != null && ` · ~$${pipeline.per1kWordsUsd.toFixed(4)} per 1,000 words`}</p>
                    {pipeline.roles.map((r) => (
                      <p key={r.role} className="text-muted-foreground">{PROFILE_ROLE_LABELS[r.role]}: {r.costUsd != null ? `~$${r.costUsd.toFixed(2)}` : "Estimate not available"} · {modelLabel(r.model)}{r.thinking ? " (thinking)" : ""}</p>
                    ))}
                    <p className="text-muted-foreground">{pipeline.note}</p>
                  </div>
                )}
                <p className="text-muted-foreground">Prices {pricesAt ? `last checked ${new Date(pricesAt).toLocaleString()}` : "not checked yet"}{sources.length ? ` · from ${sources.join(", ")}` : ""}. Refreshed every 24 hours.</p>
              </div>
            )}

             <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="ghost" onClick={async () => { setSaving(true); try { await call("refresh_prices"); toast.success("Prices refreshed"); } catch (e) { toast.error((e as Error).message); } finally { setSaving(false); } }} disabled={saving}>Refresh prices</Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
