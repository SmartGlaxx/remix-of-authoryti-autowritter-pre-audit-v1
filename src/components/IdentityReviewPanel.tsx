// Phase 4 — author review for character names the story memory couldn't match safely.
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { callPlanBook } from "@/lib/candidateReview";

type Row = Record<string, any>;

export default function IdentityReviewPanel({ bookId }: { bookId: string }) {
  const [data, setData] = useState<{ reviews: Row[]; candidates: Row[] } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const load = async () => { const r = await callPlanBook({ action: "identity_reviews", bookId }); setData(r.ok ? r.data : { reviews: [], candidates: [] }); };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [bookId]);

  const decide = async (id: string, decision: string, extra: Row = {}) => {
    setBusy(id);
    try {
      const r = await callPlanBook({ action: "resolve_review", bookId, reviewId: id, decision, ...extra });
      if (!r.ok) throw new Error(r.data.error ?? "Couldn't save");
      toast.success(decision === "defer" ? "Saved for later" : "Done"); await load();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Something went wrong"); } finally { setBusy(null); }
  };

  if (!data) return <div className="py-6 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div>;
  const name = (id: string) => data.candidates.find((c) => c.id === id)?.display_name ?? "Unknown";
  return (
    <Card>
      <CardHeader><CardTitle>Characters to confirm {data.reviews.length > 0 && <Badge variant="secondary" className="ml-2">{data.reviews.length}</Badge>}</CardTitle>
        <CardDescription>The story memory found these names but couldn't be sure who they are. Nothing is recorded for them until you decide.</CardDescription></CardHeader>
      <CardContent className="space-y-3">
        {data.reviews.length === 0 && <p className="text-sm text-muted-foreground">Nothing to confirm.</p>}
        {data.reviews.map((r) => {
          const [ch, sub] = String(r.source_section_key).split(":").map(Number);
          return (
            <div key={r.id} className="rounded-lg border border-border p-3 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{r.character_name}</span>
                <Badge variant="outline">Chapter {ch + 1}, section {sub + 1}</Badge>
                <Badge variant="secondary">{r.reason === "ambiguous" ? "could be more than one person" : "no matching character"}</Badge>
                {r.deferred_at && <Badge variant="outline">saved for later</Badge>}
              </div>
              {r.payload?.claim && <p className="text-sm"><span className="text-muted-foreground">What they learned:</span> {r.payload.claim}</p>}
              {r.payload?.evidence && <blockquote className="text-sm italic border-l-2 border-border pl-3 text-muted-foreground">"{r.payload.evidence}"</blockquote>}
              <div className="flex flex-wrap gap-2">
                {(r.candidate_identity_ids ?? []).map((id: string) => <Button key={id} size="sm" disabled={busy === r.id} onClick={() => decide(r.id, "confirm_existing", { identityId: id })}>It's {name(id)}</Button>)}
                <Button size="sm" variant="outline" disabled={busy === r.id} onClick={() => decide(r.id, r.reason === "ambiguous" ? "different_character" : "create_lightweight")}>{r.reason === "ambiguous" ? "A different person" : "Add as new character"}</Button>
                <Button size="sm" variant="ghost" disabled={busy === r.id} onClick={() => decide(r.id, "defer")}>Decide later</Button>
                <Button size="sm" variant="ghost" disabled={busy === r.id} onClick={() => decide(r.id, "dismiss")}>Not a character</Button>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
