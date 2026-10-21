import { useState } from "react";
import { ChevronLeft, ChevronRight, Lock, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { BoundedSlider, offsetLabel } from "@/components/BoundedSlider";
import { WRITER_PORTRAITS } from "@/components/WriterPortraits";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { WRITER_PERSONAS } from "../../supabase/functions/_shared/writers/personas";
import { PROFILES, TIERS, PROFILE_ROLE_LABELS, DEFAULT_WRITER_TIER, type Tier, type ProfileRole } from "../../supabase/functions/_shared/writers/profiles";
import { SLIDERS, NEUTRAL, MAX_ADJUST, DIVERGENCE_OPTIONS, type SliderValues, type DivergenceMode } from "../../supabase/functions/_shared/writers/sliders";
import { WRITER_BASELINES } from "../../supabase/functions/_shared/writers/manifest";

const short = (id: string) => id.split("/")[1]?.replace(/-/g, " ") ?? id;
const defaults = (id: string): SliderValues => ({ ...(WRITER_BASELINES[id] ?? NEUTRAL) });

export function WriterStudio({ initialWriterId, bookType, onUse }: { initialWriterId?: string; bookType?: string; onUse?: (id: string, tier: Tier) => void }) {
  const { toast } = useToast();
  const [writerId, setWriterId] = useState(() => WRITER_PERSONAS.some((w) => w.id === initialWriterId) ? initialWriterId as string : WRITER_PERSONAS[0].id);
  const [tier, setTier] = useState<Tier>(DEFAULT_WRITER_TIER);
  const [modeValues, setModeValues] = useState<Partial<Record<Tier, SliderValues>>>({});
  const [divergence, setDivergence] = useState<DivergenceMode>("strict");
  const [premise, setPremise] = useState("");
  const [sample, setSample] = useState<{ text: string; model: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const writerIndex = WRITER_PERSONAS.findIndex((w) => w.id === writerId);
  const writer = WRITER_PERSONAS[writerIndex] ?? WRITER_PERSONAS[0];
  const baseline = WRITER_BASELINES[writer.id];
  const values = modeValues[tier] ?? defaults(writer.id);

  const selectWriter = (id: string) => {
    setWriterId(id);
    setModeValues({});
    setSample(null);
  };
  const selectTier = (next: Tier) => { setTier(next); setSample(null); };
  const changeValue = (key: keyof SliderValues, value: number) => {
    setModeValues((prev) => ({ ...prev, [tier]: { ...(prev[tier] ?? defaults(writer.id)), [key]: value } }));
    setSample(null);
  };
  const run = async () => {
    if (!premise.trim() || loading) return;
    setLoading(true);
    setSample(null);
    try {
      const { data, error } = await supabase.functions.invoke("try-writer", { body: { writerId: writer.id, tier, premise, sliders: values, divergence, bookType: bookType ?? writer.bookTypes[0] } });
      const msg = (data as { error?: string })?.error || (error ? (await (error as { context?: Response }).context?.json?.().catch(() => null))?.error ?? error.message : null);
      if (msg) throw new Error(msg);
      setSample({ text: data.text, model: data.model });
    } catch (e) {
      toast({ title: "Couldn't write the sample", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally { setLoading(false); }
  };

  return (
    <div className="min-w-0 space-y-5">
      <div className="flex items-center gap-2 border-b border-border pb-5 sm:gap-4">
        <Button size="icon" variant="outline" aria-label="Previous writer" title="Previous writer" className="shrink-0" onClick={() => selectWriter(WRITER_PERSONAS[(writerIndex - 1 + WRITER_PERSONAS.length) % WRITER_PERSONAS.length].id)}><ChevronLeft className="h-5 w-5" /></Button>
        <div className="flex min-w-0 flex-1 items-center gap-3 sm:gap-4">
          <img src={WRITER_PORTRAITS[writer.id]} alt="" className="h-14 w-14 shrink-0 rounded-sm object-cover sm:h-20 sm:w-20" />
          <div className="min-w-0"><h2 className="font-serif text-xl font-semibold sm:text-2xl">{writer.name}</h2><p className="text-sm text-muted-foreground">{writer.tagline}</p><p className="mt-1 hidden text-xs text-muted-foreground sm:block">{writer.bookTypes.join(" · ")}</p></div>
        </div>
        <Button size="icon" variant="outline" aria-label="Next writer" title="Next writer" className="shrink-0" onClick={() => selectWriter(WRITER_PERSONAS[(writerIndex + 1) % WRITER_PERSONAS.length].id)}><ChevronRight className="h-5 w-5" /></Button>
      </div>

      <div className="grid min-w-0 gap-5 lg:grid-cols-[220px_minmax(0,1fr)_260px] xl:grid-cols-[240px_minmax(0,1fr)_290px]">
        <aside className="min-w-0 space-y-2" aria-label="Writer modes">
          <h3 className="text-sm font-semibold">Premier pipeline</h3>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-1">
            {TIERS.map((t) => (
              <Button key={t.value} type="button" variant="ghost" onClick={() => selectTier(t.value)} aria-pressed={tier === t.value}
                className={`h-auto min-w-0 flex-col items-stretch justify-start gap-2 rounded-sm border p-3 text-left whitespace-normal ${tier === t.value ? "border-primary bg-primary/10" : "border-border bg-card hover:border-primary/40"}`}>
                <span className="font-medium">{t.label}</span>
                <span className="space-y-1 text-xs font-normal text-muted-foreground">
                  {(Object.keys(PROFILE_ROLE_LABELS) as ProfileRole[]).map((role) => (
                    <span key={role} className="block break-words leading-snug"><span className="inline-flex items-center gap-1"><Lock className="h-3 w-3" />{PROFILE_ROLE_LABELS[role]}:</span> <span className="text-foreground">{short(PROFILES[writer.id][t.value][role].model)}</span></span>
                  ))}
                </span>
              </Button>
            ))}
          </div>
        </aside>

        <section className="min-w-0 space-y-4" aria-label="Writer sample">
          <div className="space-y-1"><h3 className="text-sm font-semibold">{writer.name}'s voice</h3><p className="text-sm text-muted-foreground">{writer.personality} {writer.signature}</p></div>
          <div className="space-y-2">
            <label htmlFor="writer-premise" className="text-sm font-medium">Premise</label>
            <Textarea id="writer-premise" value={premise} maxLength={600} rows={6} onChange={(e) => setPremise(e.target.value)} placeholder="A retired lighthouse keeper finds a letter addressed to her, dated fifty years in the future…" />
            <Button onClick={run} disabled={loading || !premise.trim()}>{loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}Write a sample</Button>
          </div>
          {sample && <article className="space-y-3 border-t border-border pt-4"><p className="whitespace-pre-line font-serif leading-relaxed">{sample.text}</p><p className="text-xs text-muted-foreground">{writer.name} · {TIERS.find((t) => t.value === tier)?.label} · {short(sample.model)}</p>{onUse && <Button variant="outline" onClick={() => onUse(writer.id, tier)}>Use {writer.name.split(" ")[0]} — {TIERS.find((t) => t.value === tier)?.label}</Button>}</article>}
        </section>

        <aside className="min-w-0 space-y-4 lg:border-l lg:border-border lg:pl-5" aria-label="Expression settings">
          <div><h3 className="text-sm font-semibold">{TIERS.find((t) => t.value === tier)?.label} expression</h3><p className="text-xs text-muted-foreground">{writer.name.split(" ")[0]}'s starting values. Adjust each by up to ±{MAX_ADJUST}.</p></div>
          {SLIDERS.map((s) => <div key={s.key} className="space-y-1">
            <div className="flex justify-between gap-2 text-xs"><span>{s.label}</span><span className="shrink-0 text-muted-foreground">{values[s.key]}/10{offsetLabel(values[s.key], baseline?.[s.key])}</span></div>
            <BoundedSlider label={s.label} range={[Math.max(1, (baseline?.[s.key] ?? 5) - MAX_ADJUST), Math.min(10, (baseline?.[s.key] ?? 5) + MAX_ADJUST)]} base={baseline?.[s.key]} value={values[s.key]} onChange={(v) => changeValue(s.key, v)} />
          </div>)}
          <div className="space-y-2 pt-2"><h4 className="text-xs font-medium">Story divergence</h4><div className="flex flex-wrap gap-1">{DIVERGENCE_OPTIONS.map((d) => <Button key={d.value} size="sm" variant={d.value === divergence ? "secondary" : "ghost"} title={d.description} onClick={() => { setDivergence(d.value); setSample(null); }}>{d.label}</Button>)}</div></div>
        </aside>
      </div>
    </div>
  );
}