import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

export const RECONCILIATION_EVENT = "canon-reconciliation-changed";

type Log = {
  id: string;
  severity: string;
  description: string;
  prose_excerpt: string | null;
  chapter_index: number;
  subsection_index: number;
  dedup_key: string | null;
};

type Decision = "KEEP_CANON_REVISE_PROSE" | "ACCEPT_PROSE_UPDATE_CANON" | "DISMISS";

const OPTIONS: { value: Decision; label: string; hint: string; note: string }[] = [
  { value: "ACCEPT_PROSE_UPDATE_CANON", label: "Keep the new text", hint: "The written section becomes the story's truth.", note: "The new text is correct." },
  { value: "KEEP_CANON_REVISE_PROSE", label: "Keep my setup", hint: "Your setup stays the truth; rewrite that section later.", note: "My setup is correct; the section needs rewriting." },
  { value: "DISMISS", label: "Not a problem", hint: "Ignore this flag and keep writing.", note: "Not a real contradiction." },
];

/** Shows serious, undecided contradictions that block the next section, and records the author's decision. */
export function ContradictionReviewCard({ bookId }: { bookId: string }) {
  const [logs, setLogs] = useState<Log[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("canon_reconciliation_logs")
      .select("id, severity, description, prose_excerpt, chapter_index, subsection_index, dedup_key")
      .eq("book_id", bookId)
      .eq("decision", "PENDING")
      .in("severity", ["CRITICAL", "MAJOR"])
      .order("created_at", { ascending: true })
      .limit(20);
    setLogs(((data ?? []) as Log[]).filter((l) => !String(l.dedup_key ?? "").startsWith("selftest_")));
  }, [bookId]);

  useEffect(() => {
    void load();
    const h = () => void load();
    window.addEventListener(RECONCILIATION_EVENT, h);
    return () => window.removeEventListener(RECONCILIATION_EVENT, h);
  }, [load]);

  const decide = async (log: Log, opt: (typeof OPTIONS)[number]) => {
    setBusy(log.id);
    const rationale = (notes[log.id] ?? "").trim() || opt.note;
    const { error } = await supabase.rpc("decide_canon_reconciliation", {
      p_log_id: log.id, p_decision: opt.value, p_rationale: rationale,
    });
    setBusy(null);
    if (error) { toast.error(`Couldn't save your decision: ${error.message}`); return; }
    toast.success(opt.value === "KEEP_CANON_REVISE_PROSE"
      ? "Saved. Rewrite that section when you're ready — writing can continue."
      : "Saved. You can continue writing.");
    void load();
  };

  if (!logs.length) return null;

  return (
    <div className="mb-4 px-4 md:px-0 space-y-3">
      {logs.map((log) => (
        <div key={log.id} className="rounded-xl border border-destructive/40 bg-destructive/10 p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0 space-y-2">
              <p className="text-sm font-semibold text-foreground">
                Your decision is needed before the next section — Chapter {log.chapter_index + 1}, Section {log.subsection_index + 1}
              </p>
              <p className="text-sm text-muted-foreground">{log.description}</p>
              {log.prose_excerpt && (
                <blockquote className="text-sm italic border-l-2 border-primary/50 pl-3 text-foreground/80">{log.prose_excerpt}</blockquote>
              )}
              <Textarea
                value={notes[log.id] ?? ""}
                onChange={(e) => setNotes((n) => ({ ...n, [log.id]: e.target.value }))}
                placeholder="Optional note (why you chose this)"
                className="min-h-[60px] text-sm"
              />
              <div className="flex flex-wrap gap-2">
                {OPTIONS.map((opt) => (
                  <Button key={opt.value} size="sm" variant={opt.value === "ACCEPT_PROSE_UPDATE_CANON" ? "default" : "outline"}
                    disabled={busy === log.id} title={opt.hint} onClick={() => decide(log, opt)}>
                    {busy === log.id && <Loader2 className="w-3 h-3 mr-1 animate-spin" />}
                    {opt.label}
                  </Button>
                ))}
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
