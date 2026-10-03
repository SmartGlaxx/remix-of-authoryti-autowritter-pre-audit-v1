import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Checkbox } from "@/components/ui/checkbox";
import { ArrowLeft, Bookmark, Loader2, Lock, Sparkles, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { BoundedSlider, offsetLabel } from "@/components/BoundedSlider";
import { WRITER_PORTRAITS } from "@/components/WriterPicker";
import { WRITER_PERSONAS, bestWriterFor } from "../../supabase/functions/_shared/writers/personas";
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

type LightIdea = Pick<BookIdea, "title" | "subtitle" | "description" | "bookType" | "genre" | "audience">;
interface SavedRow { id: string; title: string; subtitle: string; description: string; book_type: string; genre: string; audience: string; details: Pick<BookIdea, "writerId" | "whyThisWriter" | "divergence" | "sliders"> | null }

const invokeIdeas = async (body: Record<string, unknown>) => {
  const { data, error } = await supabase.functions.invoke("book-ideas", { body: { ...body, catalog: catalog() } });
  const msg = (data as { error?: string })?.error || (error ? (await (error as { context?: Response }).context?.json?.().catch(() => null))?.error ?? error.message : null);
  if (msg) throw new Error(msg);
  return data.ideas as BookIdea[];
};
const rowToIdea = (r: SavedRow): BookIdea => {
  const bt = r.book_type as BookType;
  const d = r.details ?? { writerId: bestWriterFor(bt).id, whyThisWriter: "", divergence: "strict" as DivergenceMode, sliders: null };
  return { title: r.title, subtitle: r.subtitle, description: r.description, bookType: bt, genre: r.genre, audience: r.audience, ...d };
};

export function BookIdeasGenerator({ onBack, onAccept }: { onBack: () => void; onAccept: (input: Partial<CreateBookInput>) => void }) {
  const [tab, setTab] = useState<"new" | "saved">("new");
  const [brief, setBrief] = useState("");
  const [ideas, setIdeas] = useState<LightIdea[]>([]);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState<SavedRow[]>([]);
  const [open, setOpen] = useState<SavedRow | null>(null);

  const loadSaved = async () => {
    const { data } = await supabase.from("saved_book_ideas").select("id,title,subtitle,description,book_type,genre,audience,details").order("created_at", { ascending: false });
    setSaved((data ?? []) as unknown as SavedRow[]);
  };
  useEffect(() => { loadSaved(); }, []);

  const run = async () => {
    setLoading(true); setErr(null);
    try { setIdeas(await invokeIdeas({ brief, count: 6, mode: "light" })); setPicked(new Set()); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setLoading(false); }
  };

  // Full setup (writer, voice, divergence) is generated only for the ideas the author chose to save.
  const savePicked = async () => {
    setSaving(true); setErr(null);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setSaving(false); return; }
    let ok = 0;
    for (const n of [...picked]) {
      const base = ideas[n];
      try {
        const [full] = await invokeIdeas({ mode: "details", idea: base });
        const { error } = await supabase.from("saved_book_ideas").insert({
          user_id: user.id, title: full.title, subtitle: full.subtitle, description: full.description, book_type: full.bookType, genre: full.genre, audience: full.audience,
          details: { writerId: full.writerId, whyThisWriter: full.whyThisWriter, divergence: full.divergence, sliders: full.sliders } as never,
        });
        if (error) throw error;
        ok++;
      } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    }
    setIdeas((p) => p.filter((_, k) => !picked.has(k))); setPicked(new Set());
    await loadSaved(); setSaving(false);
    if (ok) { toast.success(`Saved ${ok} idea${ok > 1 ? "s" : ""}`); setTab("saved"); }
  };

  const remove = async (id: string) => {
    await supabase.from("saved_book_ideas").delete().eq("id", id);
    setSaved((p) => p.filter((r) => r.id !== id));
  };
  const updateSaved = async (row: SavedRow, i: BookIdea) => {
    const next: SavedRow = { ...row, title: i.title, subtitle: i.subtitle, description: i.description, audience: i.audience, details: { writerId: i.writerId, whyThisWriter: i.whyThisWriter, divergence: i.divergence, sliders: i.sliders } };
    setOpen(next); setSaved((p) => p.map((r) => (r.id === row.id ? next : r)));
    await supabase.from("saved_book_ideas").update({ title: next.title, subtitle: next.subtitle, description: next.description, audience: next.audience, details: next.details as never }).eq("id", row.id);
  };

  const Card = ({ i, children, onClick }: { i: LightIdea; children?: React.ReactNode; onClick?: () => void }) => (
    <div onClick={onClick} className={`space-y-2 rounded-2xl border bg-card p-4 text-left transition-colors ${onClick ? "cursor-pointer hover:border-primary/50" : ""} border-border`}>
      <div className="text-[11px] uppercase tracking-wide text-primary">{BOOK_TYPE_INFO[i.bookType]?.label}{i.genre && ` · ${i.genre}`} · {audienceLabel(i.audience)}</div>
      <h3 className="font-serif text-lg font-semibold leading-tight">{i.title}</h3>
      {i.subtitle && <p className="text-sm text-muted-foreground">{i.subtitle}</p>}
      <p className="line-clamp-4 text-sm">{i.description}</p>
      {children}
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-background">
      <header className="sticky top-0 z-10 border-b border-border bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-5xl items-center gap-3 px-4">
          <Button variant="ghost" size="icon" onClick={onBack} aria-label="Back"><ArrowLeft className="h-5 w-5" /></Button>
          <div className="min-w-0 flex-1">
            <h1 className="font-serif text-xl font-semibold">Book Ideas</h1>
            <p className="truncate text-sm text-muted-foreground">Browse ideas, save the ones you like, start a book from any saved idea.</p>
          </div>
          <div className="flex gap-1">
            <Button size="sm" variant={tab === "new" ? "secondary" : "ghost"} className="rounded-full" onClick={() => setTab("new")}>New ideas</Button>
            <Button size="sm" variant={tab === "saved" ? "secondary" : "ghost"} className="rounded-full" onClick={() => setTab("saved")}>Saved ({saved.length})</Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl space-y-6 px-4 py-6">
        {tab === "new" ? (<>
          <div className="space-y-2">
            <Textarea value={brief} maxLength={600} rows={3} onChange={(e) => setBrief(e.target.value)} placeholder="Optional: what are you in the mood for? e.g. a cozy mystery for adults, or a practical guide to starting a bakery…" />
            <div className="flex flex-wrap gap-2">
              <Button className="rounded-full" onClick={run} disabled={loading || saving}>{loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}{ideas.length ? "Generate new ideas" : "Generate ideas"}</Button>
              {ideas.length > 0 && <Button variant="secondary" className="rounded-full" onClick={savePicked} disabled={!picked.size || saving}>{saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Bookmark className="mr-2 h-4 w-4" />}{saving ? "Preparing full setups…" : `Save selected (${picked.size})`}</Button>}
            </div>
            {err && <p className="text-sm text-destructive">{err}</p>}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {ideas.map((i, n) => (
              <Card key={n} i={i} onClick={() => setPicked((p) => { const s = new Set(p); s.has(n) ? s.delete(n) : s.add(n); return s; })}>
                <label className="flex items-center gap-2 pt-1 text-xs text-muted-foreground"><Checkbox checked={picked.has(n)} />Select to save</label>
              </Card>
            ))}
          </div>
        </>) : (
          saved.length ? (
            <div className="grid gap-4 sm:grid-cols-2">
              {saved.map((r) => { const i = rowToIdea(r); const w = WRITER_PERSONAS.find((p) => p.id === i.writerId); return (
                <Card key={r.id} i={i}>
                  <div className="flex items-center justify-between gap-2 pt-1">
                    {w ? <span className="flex items-center gap-2 text-xs text-muted-foreground"><img src={WRITER_PORTRAITS[w.id]} alt={w.name} className="h-6 w-6 rounded-full object-cover" />{w.name}</span> : <span />}
                    <div className="flex gap-1">
                      <Button size="sm" variant="ghost" className="rounded-full" onClick={() => remove(r.id)} aria-label="Remove"><Trash2 className="h-4 w-4" /></Button>
                      <Button size="sm" className="rounded-full" onClick={() => setOpen(r)}>Open</Button>
                    </div>
                  </div>
                </Card>
              ); })}
            </div>
          ) : <p className="text-sm text-muted-foreground">No saved ideas yet. Generate some and save the ones you like.</p>
        )}
      </main>
      {open && (
        <IdeaDialog idea={rowToIdea(open)} onClose={() => setOpen(null)} onChange={(u) => updateSaved(open, u)} onAccept={(u) => onAccept(ideaToInput(u))} />
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
