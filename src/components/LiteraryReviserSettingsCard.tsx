import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import {
  LITERARY_MODELS, LITERARY_MAX_OUTPUT, DEFAULT_LITERARY_CAP_USD, MAX_LITERARY_CAP_USD,
  resolveLiteraryMode, worstCaseUsd, type LiteraryMode,
} from "../../supabase/functions/_shared/writers/literaryReviser";
import { getModel } from "../../supabase/functions/_shared/ai/registry";

const MODES: Record<LiteraryMode, { label: string; note: string }> = {
  off: { label: "Off", note: "No literary editing. Nothing is spent." },
  on_request: { label: "On request", note: "You ask for a literary edit on a held draft; you review every change." },
  automatic: { label: "Automatic", note: "Each new section gets one literary edit before your review." },
};
const DEFAULT_MODEL = "__writer__";
// Typical section prompt size; used only to show the per-attempt worst case.
const TYPICAL_INPUT_TOKENS = 2500;

export function LiteraryReviserSettingsCard({ bookId, controls }: { bookId: string; controls: Record<string, unknown> }) {
  const cur = (controls.literaryReviser ?? {}) as Record<string, unknown>;
  const [mode, setMode] = useState<LiteraryMode>(resolveLiteraryMode(controls));
  const [model, setModel] = useState<string>(typeof cur.model === "string" && (LITERARY_MODELS as readonly string[]).includes(cur.model) ? cur.model : DEFAULT_MODEL);
  const [cap, setCap] = useState<string>(String(Number(cur.maxCostUsd) > 0 ? cur.maxCostUsd : DEFAULT_LITERARY_CAP_USD));
  const [busy, setBusy] = useState(false);

  const save = async (patch: Record<string, unknown>, msg: string) => {
    setBusy(true);
    const next = { ...(controls.literaryReviser as object ?? {}), ...patch };
    // No fallback is ever stored from here: an unavailable model stops instead of switching.
    delete (next as Record<string, unknown>).fallback; delete (next as Record<string, unknown>).fallbackAuthorized;
    const full = { ...controls, literaryReviser: next };
    const { error } = await supabase.from("books").update({ controls: full as never }).eq("id", bookId);
    setBusy(false);
    if (error) { toast.error("Could not save: " + error.message); return false; }
    controls.literaryReviser = next; toast.success(msg); return true;
  };

  const capNum = Number(cap);
  const capValid = capNum > 0 && capNum <= MAX_LITERARY_CAP_USD;
  const shown = model === DEFAULT_MODEL ? null : model;
  let perAttempt: number | null = null;
  try { if (shown) perAttempt = worstCaseUsd(shown, TYPICAL_INPUT_TOKENS, LITERARY_MAX_OUTPUT); } catch { perAttempt = null; }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Literary editor</CardTitle>
        <p className="text-xs text-muted-foreground">{MODES[mode].note} Dialogue, facts and names never change, at most a fifth of a section is edited, and continuity checks still run. Uses your own AI keys.</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Literary editor">
          {(Object.keys(MODES) as LiteraryMode[]).map((m) => (
            <Button key={m} role="radio" aria-checked={mode === m} disabled={busy} variant={mode === m ? "default" : "outline"} size="sm" className="rounded-full"
              onClick={async () => { if (mode !== m && await save({ mode: m }, `Literary editor: ${MODES[m].label}`)) setMode(m); }}>
              {MODES[m].label}
            </Button>
          ))}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="lit-model" className="text-xs">Editor model</Label>
            <Select value={model} disabled={busy} onValueChange={async (v) => { if (await save({ model: v === DEFAULT_MODEL ? null : v }, "Editor model saved")) setModel(v); }}>
              <SelectTrigger id="lit-model"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={DEFAULT_MODEL}>Writer's default</SelectItem>
                {LITERARY_MODELS.map((m) => <SelectItem key={m} value={m}>{getModel(m)?.displayName ?? m}</SelectItem>)}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">If this model is unavailable, editing stops. No other model is used.</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="lit-cap" className="text-xs">Spending limit per section (USD)</Label>
            <div className="flex gap-2">
              <Input id="lit-cap" type="number" min={0.01} max={MAX_LITERARY_CAP_USD} step={0.01} value={cap} onChange={(e) => setCap(e.target.value)} />
              <Button size="sm" variant="outline" className="rounded-full" disabled={busy || !capValid || capNum === Number(cur.maxCostUsd ?? DEFAULT_LITERARY_CAP_USD)}
                onClick={() => save({ maxCostUsd: capNum }, `Limit set to $${capNum.toFixed(2)}`)}>Save</Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {capValid ? "An edit that could cost more than this is never sent." : `Enter an amount between $0.01 and $${MAX_LITERARY_CAP_USD}.`}
              {perAttempt != null && ` Worst case per try: about $${perAttempt.toFixed(2)}${capValid && perAttempt > capNum ? ", above your limit, so no edit would run" : ""}.`}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
