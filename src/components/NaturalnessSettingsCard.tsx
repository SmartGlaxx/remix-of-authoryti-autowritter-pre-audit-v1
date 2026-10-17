import { useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { resolveNaturalnessMode, type NaturalnessMode } from "../../supabase/functions/_shared/writers/naturalness";
import { MODE_LABELS } from "@/lib/naturalnessUi";

export function NaturalnessSettingsCard({ bookId, controls }: { bookId: string; controls: Record<string, unknown> }) {
  const [mode, setMode] = useState<NaturalnessMode>(resolveNaturalnessMode(controls));
  const [busy, setBusy] = useState(false);
  const save = async (m: NaturalnessMode) => {
    setBusy(true);
    const next = { ...controls, naturalness: m };
    const { error } = await supabase.from("books").update({ controls: next as never }).eq("id", bookId);
    setBusy(false);
    if (error) { toast.error("Could not save: " + error.message); return; }
    controls.naturalness = m; setMode(m); toast.success(`Style checks: ${MODE_LABELS[m].label}`);
  };
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Writing style checks</CardTitle>
        <p className="text-xs text-muted-foreground">{MODE_LABELS[mode].note} Notes are advice only and never stop writing. Applies to sections written from now on.</p>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Writing style checks">
          {(Object.keys(MODE_LABELS) as NaturalnessMode[]).map((m) => (
            <Button key={m} role="radio" aria-checked={mode === m} disabled={busy} variant={mode === m ? "default" : "outline"} size="sm" className="rounded-full" onClick={() => mode !== m && save(m)}>
              {MODE_LABELS[m].label}
            </Button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">Approve lasting improvements for your writers in the <Link to="/writer-improvement" className="text-primary underline">Writer Improvement Studio</Link>.</p>
      </CardContent>
    </Card>
  );
}
