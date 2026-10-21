// Header switcher: jump between books that are being planned without leaving the planner.
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export function PlanningBookSwitcher({ bookId }: { bookId: string }) {
  const [books, setBooks] = useState<{ id: string; title: string }[]>([]);
  useEffect(() => {
    let live = true;
    (async () => {
      const { data: plans } = await supabase.from("book_master_plans").select("book_id").limit(500);
      const ids = [...new Set((plans ?? []).map((p) => p.book_id as string))];
      if (!ids.includes(bookId)) ids.push(bookId);
      const { data } = await supabase.from("books").select("id, title, updated_at").in("id", ids).order("updated_at", { ascending: false });
      if (live) setBooks((data ?? []).map((b) => ({ id: b.id, title: b.title || "Untitled book" })));
    })();
    return () => { live = false; };
  }, [bookId]);
  if (books.length < 2) return null;
  return (
    <Select value={bookId} onValueChange={(id) => { if (id !== bookId) window.location.assign(`/books/${id}/plan`); }}>
      <SelectTrigger className="h-8 w-[180px] sm:w-[220px] text-xs" aria-label="Switch book"><SelectValue placeholder="Switch book" /></SelectTrigger>
      <SelectContent>{books.map((b) => <SelectItem key={b.id} value={b.id} className="text-xs">{b.title}</SelectItem>)}</SelectContent>
    </Select>
  );
}
