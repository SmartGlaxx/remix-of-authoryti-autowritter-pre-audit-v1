/** Stable, book-type-aware opening guidance shared by live writing and previews. */
export function openingDirective(bookType: string): string {
  const common = `OPENING DISCIPLINE:
- Begin with the substance of this section, not a generic observation about a "particular kind of" feeling, silence, moment, or person. Do not open with "There's a particular kind of", "There is a certain kind of", or a similar abstract throat-clearing formula.
- Vary the shape of openings across sections. Do not reuse the same introductory syntax, even when the subject changes.
- If this section continues an unfinished scene or argument, resume at that precise point instead of manufacturing a fresh hook. Respect the section goal, established voice, format and any specified opening style; do not add events or claims merely to make the first line dramatic.`;

  if (bookType === "comic") return `${common}
- Start with a specific visual beat in the first panel; keep the required panel format.`;
  if (bookType === "drama") return `${common}
- Enter through a concrete onstage action, exchange or situation while keeping the required scene-heading and screenplay format.`;
  if (["novel", "fiction-serial", "short-story", "children", "biography", "memoir"].includes(bookType))
    return `${common}
- Where a new scene begins, enter the way the selected writer's voice naturally would, appropriate to the audience; the writer's own style decides the pace and pressure of the opening.`;
  if (bookType === "poetry") return `${common}
- Begin with a precise image, voice or rhythmic turn that fits the poem; do not force a prose hook.`;
  if (bookType === "cookbook") return `${common}
- Lead with the dish, technique or useful cooking detail, preserving recipe structure and measurements.`;
  if (["self-help", "business", "finance"].includes(bookType))
    return `${common}
- Lead with the specific problem, decision, concrete example or defensible insight the reader needs now. Advance the argument instead of restating a general premise; never invent figures or evidence for a punchy opening.`;
  return `${common}
- Lead with the specific question, finding, example, instruction or subject at hand. Preserve technical accuracy, citations and the required format; do not fabricate facts to make an opening sound bold.`;
}