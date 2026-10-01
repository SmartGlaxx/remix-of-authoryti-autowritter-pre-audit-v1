import { useEffect, useState } from "react";
import { Cpu, Loader2, RotateCcw, Save } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ACTIVE_ROLES, MODEL_REGISTRY, ROLE_LABELS, USER_ROLES, modelLabel, type Role } from "../../supabase/functions/_shared/ai/registry";
import { PROFILES, PROFILE_ROLE_LABELS, TIERS, type ProfileRole, type Tier } from "../../supabase/functions/_shared/writers/profiles";
import { OPTIMIZED_LABEL, resolveModelForRole, type BookModelConfig, type ConfigMode } from "../../supabase/functions/_shared/ai/roles";

type Estimate = { operation: string; model: string; estimatedCostUsd: number | null; note: string };

const MODE_OPTIONS: { value: ConfigMode; label: string; desc: string }[] = [
  { value: "profile", label: "Writer profile", desc: "Fixed models tuned for this book's writer. Pick a tier; models are locked." },
  { value: "legacy", label: "Standard (current setup)", desc: "Keeps the models this book has always used." },
  { value: "optimized", label: OPTIMIZED_LABEL, desc: "A preset workflow that gives each job its own model." },
  { value: "single", label: "One model for everything", desc: "Use a single model for every job." },
  { value: "custom", label: "Custom per job", desc: "Pick a model for each job yourself." },
];

const NONE = "__none__";
const selectable = MODEL_REGISTRY.filter((m) => !m.legacyOnly);

export function ModelConfigCard({ bookId, writerId }: { bookId: string; writerId: string }) {
  const [pricesAt, setPricesAt] = useState<string | null>(null);
  const [config, setConfig] = useState<BookModelConfig>({ mode: "legacy" });
  const [estimates, setEstimates] = useState<Estimate[]>([]);
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
    return data;
  };

  useEffect(() => {
    setLoading(true);
    call("get")
      .then((d) => {
        // One-time carry-over of the old browser-only model picker.
        const old = localStorage.getItem("authoryti_ai_model");
        const map: Record<string, string> = { "gpt-6-astra": "openai/gpt-6-astra", "gemini-3.1-pro": "google/gemini-3.1-pro-preview", "gemini-3.8-flash": "google/gemini-3.8-flash" };
        if (!d.saved && old && map[old]) setConfig({ ...d.config, mode: "custom", roleModels: { writer: map[old] } });
      })
      .catch((e) => toast.error(e.message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId]);

  const save = async () => {
    setSaving(true);
    try { await call("save", config); toast.success("Model settings saved"); } catch (e) { toast.error((e as Error).message); } finally { setSaving(false); }
  };
  const reset = async () => {
    setSaving(true);
    try { await call("reset"); toast.success("Restored defaults"); } catch (e) { toast.error((e as Error).message); } finally { setSaving(false); }
  };

  const setRole = (role: Role, model: string) => setConfig((c) => ({ ...c, mode: "custom", roleModels: { ...(c.roleModels ?? {}), [role]: model } }));
  const setFallback = (role: Role, model: string) => setConfig((c) => {
    const f = { ...(c.fallbacks ?? {}) };
    if (model === NONE) delete f[role]; else f[role] = model;
    return { ...c, fallbacks: f };
  });

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
            <div className="grid gap-2 sm:grid-cols-2">
              {MODE_OPTIONS.map((m) => (
                <button
                  key={m.value}
                  type="button"
                  onClick={() => setConfig((c) => ({ ...c, mode: m.value, ...(m.value === "profile" ? { profileWriter: writerId, profileTier: c.profileTier ?? "balanced" } : {}) }))}
                  className={`text-left rounded-md border p-3 transition-colors ${config.mode === m.value ? "border-primary bg-primary/10" : "border-border hover:border-primary/50"}`}
                >
                  <p className="text-sm font-medium">{m.label}</p>
                  <p className="text-xs text-muted-foreground">{m.desc}</p>
                </button>
              ))}
            </div>

            {config.mode === "profile" && PROFILES[writerId] && (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {TIERS.map((t) => (
                    <Button key={t.value} type="button" size="sm" variant={config.profileTier === t.value ? "default" : "outline"} onClick={() => setConfig((c) => ({ ...c, profileWriter: writerId, profileTier: t.value as Tier }))}>{t.label}</Button>
                  ))}
                </div>
                {config.profileTier && (
                  <div className="grid gap-1 rounded-md border border-border p-3 text-xs">
                    {(Object.keys(PROFILE_ROLE_LABELS) as ProfileRole[]).map((r) => {
                      const slot = PROFILES[writerId][config.profileTier as Tier][r];
                      return <p key={r} className="break-words"><span className="text-muted-foreground">{PROFILE_ROLE_LABELS[r]}:</span> {modelLabel(slot.model)}{slot.mode ? ` (${slot.mode})` : ""}</p>;
                    })}
                    <p className="pt-1 text-muted-foreground">Models in a profile are fixed and can't be changed individually.</p>
                  </div>
                )}
              </div>
            )}

            {config.mode === "single" && (
              <Select value={config.singleModel ?? undefined} onValueChange={(v) => setConfig((c) => ({ ...c, singleModel: v }))}>
                <SelectTrigger className="min-w-0"><SelectValue placeholder="Choose a model" /></SelectTrigger>
                <SelectContent>{selectable.map((m) => <SelectItem key={m.key} value={m.key}>{modelLabel(m.key)}</SelectItem>)}</SelectContent>
              </Select>
            )}

            {config.mode !== "profile" && <div className="space-y-2">
              {USER_ROLES.map((role) => {
                const r = resolveModelForRole(config, role);
                const active = ACTIVE_ROLES.includes(role);
                const provider = MODEL_REGISTRY.find((m) => m.key === r.model)?.provider;
                return (
                  <div key={role} className="grid min-w-0 grid-cols-1 items-center gap-2 rounded-md border border-border p-2 lg:grid-cols-[1fr_1.4fr_1.2fr]">
                    <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm">
                      {ROLE_LABELS[role]}
                      {!active && <Badge variant="outline" className="text-[10px]">Not active yet</Badge>}
                    </div>
                    <Select value={r.model} onValueChange={(v) => setRole(role, v)} disabled={config.mode === "legacy"}>
                      <SelectTrigger className="h-8 min-w-0 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>{selectable.map((m) => <SelectItem key={m.key} value={m.key}>{modelLabel(m.key)}</SelectItem>)}</SelectContent>
                    </Select>
                    <Select value={config.fallbacks?.[role] ?? NONE} onValueChange={(v) => setFallback(role, v)}>
                      <SelectTrigger className="h-8 min-w-0 text-xs"><SelectValue placeholder="No fallback" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE}>{config.mode === "legacy" && r.fallback ? `Default fallback: ${modelLabel(r.fallback)}` : "No fallback (stop on failure)"}</SelectItem>
                        {selectable.map((m) => <SelectItem key={m.key} value={m.key}>Fallback: {modelLabel(m.key)}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    {provider && userKeys.includes(provider) && <p className="text-[11px] text-muted-foreground lg:col-span-3">Uses your own {provider} key</p>}
                  </div>
                );
              })}
            </div>}

            {estimates.length > 0 && (
              <div className="rounded-md bg-muted/40 p-3 text-xs space-y-1">
                <p className="font-medium">Estimated cost (saved settings)</p>
                {estimates.map((e) => (
                  <p key={e.operation} className="text-muted-foreground">
                    {e.operation.replace("_", " ")}: {e.estimatedCostUsd != null ? `~$${e.estimatedCostUsd.toFixed(4)}` : "unknown"} · {modelLabel(e.model)} · {e.note}
                  </p>
                ))}
                <p className="text-muted-foreground">Prices {pricesAt ? `last checked ${new Date(pricesAt).toLocaleString()}` : "not checked yet"}. Refreshed every 24 hours.</p>
              </div>
            )}

             <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={save} disabled={saving} className="gap-1.5"><Save className="w-3.5 h-3.5" /> Save</Button>
              <Button size="sm" variant="outline" onClick={reset} disabled={saving} className="gap-1.5"><RotateCcw className="w-3.5 h-3.5" /> Restore defaults</Button>
              <Button size="sm" variant="ghost" onClick={async () => { setSaving(true); try { await call("refresh_prices"); toast.success("Prices refreshed"); } catch (e) { toast.error((e as Error).message); } finally { setSaving(false); } }} disabled={saving}>Refresh prices</Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
