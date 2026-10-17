// Shows conflicts the autonomous resolver fixed on its own: what conflicted, the established
// truth it conformed to, and the agent's reasoning. Read-only; refreshes while writing runs.
import { useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronUp, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

type Row = Record<string, any>;

export function AutoResolveLog({ bookId }: { bookId: string }) {
  const [items, setItems] = useState<Row[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const load = useCallback(async () => {
    const { data } = await supabase
      .from("canon_reconciliation_logs")
      .select("id, chapter_index, subsection_index, description, excerpt, canon_ref, decided_at, created_at")
      .eq("book_id", bookId)
      .eq("canon_ref->>source", "auto_resolver")
      .order("created_at", { ascending: false })
      .limit(20);
    setItems(data ?? []);
  }, [bookId]);
  useEffect(() => {
    void load();
    const t = window.setInterval(() => void load(), 10000);
    return () => window.clearInterval(t);
  }, [load]);
  if (!items.length) return null;
  return (
    <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/5 p-3 space-y-2 mb-4">
      <p className="text-sm font-medium flex items-center gap-1.5">
        <Sparkles className="w-4 h-4 text-emerald-500" />
        Auto-resolved by the continuity agent ({items.length})
      </p>
      <p className="text-xs text-muted-foreground">These conflicts were fixed automatically by conforming the new prose to your established story facts. The choice is logged and reused if the same conflict reappears.</p>
      {items.map((l) => {
        const reasoning = typeof l.canon_ref?.reasoning === "string" ? l.canon_ref.reasoning : null;
        return (
          <div key={l.id} className="rounded-md border border-border bg-background/60 p-2 space-y-1">
            <button type="button" className="w-full flex items-start gap-2 text-left" onClick={() => setOpen(open === l.id ? null : l.id)}>
              <span className="text-xs flex-1">
                <span className="font-medium">Chapter {l.chapter_index + 1}, Section {l.subsection_index + 1}:</span>{" "}
                {String(l.description ?? "").replace(/^Auto-resolved:\s*/i, "")}
              </span>
              {open === l.id ? <ChevronUp className="w-3.5 h-3.5 shrink-0 mt-0.5" /> : <ChevronDown className="w-3.5 h-3.5 shrink-0 mt-0.5" />}
            </button>
            {open === l.id && (
              <div className="space-y-1.5 pt-1 border-t border-border">
                {l.excerpt && <p className="text-xs"><span className="text-muted-foreground">Conflicting text: </span><span className="italic">“{l.excerpt}”</span></p>}
                {reasoning && <p className="text-xs"><span className="text-muted-foreground">Agent's reasoning: </span>{reasoning}</p>}
                <p className="text-[11px] text-muted-foreground">Resolved: kept the established fact and corrected the new prose to match it.</p>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
