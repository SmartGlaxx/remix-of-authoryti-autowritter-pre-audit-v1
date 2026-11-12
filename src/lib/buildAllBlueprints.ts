type Plan = { plan_level: string; chapter_index: number; plan_status: string };
type Result = { ok: boolean; data: { error?: string; issues?: string[] } };

/** Build missing blueprints serially; never rebuild or approve existing plans. */
export async function buildAllBlueprints(options: {
  bookId: string;
  masterPlanId: string;
  chapters: number[];
  plans: Plan[];
  call: (body: Record<string, unknown>) => Promise<Result>;
  onProgress: (done: number, total: number, chapter: number) => void;
  shouldStop: () => boolean;
}) {
  const pending = [...new Set(options.chapters)].sort((a, b) => a - b).filter((chapter) =>
    !options.plans.some((p) => p.chapter_index === chapter && p.plan_level === "BLUEPRINT" && ["PLANNED", "READY"].includes(p.plan_status)));
  let done = 0;
  for (const chapter of pending) {
    if (options.shouldStop()) break;
    options.onProgress(done, pending.length, chapter);
    const result = await options.call({ action: "blueprint", bookId: options.bookId, masterPlanId: options.masterPlanId, chapter, requestId: crypto.randomUUID() });
    if (!result.ok) throw new Error(`Chapter ${chapter + 1}: ${[result.data.error, ...(result.data.issues ?? []).slice(0, 3)].filter(Boolean).join(" · ") || "Blueprint failed"}`);
    options.onProgress(++done, pending.length, chapter);
  }
  return { done, total: pending.length };
}