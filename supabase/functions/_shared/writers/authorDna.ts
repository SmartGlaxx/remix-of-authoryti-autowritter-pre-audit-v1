// Real-author style DNA behind each AI avatar writer. Prompt-only: the avatar is told to write
// AS the real author's broad strengths, with a strict originality guardrail. Pure data + renderers.

export interface AuthorDna { id: string; name: string; genre: string; dna: string }

export const AUTHORS: AuthorDna[] = [
  { id: "chandler", name: "Raymond Chandler", genre: "Noir detective", dna: "wisecracking first-person cynicism, startling similes about people, rain-slick city mood, moral weariness" },
  { id: "leonard", name: "Elmore Leonard", genre: "Crime", dna: "dialogue-driven scenes, no authorial showing off, cool criminals talking past each other, leave out the parts readers skip" },
  { id: "chase", name: "James Hadley Chase", genre: "Hardboiled pulp", dna: "breathless forward momentum, short jagged sentences, predatory characters, money and danger, every chapter ends on a threat" },
  { id: "hammett", name: "Dashiell Hammett", genre: "Hardboiled", dna: "flat objective narration, terse action, violence without commentary, characters judged only by what they do" },
  { id: "lecarre", name: "John le Carré", genre: "Espionage", dna: "melancholy moral ambiguity, tired professionals, layered dialogue full of what is not said, betrayal as the core wound" },
  { id: "christie", name: "Agatha Christie", genre: "Classic mystery", dna: "clean readable prose, a closed circle of suspects, fair-play clues hidden in plain conversation, brisk chapters, a shocking but logical solution" },
  { id: "doyle", name: "Arthur Conan Doyle", genre: "Detective", dna: "a brilliant eccentric seen through a loyal companion's eyes, vivid deductions from small human details, Victorian adventure energy" },
  { id: "sayers", name: "Dorothy L. Sayers", genre: "Literary mystery", dna: "witty erudite banter, rich social texture, romance braided with detection, moral seriousness under the sparkle" },
  { id: "pdjames", name: "P. D. James", genre: "Literary crime", dna: "deep psychological portraits of every suspect, institutional settings, grave measured prose, the cost of murder on the living" },
  { id: "simenon", name: "Georges Simenon", genre: "Psychological detective", dna: "spare atmospheric prose, empathy for the guilty, the detective soaking up a place until people reveal themselves" },
  { id: "french", name: "Tana French", genre: "Psychological crime", dna: "intimate obsessive first person, lyrical dread, the investigator's own past cracking open, place as a character" },
  { id: "jewell", name: "Lisa Jewell", genre: "Domestic suspense", dna: "multiple ordinary viewpoints, secrets inside homes and families, warm voice turning sinister, page-turning reveals" },
  { id: "picoult", name: "Jodi Picoult", genre: "Moral domestic drama", dna: "rotating viewpoints on one moral dilemma, courtroom and family stakes, emotional clarity, a late reversal" },
  { id: "hannah", name: "Kristin Hannah", genre: "Family saga", dna: "sweeping emotional arcs, women enduring hardship, strong sense of era, love and sacrifice across years" },
  { id: "dostoevsky", name: "Fyodor Dostoevsky", genre: "Literary psychological", dna: "feverish inner conflict, long charged arguments about faith and guilt, characters at moral extremes" },
  { id: "tolstoy", name: "Leo Tolstoy", genre: "Literary epic", dna: "panoramic clarity, deep empathy moving between minds, ordinary moments revealing whole lives, moral seeking" },
  { id: "hemingway", name: "Ernest Hemingway", genre: "Literary minimalism", dna: "iceberg understatement, short declarative sentences, emotion carried by what is left unsaid, physical courage and loss" },
  { id: "dickens", name: "Charles Dickens", genre: "Social novel", dna: "vivid eccentric characters with memorable tics, humour and pathos, social injustice, big coincidences and warm endings" },
  { id: "adichie", name: "Chimamanda Ngozi Adichie", genre: "Contemporary literary", dna: "clear intimate prose, identity, family and politics felt through daily life, sharp social observation" },
  { id: "ng", name: "Celeste Ng", genre: "Contemporary literary", dna: "quiet omniscient intimacy, family secrets, small-town pressure, a tragedy unfolding from many sides" },
  { id: "didion", name: "Joan Didion", genre: "Essay & memoir", dna: "cool precise sentences, unsentimental self-scrutiny, telling detail, rhythmic repetition, dread under the surface" },
  { id: "austen", name: "Jane Austen", genre: "Romance & manners", dna: "ironic narrator, sparkling social dialogue, misjudgement corrected, romance through wit and restraint" },
  { id: "bronte", name: "Charlotte Brontë", genre: "Gothic romance", dna: "passionate first-person interiority, independent heroine, brooding atmosphere, moral courage over convenience" },
  { id: "roberts", name: "Nora Roberts", genre: "Romance", dna: "warm accessible voice, strong heroines, sizzling banter, community settings, romance with suspense" },
  { id: "heyer", name: "Georgette Heyer", genre: "Regency romance", dna: "comic period dialogue, lively social farce, spirited heroines, playful slang of an era" },
  { id: "rooney", name: "Sally Rooney", genre: "Contemporary romance", dna: "spare unquoted-feeling intimacy, miscommunication, class and power between lovers, emotional precision" },
  { id: "reid", name: "Taylor Jenkins Reid", genre: "Contemporary fiction", dna: "confessional documentary-style voice, glamour and its costs, flawed magnetic women, propulsive reveals" },
  { id: "moyes", name: "Jojo Moyes", genre: "Romantic drama", dna: "funny tender heroines, life-changing encounters, humour beside heartbreak, accessible warmth" },
  { id: "asimov", name: "Isaac Asimov", genre: "Science fiction", dna: "idea-driven clarity, puzzles of logic, plain dialogue debating consequences, big timescales" },
  { id: "leguin", name: "Ursula K. Le Guin", genre: "Speculative", dna: "anthropological imagination, quiet lyrical wisdom, cultures and balance, moral depth without preaching" },
  { id: "pkdick", name: "Philip K. Dick", genre: "Paranoid sci-fi", dna: "reality slipping, ordinary schlubs in strange systems, identity doubt, dark humour" },
  { id: "herbert", name: "Frank Herbert", genre: "Epic sci-fi", dna: "political and ecological scheming, layered inner monologue, prophecy and power, dense world logic" },
  { id: "gibson", name: "William Gibson", genre: "Cyberpunk", dna: "dense sensory street-tech prose, brand-and-data texture, cool outsiders, near-future noir" },
  { id: "caro", name: "Robert Caro", genre: "Narrative nonfiction", dna: "monumental research worn lightly, power as the subject, scenes built from documents, patient escalation" },
  { id: "lewis", name: "Michael Lewis", genre: "Business nonfiction", dna: "explain complex systems through odd outsiders, funny clear storytelling, money and misfits" },
  { id: "isaacson", name: "Walter Isaacson", genre: "Biography", dna: "clear chronological storytelling, genius explained through traits and collaborators, balanced judgement" },
  { id: "mcphee", name: "John McPhee", genre: "Creative nonfiction", dna: "structure as art, curious immersion in a subject, precise plain language, characters who are experts" },
  { id: "wodehouse", name: "P. G. Wodehouse", genre: "Comic fiction", dna: "bubbling comic similes, farcical plots, sunny absurdity, impeccable comic timing" },
  { id: "vonnegut", name: "Kurt Vonnegut", genre: "Satire", dna: "short chapters, deadpan dark humour, humane anger, simple sentences carrying big absurdities" },
  { id: "heller", name: "Joseph Heller", genre: "Satire", dna: "circular absurd logic, rapid-fire contradictory dialogue, institutional madness, comic despair" },
];

/** Avatar writer → real authors (first is the default voice). Avatars without an entry keep their own voice. */
export const AVATAR_AUTHORS: Record<string, string[]> = {
  marcus: ["chase"], sophia: ["austen"], julian: ["leguin"], ethan: ["wodehouse", "vonnegut", "heller"],
  maya: ["lewis"], adrian: ["caro"], daniel: ["isaacson"], priya: ["mcphee"], elena: ["didion"],
  vivian: ["chandler", "hammett"], rafe: ["leonard"], simon: ["lecarre"], harriet: ["christie", "sayers"],
  edmund: ["doyle"], margaret: ["pdjames", "french"], henri: ["simenon"], lena: ["jewell", "picoult"],
  rose: ["hannah", "moyes"], nikolai: ["dostoevsky", "tolstoy"], jack: ["hemingway"], thomas: ["dickens"],
  amara: ["adichie", "ng"], charlotte: ["bronte", "heyer"], bella: ["roberts", "reid"], niamh: ["rooney"],
  orson: ["asimov", "herbert"], zane: ["pkdick", "gibson"],
};

export function getAuthor(id: unknown): AuthorDna | null {
  return typeof id === "string" ? AUTHORS.find((a) => a.id === id) ?? null : null;
}

/** The real author a book writes as: the book's chosen author if it belongs to the avatar, else the avatar's default. */
export function resolveAuthor(writerId: string, authorId?: unknown): AuthorDna | null {
  const ids = AVATAR_AUTHORS[writerId] ?? [];
  const pick = typeof authorId === "string" && ids.includes(authorId) ? authorId : ids[0];
  return getAuthor(pick);
}

export const ORIGINALITY_RULES =
  "ORIGINALITY (strict, legal): write an entirely original work using only the author's broad strengths — voice, sentence rhythm, dialogue, description, emotional depth, pacing. " +
  "Never copy, remix or closely resemble their plots, conflicts, twists, characters, relationships or story structures. Never reuse their character names, places, signature scenes, titles or distinctive fictional elements. " +
  "Never quote or closely imitate distinctive passages of their prose. If an idea resembles one of their books, change it before writing. Never name the author in the text.";

export type AuthorStage = "idea" | "plan" | "chapter" | "section" | "draft";
const STAGE_TASK: Record<AuthorStage, string> = {
  idea: "Invent the concept, hook and twist the way this author's instincts would — original, never one of their books.",
  plan: "Shape the whole book's progression, escalation and ending the way this author paces a book.",
  chapter: "Plan this chapter's turns, stakes and chapter ending the way this author builds a chapter.",
  section: "Summarise each section the way this author would see the scene: what starts it, the human shift, where it stops.",
  draft: "Write the prose as this author would write it — open like them, move like them, end the section like them.",
};

/** One short reminder prompt, added at every expansion stage. */
export function authorVoiceDirective(writerName: string, author: AuthorDna | null, stage: AuthorStage): string {
  if (!author) return "";
  return `\n\nAUTHOR VOICE — you are ${writerName}, writing as ${author.name} (${author.genre}): ${author.dna}. ${STAGE_TASK[stage]}\n${ORIGINALITY_RULES}`;
}
