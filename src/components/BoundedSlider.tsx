import { cn } from "@/lib/utils";

/** 1–10 rail: only the writer's baseline ±2 window is selectable; the baseline is marked. */
export function BoundedSlider({ value, onChange, range, base, label }: { value: number; onChange: (v: number) => void; range: [number, number]; base?: number; label?: string }) {
  const [lo, hi] = range;
  const v = Math.min(hi, Math.max(lo, value));
  return (
    <div role="radiogroup" aria-label={label} className="flex gap-1 py-1">
      {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => {
        const allowed = n >= lo && n <= hi;
        const filled = allowed && n <= v;
        return (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={n === v}
            aria-label={`${n}`}
            disabled={!allowed}
            onClick={() => onChange(n)}
            className={cn(
              "relative h-3 flex-1 rounded-sm transition-colors",
              !allowed && "cursor-not-allowed bg-muted/40",
              allowed && !filled && "bg-primary/15 hover:bg-primary/30",
              filled && "bg-primary",
              n === v && "ring-2 ring-primary ring-offset-1 ring-offset-background",
            )}
          >
            {base === n && <span className="absolute -bottom-2 left-1/2 h-1.5 w-0.5 -translate-x-1/2 rounded bg-foreground/70" />}
          </button>
        );
      })}
    </div>
  );
}

export const offsetLabel = (value: number, base?: number) => (base == null || value === base ? "" : value > base ? ` (+${value - base})` : ` (${value - base})`);
