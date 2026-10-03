import { useState } from "react";
import { Star, Mic, Loader2 } from "lucide-react";
import { WRITER_PERSONAS, bestWriterFor } from "../../supabase/functions/_shared/writers/personas";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import elena from "@/assets/writers/elena.jpg";
import maya from "@/assets/writers/maya.jpg";
import claire from "@/assets/writers/claire.jpg";
import nora from "@/assets/writers/nora.jpg";
import sophia from "@/assets/writers/sophia.jpg";
import priya from "@/assets/writers/priya.jpg";
import daniel from "@/assets/writers/daniel.jpg";
import marcus from "@/assets/writers/marcus.jpg";
import adrian from "@/assets/writers/adrian.jpg";
import ethan from "@/assets/writers/ethan.jpg";
import julian from "@/assets/writers/julian.jpg";
import luca from "@/assets/writers/luca.jpg";

export const WRITER_PORTRAITS: Record<string, string> = { elena, maya, claire, nora, sophia, priya, daniel, marcus, adrian, ethan, julian, luca };

const FAV_KEY = "favoriteWriters";
const loadFavs = (): string[] => { try { return JSON.parse(localStorage.getItem(FAV_KEY) || "[]"); } catch { return []; } };

export function WriterPicker({ bookType, value, onChange }: { bookType: string; value?: string; onChange: (id: string) => void }) {
  const best = bestWriterFor(bookType);
  const selected = value ?? best.id;
  const [favs, setFavs] = useState<string[]>(loadFavs);
  const [testing, setTesting] = useState<string | null>(null);
  const toggleFav = (id: string) => setFavs((p) => { const n = p.includes(id) ? p.filter((x) => x !== id) : [...p, id]; localStorage.setItem(FAV_KEY, JSON.stringify(n)); return n; });
  const score = (id: string, types: string[]) => (favs.includes(id) ? 2 : 0) + (types.includes(bookType) ? 1 : 0);
  const list = [...WRITER_PERSONAS].sort((a, b) => score(b.id, b.bookTypes) - score(a.id, a.bookTypes));
  return (
    <>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {list.map((w) => {
          const active = w.id === selected;
          const fav = favs.includes(w.id);
          return (
            <div key={w.id} role="button" tabIndex={0} onClick={() => onChange(w.id)} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onChange(w.id)}
              className={`relative min-w-0 cursor-pointer rounded-xl border p-2 text-left transition-all ${active ? "border-primary bg-primary/5 ring-1 ring-primary/30" : "border-border hover:border-primary/40"}`}>
              <button type="button" aria-label={fav ? "Remove from favorites" : "Add to favorites"} onClick={(e) => { e.stopPropagation(); toggleFav(w.id); }}
                className="absolute right-1.5 top-1.5 rounded-full p-1 text-muted-foreground hover:text-primary">
                <Star className={`h-3.5 w-3.5 ${fav ? "fill-primary text-primary" : ""}`} />
              </button>
              <div className="flex items-center gap-2 pr-5">
                <img src={WRITER_PORTRAITS[w.id]} alt={w.name} loading="lazy" width={40} height={40} className="h-10 w-10 shrink-0 rounded-full object-cover" />
                <div className="min-w-0">
                  <div className="truncate text-xs font-medium">{w.name.split(" ")[0]}{w.id === best.id && <span className="ml-1 text-[9px] text-primary">Best fit</span>}</div>
                  <div className="truncate text-[10px] text-muted-foreground">{w.tagline}</div>
                </div>
              </div>
              {active && <p className="mt-1.5 text-[10px] leading-snug text-muted-foreground">{w.personality} {w.signature}.</p>}
              <button type="button" onClick={(e) => { e.stopPropagation(); setTesting(w.id); }}
                className="mt-1.5 flex w-full items-center justify-center gap-1 rounded-full border border-border py-1 text-[10px] text-muted-foreground hover:border-primary/50 hover:text-primary">
                <Mic className="h-3 w-3" />Test voice
              </button>
            </div>
          );
        })}
      </div>
      <TestVoiceDialog writerId={testing} bookType={bookType} onClose={() => setTesting(null)} onUse={(id) => { onChange(id); setTesting(null); }} />
    </>
  );
}

function TestVoiceDialog({ writerId, bookType, onClose, onUse }: { writerId: string | null; bookType: string; onClose: () => void; onUse: (id: string) => void }) {
  const w = WRITER_PERSONAS.find((p) => p.id === writerId);
  const [premise, setPremise] = useState("");
  const [text, setText] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const run = async () => {
    if (!w) return;
    setLoading(true); setText(null); setErr(null);
    try {
      const { data, error } = await supabase.functions.invoke("try-writer", { body: { writerId: w.id, tier: "balanced", premise, bookType } });
      const msg = (data as { error?: string })?.error || (error ? (await (error as { context?: Response }).context?.json?.().catch(() => null))?.error ?? error.message : null);
      if (msg) throw new Error(msg);
      setText(data.text);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setLoading(false); }
  };
  return (
    <Dialog open={!!w} onOpenChange={(o) => { if (!o) { onClose(); setText(null); setErr(null); } }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        {w && <>
          <DialogHeader>
            <div className="flex items-center gap-3">
              <img src={WRITER_PORTRAITS[w.id]} alt={w.name} className="h-12 w-12 rounded-full object-cover" />
              <div className="text-left"><DialogTitle className="font-serif">{w.name}</DialogTitle><DialogDescription>{w.tagline}</DialogDescription></div>
            </div>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">Hear {w.name.split(" ")[0]}'s natural voice on a short opening. Nothing is saved to your book.</p>
          <Textarea value={premise} maxLength={600} rows={3} onChange={(e) => setPremise(e.target.value)} placeholder="A retired lighthouse keeper finds a letter addressed to her, dated fifty years in the future…" />
          <Button className="rounded-full" onClick={run} disabled={loading || !premise.trim()}>{loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Write a sample</Button>
          {err && <p className="text-sm text-destructive">{err}</p>}
          {text && <div className="space-y-3 rounded-xl border border-border bg-card p-4">
            <p className="whitespace-pre-line font-serif text-sm leading-relaxed">{text}</p>
            <Button variant="outline" className="rounded-full" onClick={() => onUse(w.id)}>Use {w.name.split(" ")[0]}</Button>
          </div>}
        </>}
      </DialogContent>
    </Dialog>
  );
}
