import { useState } from "react";
import { ArrowLeft, Loader2, Lock, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { BoundedSlider, offsetLabel } from "@/components/BoundedSlider";
import { WRITER_PORTRAITS } from "@/components/WriterPicker";
import { WRITER_PERSONAS } from "../../supabase/functions/_shared/writers/personas";
import { SLIDERS, MAX_ADJUST, DIVERGENCE_OPTIONS, type SliderValues, type DivergenceMode } from "../../supabase/functions/_shared/writers/sliders";
import { WRITER_BASELINES } from "../../supabase/functions/_shared/writers/manifest";
import { AUDIENCE_OPTIONS, BOOK_TYPE_AUDIENCES, BOOK_TYPE_GENRES, BOOK_TYPE_INFO, ENABLED_BOOK_TYPES, type BookType, type CreateBookInput } from "@/types/book";

export interface BookIdea {
  title: string; subtitle: string; description: string; bookType: BookType; genre: string; audience: string;
  writerId: string; whyThisWriter: string; divergence: DivergenceMode; sliders: SliderValues | null;
}

const catalog = () => Object.fromEntries(ENABLED_BOOK_TYPES.map((t) => [t, { audiences: BOOK_TYPE_AUDIENCES[t] ?? AUDIENCE_OPTIONS.map((a) => a.value), genres: BOOK_TYPE_GENRES[t] ?? [] }]));
const audienceLabel = (v: string) => AUDIENCE_OPTIONS.find((a) => a.value === v)?.label ?? v;

/** Idea → Creation Engine pre-fill (15 sliders mapped onto the book's tone/controls fields). */
export function ideaToInput(i: BookIdea): Partial<CreateBookInput> {
  const s = i.sliders ?? WRITER_BASELINES[i.writerId]!;
  return {
    title: i.title, subtitle: i.subtitle || undefined, theme: i.description, bookType: i.bookType, genre: i.genre || undefined, audience: i.audience,
    toneProfile: { formality: s.formality, emotionalIntensity: s.emotion, warmth: s.warmth, humorLevel: s.humor, authorityLevel: s.authority, directness: s.directness, readerIntimacy: s.readerIntimacy } as any,
    controls: { writerId: i.writerId, velocity: s.pacing, scope: s.elaboration, entityComplexity: s.conceptualComplexity, perspectiveMultiplexing: s.perspective, creativity: s.creativity, hookFrequency: s.hookFrequency, sensoryDetail: s.sensoryDetail, sentenceVariation: s.sentenceVariation, divergenceMode: i.divergence, divergenceAllowed: i.divergence !== "strict" } as any,
  };
}

export function BookIdeasGenerator({ onBack, onAccept }: { onBack: () => void; onAccept: (input: Partial<CreateBookInput>) => void }) {
  const [brief, setBrief] = useState("");
  const [ideas, setIdeas] = useState<BookIdea[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null);

  const run = async () => {
    setLoading(true); setErr(null);
    try {
      const { data, error } = await supabase.functions.invoke("book-ideas", { body: { brief, count: 4, catalog: catalog() } });
      const msg = (data as { error?: string })?.error || (error ? (await (error as { context?: Response }).context?.json?.().catch(() => null))?.error ?? error.message : null);
      if (msg) throw new Error(msg);
      setIdeas(data.ideas);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setLoading(false); }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-background">
      <header className="sticky top-0 z-10 border-b border-border bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-5xl items-center gap-3 px-4">
          <Button variant="ghost" size="icon" onClick={onBack} aria-label="Back"><ArrowLeft className="h-5 w-5" /></Button>
          <div className="min-w-0">
            <h1 className="font-serif text-xl font-semibold">Book Ideas</h1>
            <p className="truncate text-sm text-muted-foreground">Complete book setups — title, description, audience, writer and voice.</p>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl space-y-6 px-4 py-6">
        <div className="space-y-2">
          <Textarea value={brief} maxLength={600} rows={3} onChange={(e) => setBrief(e.target.value)} placeholder="Optional: what are you in the mood for? e.g. a cozy mystery for adults, or a practical guide to starting a bakery…" />
          <Button className="rounded-full" onClick={run} disabled={loading}>{loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}{ideas.length ? "Generate new ideas" : "Generate ideas"}</Button>
          {err && <p className="text-sm text-destructive">{err}</p>}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {ideas.map((i, n) => {
            const w = WRITER_PERSONAS.find((p) => p.id === i.writerId)!;
            return (
              <button key={n} type="button" onClick={() => setOpen(n)} className="space-y-2 rounded-2xl border border-border bg-card p-4 text-left transition-colors hover:border-primary/50">
                <div className="text-[11px] uppercase tracking-wide text-primary">{BOOK_TYPE_INFO[i.bookType]?.label}{i.genre && ` · ${i.genre}`}</div>
                <h3 className="font-serif text-lg font-semibold leading-tight">{i.title}</h3>
                {i.subtitle && <p className="text-sm text-muted-foreground">{i.subtitle}</p>}
                <p className="line-clamp-3 text-sm">{i.description}</p>
                <div className="flex items-center gap-2 pt-1 text-xs text-muted-foreground">
                  <img src={WRITER_PORTRAITS[w.id]} alt={w.name} className="h-6 w-6 rounded-full object-cover" />{w.name} · {audienceLabel(i.audience)}
                </div>
              </button>
            );
          })}
        </div>
      </main>
      {open != null && ideas[open] && (
        <IdeaDialog idea={ideas[open]} onClose={() => setOpen(null)} onChange={(u) => setIdeas((p) => p.map((x, k) => (k === open ? u : x)))} onAccept={(u) => onAccept(ideaToInput(u))} />
      )}
    </div>
  );
}

function IdeaDialog({ idea, onClose, onChange, onAccept }: { idea: BookIdea; onClose: () => void; onChange: (i: BookIdea) => void; onAccept: (i: BookIdea) => void }) {
  const w = WRITER_PERSONAS.find((p) => p.id === idea.writerId)!;
  const base = WRITER_BASELINES[idea.writerId];
  const values = idea.sliders ?? base!;
  const set = (patch: Partial<BookIdea>) => onChange({ ...idea, ...patch });
  const allowedAudiences = BOOK_TYPE_AUDIENCES[idea.bookType] ?? AUDIENCE_OPTIONS.map((a) => a.value);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-serif">Book settings</DialogTitle>
          <DialogDescription>Accept as is, or adjust. The writer's models are locked; each voice setting moves up to ±{MAX_ADJUST}.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 text-sm">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1 sm:col-span-2"><span className="text-xs text-muted-foreground">Title</span><Input value={idea.title} maxLength={120} onChange={(e) => set({ title: e.target.value })} /></label>
            <label className="space-y-1 sm:col-span-2"><span className="text-xs text-muted-foreground">Subtitle</span><Input value={idea.subtitle} maxLength={160} onChange={(e) => set({ subtitle: e.target.value })} /></label>
            <label className="space-y-1 sm:col-span-2"><span className="text-xs text-muted-foreground">Description</span><Textarea rows={3} value={idea.description} maxLength={800} onChange={(e) => set({ description: e.target.value })} /></label>
            <div className="space-y-1"><span className="text-xs text-muted-foreground">Book type</span><div>{BOOK_TYPE_INFO[idea.bookType]?.label}{idea.genre && ` · ${idea.genre}`}</div></div>
            <label className="space-y-1"><span className="text-xs text-muted-foreground">Audience</span>
              <select className="h-9 w-full rounded-md border border-input bg-background px-2" value={idea.audience} onChange={(e) => set({ audience: e.target.value })}>
                {allowedAudiences.map((a) => <option key={a} value={a}>{audienceLabel(a)}</option>)}
              </select>
            </label>
          </div>
          <div className="flex items-center gap-3 rounded-xl border border-border p-3">
            <img src={WRITER_PORTRAITS[w.id]} alt={w.name} className="h-12 w-12 rounded-full object-cover" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1 font-medium">{w.name}<Lock className="h-3 w-3 text-muted-foreground" /></div>
              <div className="text-xs text-muted-foreground">{idea.whyThisWriter || w.tagline}</div>
              <div className="text-[11px] text-muted-foreground">Writer and models are locked — pick the tier later in Book Settings.</div>
            </div>
          </div>
          <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
            {SLIDERS.map((s) => {
              const b = base?.[s.key];
              const range: [number, number] = b != null ? [Math.max(1, b - MAX_ADJUST), Math.min(10, b + MAX_ADJUST)] : [1, 10];
              return (
                <div key={s.key} className="space-y-1">
                  <div className="flex justify-between text-xs"><span>{s.label}</span><span className="text-muted-foreground">{values[s.key]}{offsetLabel(values[s.key], b)}</span></div>
                  <BoundedSlider label={s.label} range={range} base={b} value={values[s.key]} onChange={(v) => set({ sliders: { ...values, [s.key]: v } })} />
                  <div className="flex justify-between text-[10px] text-muted-foreground"><span>{s.low}</span><span>{s.high}</span></div>
                </div>
              );
            })}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">Story divergence:</span>
            {DIVERGENCE_OPTIONS.map((d) => <Button key={d.value} size="sm" variant={d.value === idea.divergence ? "secondary" : "ghost"} className="rounded-full" title={d.description} onClick={() => set({ divergence: d.value })}>{d.label}</Button>)}
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" className="rounded-full" onClick={onClose}>Close</Button>
            <Button className="rounded-full" onClick={() => onAccept(idea)} disabled={!idea.title.trim()}>Accept & continue</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
