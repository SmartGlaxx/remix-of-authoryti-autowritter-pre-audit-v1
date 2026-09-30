import { useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ApiKeysCard } from "@/components/ApiKeysCard";

export default function AccountSettings() {
  const navigate = useNavigate();
  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 border-b border-border bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-3xl items-center gap-3 px-4">
          <Button variant="ghost" size="icon" onClick={() => navigate("/dashboard")} aria-label="Back"><ArrowLeft className="w-5 h-5" /></Button>
          <div className="min-w-0">
            <h1 className="text-xl font-serif font-semibold">Settings</h1>
            <p className="text-sm text-muted-foreground">Applies to all your books</p>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-3xl px-4 py-6">
        <ApiKeysCard />
      </main>
    </div>
  );
}
