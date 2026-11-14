import type { Book } from "@/types/book";
import type { ContentUnit } from "../../../supabase/functions/_shared/pageDesign/paginate";

export interface DesignUnit extends ContentUnit { images: { url: string; alt: string }[]; chapterTitle: string }

const strip = (html: string) => html.replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>/gi, "\n\n").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");

/** One design unit per written section, using the real manuscript text and its illustration. */
export function unitsFromBook(book: Book): DesignUnit[] {
  const out: DesignUnit[] = [];
  for (const ch of book.outline?.chapters ?? []) {
    ch.subsections.forEach((s, i) => {
      const text = strip(s.content ?? "").trim();
      if (!text) return;
      out.push({ pageKey: s.id, heading: i === 0 ? ch.title : undefined, text, chapterTitle: ch.title, images: s.imageUrl && /^https:\/\//.test(s.imageUrl) ? [{ url: s.imageUrl, alt: s.imageOpportunity?.slice(0, 200) || s.title || ch.title }] : [] });
    });
  }
  return out;
}

/** Every illustration in the book, for the "replace picture" picker. */
export function bookIllustrations(book: Book): { url: string; alt: string }[] {
  const seen = new Set<string>(); const out: { url: string; alt: string }[] = [];
  const add = (url: string | undefined, alt: string) => { if (url && /^https:\/\//.test(url) && !seen.has(url)) { seen.add(url); out.push({ url, alt }); } };
  for (const ch of book.outline?.chapters ?? []) for (const s of ch.subsections) add(s.imageUrl, s.title || ch.title);
  add(book.coverUrl, "Cover");
  return out;
}
