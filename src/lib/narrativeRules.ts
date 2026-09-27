// Pure rules for the narrative engine — single source lives in the shared module
// so the browser and the backend use exactly the same logic.
export {
  decideFactInsertion,
  validateThreadTransition,
  type FactDecision,
} from "../../supabase/functions/_shared/narrative/rules.ts";
