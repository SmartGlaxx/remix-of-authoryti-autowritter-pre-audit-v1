// Two-path book start: pure matching helpers (genre-first and writer-first converge on book type + writer).
import { WRITER_PERSONAS, genreSpecialistFor, type WriterPersona } from "../../supabase/functions/_shared/writers/personas";

/** Path 1: every writer who writes this book type, genre specialist first, then by book-type priority. */
export function writersForType(bookType: string, genre?: string | null): WriterPersona[] {
  const list = WRITER_PERSONAS.filter((w) => w.bookTypes.includes(bookType))
    .sort((a, b) => a.bookTypes.indexOf(bookType) - b.bookTypes.indexOf(bookType));
  const spec = genreSpecialistFor(genre, bookType);
  return spec ? [spec, ...list.filter((w) => w.id !== spec.id)] : list;
}

/** Path 2: the book types a writer excels at, in their priority order. */
export function typesForWriter(writerId: string): string[] {
  return WRITER_PERSONAS.find((w) => w.id === writerId)?.bookTypes ?? [];
}

/** Placeholder card sample until the in-app writing model generates the real one. */
export function sampleTemplate(w: WriterPersona): string {
  return `[Sample passage placeholder — about 200 words written by ${w.name}. ` +
    `It will be generated inside the app with the same model that writes the books. Voice: ${w.rhythm} ${w.signature}]`;
}
