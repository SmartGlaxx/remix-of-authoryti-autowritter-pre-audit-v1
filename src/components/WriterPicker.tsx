import { useState } from "react";
import { Star, Mic } from "lucide-react";
import { WRITER_PERSONAS, bestWriterFor } from "../../supabase/functions/_shared/writers/personas";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { WriterStudio } from "@/components/WriterStudio";
import { WRITER_PORTRAITS } from "@/components/WriterPortraits";
export { WRITER_PORTRAITS } from "@/components/WriterPortraits";

const FAV_KEY = "favoriteWriters";
const loadFavs = (): string[] => { try { return JSON.parse(localStorage.getItem(FAV_KEY) || "[]"); } catch { return []; } };

export function WriterPicker({ bookType, genre, value, onChange }: { bookType: string; genre?: string; value?: string; onChange: (id: string) => void }) {
  const best = bestWriterFor(bookType, genre);
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
  return (
    <Dialog open={!!writerId} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-h-[90vh] w-[calc(100vw-1.5rem)] max-w-6xl overflow-y-auto p-4 sm:p-6">
        <DialogHeader><DialogTitle className="font-serif">Try a Writer</DialogTitle><DialogDescription>Compare voices and choose a writer.</DialogDescription></DialogHeader>
        {writerId && <WriterStudio key={writerId} initialWriterId={writerId} bookType={bookType} onUse={(id) => onUse(id)} />}
      </DialogContent>
    </Dialog>
  );
}
