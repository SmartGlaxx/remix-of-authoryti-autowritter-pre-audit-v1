/** Stable craft directive banning procedural/process narration, shared by live writing and previews. */
export function dramaticActionDirective(bookType: string): string {
  if (!["novel", "fiction-serial", "short-story", "biography", "memoir"].includes(bookType)) return "";
  return `DRAMATIC ACTION RULE (STRICTLY ENFORCED — manuals carry processes, novels do not):
- NEVER narrate the process of finding things out. No step-by-step research, auditing, cross-referencing, file-by-file checking, data transfers, logins, or mechanical workflows. If a character investigates, write the dread BEFORE, the discovery in ONE striking sentence, and the human reaction AFTER — never the method between.
- NEVER explain how a system, account, device, or procedure works. No paragraphs about accounts, spreadsheets, reconciliation, transfers, logins, or technical internals. A reader who does not understand the mechanism must still feel the stakes.
- Jump-cut the mechanics. "Three hours later, she had her answer" is always stronger than three hours of steps.
- One fact of consequence lands in one sentence. Two sentences maximum per revelation, then move on to what it costs the character.
- Facts are dead weight; feelings are the payload. Anchor every scene in what the viewpoint character fears, wants, or realizes — physical reaction, not explanation.
- Show consequences, not procedures: a dry mouth, a stopped breath, a room turning cold. The reader must feel the scene, not read instructions for it.`;
}
