import { useEffect, useState } from "react";
import { KeyRound, Loader2, Trash2, PlugZap } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { PROVIDER_LABELS, type ProviderId } from "../../supabase/functions/_shared/ai/registry";

type KeyRow = { provider: ProviderId; masked: string; status: "untested" | "valid" | "invalid" };
const PROVIDERS: ProviderId[] = ["openai", "anthropic", "deepseek", "gemini"];

async function call(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke("provider-keys", { body });
  if (error || data?.error) throw new Error(data?.error || error?.message || "Request failed");
  return data;
}

export function ApiKeysCard() {
  const [keys, setKeys] = useState<KeyRow[]>([]);
  const [drafts, setDrafts] = useState<Partial<Record<ProviderId, string>>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = () => call({ action: "list" }).then((d) => setKeys(d.keys ?? [])).catch((e) => toast.error(e.message));
  useEffect(() => { refresh(); }, []);

  const run = async (id: string, fn: () => Promise<void>) => {
    setBusy(id);
    try { await fn(); } catch (e) { toast.error((e as Error).message); } finally { setBusy(null); }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <KeyRound className="w-4 h-4 text-primary" />
          Your API Keys (optional)
        </CardTitle>
        <p className="text-xs text-muted-foreground">Keys are encrypted and can't be viewed again after saving. Without a key, the app's built-in AI is used.</p>
      </CardHeader>
      <CardContent className="space-y-3">
        {PROVIDERS.map((p) => {
          const row = keys.find((k) => k.provider === p);
          return (
            <div key={p} className="rounded-md border border-border p-3 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium">{PROVIDER_LABELS[p]}</p>
                {row ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <code className="text-xs text-muted-foreground">{row.masked}</code>
                    <Badge variant={row.status === "valid" ? "default" : row.status === "invalid" ? "destructive" : "outline"} className="text-[10px]">
                      {row.status === "valid" ? "Working" : row.status === "invalid" ? "Not working" : "Not tested"}
                    </Badge>
                  </div>
                ) : <span className="text-xs text-muted-foreground">Not set</span>}
              </div>
              <div className="flex flex-wrap gap-2">
                <Input
                  type="password"
                  autoComplete="off"
                  placeholder={row ? "Paste a new key to replace" : "Paste your key"}
                  value={drafts[p] ?? ""}
                  onChange={(e) => setDrafts((d) => ({ ...d, [p]: e.target.value }))}
                  className="h-8 min-w-0 basis-full flex-1 text-xs sm:basis-auto"
                />
                <Button size="sm" className="h-8" disabled={!drafts[p] || busy !== null} onClick={() => run(`save-${p}`, async () => {
                  await call({ action: "save", provider: p, key: drafts[p] });
                  setDrafts((d) => ({ ...d, [p]: "" }));
                  toast.success("Key saved");
                  await refresh();
                })}>{busy === `save-${p}` ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : row ? "Replace" : "Save"}</Button>
                {row && (
                  <>
                    <Button size="sm" variant="outline" className="h-8 gap-1" disabled={busy !== null} onClick={() => run(`test-${p}`, async () => {
                      const r = await call({ action: "test", provider: p });
                      r.ok ? toast.success("Connection works") : toast.error(r.error || "Connection failed");
                      await refresh();
                    })}>{busy === `test-${p}` ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <PlugZap className="w-3.5 h-3.5" />} Test</Button>
                    <Button size="sm" variant="ghost" className="h-8" disabled={busy !== null} onClick={() => run(`del-${p}`, async () => {
                      await call({ action: "delete", provider: p });
                      toast.success("Key removed");
                      await refresh();
                    })}><Trash2 className="w-3.5 h-3.5" /></Button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
