import { ArrowUpCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { PersonaAvatar } from "./PersonaExtras";

export function PromoteButton({ onClick }: { onClick: () => void }) {
  return <TooltipProvider><Tooltip><TooltipTrigger asChild><Button size="sm" variant="outline" onClick={onClick}><ArrowUpCircle className="w-4 h-4" />Promote</Button></TooltipTrigger>
    <TooltipContent className="max-w-xs">Save this character in your Persona Library so you can develop their profile and use them in other books. Their current book and story stay unchanged.</TooltipContent>
  </Tooltip></TooltipProvider>;
}

export function PromotionCard({ name, profile, identity, character, onOpen, children }: {
  name: string; profile?: Record<string, any>; identity?: Record<string, any>; character?: Record<string, any>; onOpen: (url: string) => void; children: React.ReactNode;
}) {
  const personal = character?.identity ?? {};
  const personality = character?.personality ?? profile?.psychology ?? {};
  const fields = [
    ["Also known as", identity?.aliases ?? personal.nicknames],
    ["Age", personal.age], ["Occupation", personal.occupation], ["Background", character?.description],
    ["Personality", personality.coreType], ["Values", personality.coreValues],
    ["Strengths", personality.strengths], ["Flaws", personality.flaws ?? personality.flaw],
    ["Fears", personality.fears ?? personality.fear], ["Motivation", personality.desires ?? personality.motivation],
  ].map(([label, value]) => [label, Array.isArray(value) ? value.join(", ") : value]).filter(([, v]) => v != null && v !== "");
  return <div className="flex items-start gap-3 rounded-md border border-border bg-background p-3">
    {character?.portraitUrl && !profile?.portrait_path ? <Button size="icon" variant="ghost" className="h-14 w-14 shrink-0" aria-label={`View ${name} full size`} onClick={() => onOpen(character.portraitUrl)}><img src={character.portraitUrl} alt={name} className="h-14 w-14 rounded-full object-cover" /></Button> : <PersonaAvatar path={profile?.portrait_path} name={name} onOpen={onOpen} />}
    <div className="min-w-0 flex-1 space-y-2"><div className="font-medium break-words">{name}</div>
      {fields.length ? <ol className="list-decimal space-y-1 pl-4 text-xs marker:text-primary">{fields.map(([label, value]) => <li key={String(label)} className="break-words"><span className="text-muted-foreground">{label}: </span>{String(value)}</li>)}</ol> : <p className="text-xs text-muted-foreground">Personal details not recorded yet.</p>}
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  </div>;
}