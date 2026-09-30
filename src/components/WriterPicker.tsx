import { WRITER_PERSONAS, bestWriterFor } from "../../supabase/functions/_shared/writers/personas";
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

export function WriterPicker({ bookType, value, onChange }: { bookType: string; value?: string; onChange: (id: string) => void }) {
  const best = bestWriterFor(bookType);
  const selected = value ?? best.id;
  const list = [...WRITER_PERSONAS].sort((a, b) => Number(b.bookTypes.includes(bookType)) - Number(a.bookTypes.includes(bookType)));
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {list.map((w) => {
        const active = w.id === selected;
        return (
          <button
            key={w.id}
            type="button"
            onClick={() => onChange(w.id)}
            className={`min-w-0 rounded-xl border p-2 text-left transition-all ${active ? "border-primary bg-primary/5 ring-1 ring-primary/30" : "border-border hover:border-primary/40"}`}
          >
            <div className="flex items-center gap-2">
              <img src={WRITER_PORTRAITS[w.id]} alt={w.name} loading="lazy" width={40} height={40} className="h-10 w-10 shrink-0 rounded-full object-cover" />
              <div className="min-w-0">
                <div className="truncate text-xs font-medium">{w.name.split(" ")[0]}{w.id === best.id && <span className="ml-1 text-[9px] text-primary">Best fit</span>}</div>
                <div className="truncate text-[10px] text-muted-foreground">{w.tagline}</div>
              </div>
            </div>
            {active && <p className="mt-1.5 text-[10px] leading-snug text-muted-foreground">{w.personality} {w.signature}.</p>}
          </button>
        );
      })}
    </div>
  );
}
