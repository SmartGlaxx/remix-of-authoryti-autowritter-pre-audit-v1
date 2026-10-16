import { Target, Compass } from "lucide-react";

interface Props {
  sub: { summary?: string; goal?: string; targetWords?: number };
}

/** Shows the approved plan's direction on a section that has no prose yet. */
export function PlannedSceneBrief({ sub }: Props) {
  const summary = (sub.summary || "").trim();
  const goal = (sub.goal || "").trim();
  if (!summary && !goal) {
    return <p className="text-muted-foreground italic text-sm">No content yet for this section.</p>;
  }
  return (
    <div className="w-full rounded-lg border border-primary/30 bg-primary/5 p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-primary">
          <Compass className="w-3.5 h-3.5" /> Planned scene
        </span>
        {sub.targetWords ? (
          <span className="text-xs text-muted-foreground">~{sub.targetWords} words</span>
        ) : null}
      </div>
      {summary && <p className="text-sm text-foreground/90 whitespace-pre-line">{summary}</p>}
      {goal && goal !== summary && (
        <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
          <Target className="w-3.5 h-3.5 mt-0.5 shrink-0 text-primary" />
          <span><span className="font-medium text-foreground/80">Goal:</span> {goal}</span>
        </p>
      )}
    </div>
  );
}
