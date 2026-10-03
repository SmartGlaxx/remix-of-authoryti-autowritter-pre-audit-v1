import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Lock, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { WRITER_PORTRAITS } from "@/components/WriterPicker";
import { WRITER_PERSONAS } from "../../supabase/functions/_shared/writers/personas";
import { PROFILES, TIERS, PROFILE_ROLE_LABELS, type Tier, type ProfileRole } from "../../supabase/functions/_shared/writers/profiles";
import { SLIDERS, NEUTRAL, MAX_ADJUST, DIVERGENCE_OPTIONS, type SliderValues, type DivergenceMode } from "../../supabase/functions/_shared/writers/sliders";
import { WRITER_BASELINES } from "../../supabase/functions/_shared/writers/manifest";

const short = (id: string) => id.split("/")[1]?.replace(/-/g, " ") ?? id;

export default function TryWriter() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [writerId, setWriterId] = useState(WRITER_PERSONAS[0].id);
  const [tier, setTier] = useState<Tier>("balanced");
  const [divergence, setDivergence] = useState<DivergenceMode>("strict");
  const baseline = WRITER_BASELINES[writerId] ?? null;
  const [values, setValues] = useState<SliderValues>(baseline ?? NEUTRAL);
  const [premise, setPremise] = useState("");
  const [sample, setSample] = useState<{ text: string; model: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const writer = WRITER_PERSONAS.find((w) => w.id === writerId)!;
  const profile = PROFILES[writerId][tier];

  const pickWriter = (id: string) => { setWriterId(id); setValues(WRITER_BASELINES[id] ?? NEUTRAL); setSample(null); };
  const range = (key: keyof SliderValues) => baseline ? [Math.max(1, baseline[key] - MAX_ADJUST), Math.min(10, baseline[key] + MAX_ADJUST)] : [1, 10];
  const groups = useMemo(() => ({ tone: SLIDERS.filter((s) => s.group === "tone"), dynamism: SLIDERS.filter((s) => s.group === "dynamism") }), []);

  const run = async () => {
    setLoading(true); setSample(null);
    try {
      const { data, error } = await supabase.functions.invoke("try-writer", { body: { writerId, tier, premise, sliders: values, divergence, bookType: writer.bookTypes[0] } });
      const msg = (data as { error?: string })?.error || (error ? (await (error as { context?: Response }).context?.json?.().catch(() => null))?.error ?? error.message : null);
      if (msg) throw new Error(msg);
      setSample({ text: data.text, model: data.model });
    } catch (e) {
      toast({ title: "Couldn't write the sample", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 border-b border-border bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4">
          <Button variant="ghost" size="icon" onClick={() => navigate("/dashboard")} aria-label="Back"><ArrowLeft className="w-5 h-5" /></Button>
          <div className="min-w-0">
            <h1 className="text-xl font-serif font-semibold">Try a Writer</h1>
            <p className="truncate text-sm text-muted-foreground">Hear a writer's voice before you start a book. Nothing is saved.</p>
          </div>
        </div>
      </header>

      <main className="mx-auto grid w-full max-w-6xl gap-6 px-4 py-6 lg:grid-cols-[280px_1fr]">
        <aside className="grid grid-cols-2 gap-2 self-start sm:grid-cols-3 lg:grid-cols-1">
          {WRITER_PERSONAS.map((w) => (
            <button key={w.id} type="button" onClick={() => pickWriter(w.id)}
              className={`flex min-w-0 items-center gap-2 rounded-xl border p-2 text-left transition-colors ${w.id === writerId ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"}`}>
              <img src={WRITER_PORTRAITS[w.id]} alt={w.name} width={40} height={40} loading="lazy" className="h-10 w-10 shrink-0 rounded-full object-cover" />
              <div className="min-w-0"><div className="truncate text-sm font-medium">{w.name}</div><div className="truncate text-xs text-muted-foreground">{w.tagline}</div></div>
            </button>
          ))}
        </aside>

        <section className="min-w-0 space-y-6">
          <div className="flex flex-col gap-4 rounded-2xl border border-border p-4 sm:flex-row">
            <img src={WRITER_PORTRAITS[writer.id]} alt={writer.name} className="h-24 w-24 shrink-0 rounded-2xl object-cover" />
            <div className="min-w-0 space-y-1 text-sm">
              <h2 className="font-serif text-lg font-semibold">{writer.name}</h2>
              <p className="text-muted-foreground">{writer.personality}</p>
              <p><span className="text-muted-foreground">Signature:</span> {writer.signature}</p>
              <p><span className="text-muted-foreground">Best for:</span> {writer.bookTypes.join(", ")}</p>
            </div>
          </div>

          <div className="space-y-3">
            <h3 className="text-sm font-medium">Tier</h3>
            <div className="flex flex-wrap gap-2">
              {TIERS.map((t) => <Button key={t.value} size="sm" variant={t.value === tier ? "default" : "outline"} className="rounded-full" onClick={() => setTier(t.value)}>{t.label}</Button>)}
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {(Object.keys(PROFILE_ROLE_LABELS) as ProfileRole[]).map((r) => (
                <div key={r} className="rounded-lg border border-border p-2 text-xs">
                  <div className="flex items-center gap-1 text-muted-foreground"><Lock className="h-3 w-3" />{PROFILE_ROLE_LABELS[r]}</div>
                  <div className="truncate font-medium capitalize">{short(profile[r].model)}</div>
                  {profile[r].mode && <div className="text-muted-foreground">{profile[r].mode}</div>}
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-sm font-medium">Expression</h3>
              <span className="text-xs text-muted-foreground">{baseline ? `Each slider moves up to ±${MAX_ADJUST} from ${writer.name.split(" ")[0]}'s natural voice` : "Writer starting values are not set yet — sliders are free for now"}</span>
            </div>
            {(["tone", "dynamism"] as const).map((g) => (
              <div key={g} className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
                {groups[g].map((s) => { const [lo, hi] = range(s.key); return (
                  <div key={s.key} className="space-y-1.5">
                    <div className="flex justify-between text-xs"><span>{s.label}</span><span className="text-muted-foreground">{values[s.key]}</span></div>
                    <Slider min={lo} max={hi} step={1} value={[values[s.key]]} onValueChange={([v]) => setValues((p) => ({ ...p, [s.key]: v }))} />
                    <div className="flex justify-between text-[10px] text-muted-foreground"><span>{s.low}</span><span>{s.high}</span></div>
                  </div>
                ); })}
              </div>
            ))}
            <div className="flex flex-wrap gap-2 pt-2">
              <span className="self-center text-xs text-muted-foreground">Story divergence:</span>
              {DIVERGENCE_OPTIONS.map((d) => <Button key={d.value} size="sm" variant={d.value === divergence ? "secondary" : "ghost"} className="rounded-full" title={d.description} onClick={() => setDivergence(d.value)}>{d.label}</Button>)}
            </div>
          </div>

          <div className="space-y-2">
            <h3 className="text-sm font-medium">Premise</h3>
            <Textarea value={premise} maxLength={600} onChange={(e) => setPremise(e.target.value)} placeholder="A retired lighthouse keeper finds a letter addressed to her, dated fifty years in the future…" rows={3} />
            <Button className="rounded-full" onClick={run} disabled={loading || !premise.trim()}>
              {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}Write a sample
            </Button>
          </div>

          {sample && (
            <article className="space-y-3 rounded-2xl border border-border bg-card p-5">
              <p className="whitespace-pre-line font-serif leading-relaxed">{sample.text}</p>
              <p className="text-xs text-muted-foreground">Written by {writer.name} · {TIERS.find((t) => t.value === tier)?.label} · {short(sample.model)}</p>
              <Button variant="outline" className="rounded-full" onClick={() => navigate(`/dashboard?writer=${writerId}&tier=${tier}`)}>Use {writer.name.split(" ")[0]} — {TIERS.find((t) => t.value === tier)?.label}</Button>
            </article>
          )}
        </section>
      </main>
    </div>
  );
}
