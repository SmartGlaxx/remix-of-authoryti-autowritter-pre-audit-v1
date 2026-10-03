import { useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { WriterStudio } from "@/components/WriterStudio";

export default function TryWriter() {
  const navigate = useNavigate();
  const writerId = new URLSearchParams(window.location.search).get("writer") ?? undefined;
  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 border-b border-border bg-background/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-7xl items-center gap-3 px-4">
          <Button variant="ghost" size="icon" onClick={() => navigate("/dashboard")} aria-label="Back"><ArrowLeft className="h-5 w-5" /></Button>
          <h1 className="font-serif text-xl font-semibold">Try a Writer</h1>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6">
        <WriterStudio initialWriterId={writerId} onUse={(id, tier) => navigate(`/dashboard?writer=${id}&tier=${tier}`)} />
      </main>
    </div>
  );
}