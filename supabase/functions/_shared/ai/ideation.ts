// Initial setup is independent of the writer chosen later; downstream planning keeps its config.
import type { BookModelConfig } from "./roles.ts";
export const INITIAL_IDEA_MODEL = "openai/gpt-6-sol";
const IDEA_ACTIONS = new Set(["alternatives", "concepts", "adjust_premise", "twists"]);
export function configForPlanningAction(action: string, config: BookModelConfig | null | undefined): BookModelConfig | null | undefined {
  return IDEA_ACTIONS.has(action) ? { mode: "single", singleModel: INITIAL_IDEA_MODEL } : config;
}
const text = { type: "string" };
const texts = { type: "array", items: text };
const object = (properties: Record<string, unknown>) => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });
const list = (key: string, properties: Record<string, unknown>) => object({ [key]: { type: "array", items: object(properties) } });
export function schemaForIdeaAction(action: string): Record<string, unknown> | undefined {
  switch (action) {
    case "alternatives": return list("alternatives", { title: text, logline: text, summary: text, twist: text, ending: text });
    case "concepts": return list("concepts", { title: text, coreThesis: text, approach: text, pillars: texts, readerOutcome: text, summary: text });
    case "adjust_premise": return object({ premise: text, changes: text });
    case "twists": return list("twists", { text, revealChapter: { type: "integer" }, clues: texts });
    default: return undefined;
  }
}