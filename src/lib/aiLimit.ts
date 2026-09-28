// Session flag: once the AI service refuses access (e.g. workspace AI spending limit),
// stop making further optional AI calls instead of hammering a request that can't succeed.
import { toast } from "sonner";

let blocked = false;

export function isAiBlocked() {
  return blocked;
}

/** Returns true (and flips the flag) if the error text is a non-retryable AI access refusal. */
export function detectAiBlock(text: unknown): boolean {
  const s = typeof text === "string" ? text : JSON.stringify(text ?? "");
  if (/credit_limit_reached|denied access|"retryable":\s*false/i.test(s)) {
    if (!blocked) {
      blocked = true;
      toast.error("AI limit reached", {
        description: "Your workspace's AI spending limit was reached. Raise it, then reload to continue writing.",
        duration: 15000,
      });
    }
    return true;
  }
  return false;
}
