import { useState } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { callReview } from "@/lib/candidateReview";
import { FindingList, checkDraft, useMotifs } from "@/components/NaturalnessPanel";
import type { NaturalnessFinding } from "../../supabase/functions/_shared/writers/naturalness";

type Row = Record<string, any>;

/** Style check + author-requested targeted rewrite on a HELD draft, before acceptance.
 *  The rewrite saves a new draft version (server "naturalness_rewrite"); acceptance still needs the full checks. */
export function HeldDraftStyle({ bookId, c, onRewritten }: { bookId: string; c: Row; onRewritten: () => void }) {
  const motifs = useMotifs(bookId);
  const [findings, setFindings] = useState<NaturalnessFinding[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [compare, setCompare] = useState<{ before: string; after: string } | null>(null);
  const rewrite = async () => {
    setBusy(true);
    const before = c.draft_text as string;
    const r = await callReview<Row>({ action: "naturalness_rewrite", bookId, candidateId: c.id });
    setBusy(false);
    if (!r.ok) { toast.error(r.data?.error ?? "Rewrite failed. Your draft is unchanged."); return; }
    if (r.data.status !== "rewritten") { toast.info("No safe improvement found — your draft is unchanged."); setFindings(r.data.findings ?? findings); return; }
    const st = await callReview<{ candidates: Row[] }>({ action: "status", bookId });
    const next = st.data?.candidates?.find((x) => x.chapter_index === c.chapter_index && x.subsection_index === c.subsection_index);
    setCompare({ before, after: next?.draft_text ?? "" });
    setFindings(r.data.findings ?? []);
    toast.success("Saved as a new draft version. Compare below, then re-run checks & accept or edit further.");
    onRewritten();
  };
  return (
    <div className="rounded-md border border-border/60 p-2 space-y-2">
      <div className="flex flex-wrap gap-2 items-center">
        <span className="text-xs font-medium flex-1">Writing style (advice only)</span>
        <Button size="sm" variant="outline" className="h-7" onClick={() => setFindings(checkDraft(c.draft_text, motifs.labels))}>Check style</Button>
        <Button size="sm" variant="outline" className="h-7" disabled={busy} onClick={rewrite}>{busy && <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" />}Targeted rewrite</Button>
      </div>
      {findings && <FindingList findings={findings} onMotif={async (l) => { if (await motifs.add(l)) setFindings(checkDraft(c.draft_text, [...motifs.labels, l])); }} />}
      {compare && (
        <div className="grid gap-2 md:grid-cols-2">
          <div><p className="text-[11px] uppercase tracking-wide text-muted-foreground">Previous version</p><div className="text-xs whitespace-pre-wrap max-h-60 overflow-auto border rounded p-2">{compare.before}</div></div>
          <div><p className="text-[11px] uppercase tracking-wide text-muted-foreground">Revised version (saved, not accepted)</p><div className="text-xs whitespace-pre-wrap max-h-60 overflow-auto border rounded p-2">{compare.after}</div></div>
        </div>
      )}
    </div>
  );
}
