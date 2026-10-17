import { NaturalnessSettingsCard } from "@/components/NaturalnessSettingsCard";
import { LiteraryReviserSettingsCard } from "@/components/LiteraryReviserSettingsCard";
import { WriterVersionLockCard } from "@/components/WriterVersionLockCard";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { WriterPicker } from "@/components/WriterPicker";
import { bestWriterFor } from "../../supabase/functions/_shared/writers/personas";
import { motion } from "framer-motion";
import { ArrowLeft, BookOpen, Palette, Sliders, Settings2, Sparkles, Globe, Clock, Layers } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
import { ModelConfigCard } from "@/components/ModelConfigCard";
import { Link } from "react-router-dom";
import { SLIDERS, resolveDivergence, DIVERGENCE_OPTIONS } from "../../supabase/functions/_shared/writers/sliders";
import { effectiveSlidersFor } from "../../supabase/functions/_shared/writers/manifest";

import {
  Book,
  BOOK_TYPE_INFO,
  POV_OPTIONS,
  NARRATIVE_VANTAGE_OPTIONS,
  type NarrativeVantage,
  TONE_OPTIONS,
  AUTOMATION_OPTIONS,
  DEPTH_OPTIONS,
  TEMPORAL_ERA_OPTIONS,
  TIMELINE_OPTIONS,
  SPATIAL_SCOPE_OPTIONS,
  AUDIENCE_OPTIONS,
} from "@/types/book";

interface BookSettingsProps {
  book: Book;
  onBack: () => void;
}

const BookSettings = ({ book, onBack }: BookSettingsProps) => {
  const [writerId, setWriterId] = useState<string | undefined>(book.controls.writerId);
  const saveWriter = async (id: string) => {
    const prev = writerId;
    setWriterId(id);
    const { error } = await supabase.from("books").update({ controls: { ...book.controls, writerId: id } as never }).eq("id", book.id);
    if (error) { setWriterId(prev); toast.error("Couldn't change the writer."); return; }
    book.controls.writerId = id;
    toast.success("Writer updated");
  };
  const [contextEngine, setContextEngine] = useState<"legacy" | "adaptive">((book.controls as { context_engine?: string }).context_engine === "adaptive" ? "adaptive" : "legacy");
  const saveEngine = async (m: "legacy" | "adaptive") => {
    const prev = contextEngine;
    setContextEngine(m);
    const next = { ...book.controls, context_engine: m };
    const { error } = await supabase.from("books").update({ controls: next as never }).eq("id", book.id);
    if (error) { setContextEngine(prev); toast.error("Couldn't change memory mode."); return; }
    (book.controls as { context_engine?: string }).context_engine = m;
    toast.success(m === "adaptive" ? "Adaptive memory on" : "Standard memory on");
  };
  const [vantage, setVantage] = useState<NarrativeVantage>(book.narrativeVantage ?? "immediate");
  const vantageLocked = (book.wordCount ?? 0) > 0;
  const saveVantage = async (v: NarrativeVantage) => {
    if (vantageLocked || v === vantage) return;
    const prev = vantage;
    setVantage(v);
    const { error } = await supabase.from("books").update({ narrative_vantage: v }).eq("id", book.id);
    if (error) { setVantage(prev); toast.error("This can only change before writing starts."); return; }
    book.narrativeVantage = v;
    toast.success("Storytelling moment updated");
  };
  const sliders = effectiveSlidersFor({ bookType: book.bookType, toneProfile: book.toneProfile, controls: book.controls });
  const divergence = resolveDivergence(book.controls as never);
  const typeInfo = BOOK_TYPE_INFO[book.bookType];
  const povOption = POV_OPTIONS.find((p) => p.value === book.pov);
  const primaryTone = TONE_OPTIONS.find((t) => t.value === book.toneProfile.primary);
  const secondaryTone = book.toneProfile.secondary 
    ? TONE_OPTIONS.find((t) => t.value === book.toneProfile.secondary) 
    : null;
  const automationOption = AUTOMATION_OPTIONS.find((a) => a.value === book.controls.automationLevel);
  const depthOption = DEPTH_OPTIONS.find((d) => d.value === book.controls.depthLevel);
  const eraOption = TEMPORAL_ERA_OPTIONS.find((e) => e.value === book.controls.temporalContext?.era);
  const timelineOption = TIMELINE_OPTIONS.find((t) => t.value === book.controls.temporalContext.timelineStructure);
  const spatialOption = SPATIAL_SCOPE_OPTIONS.find((s) => s.value === book.controls.spatialScope);
  const audienceOption = AUDIENCE_OPTIONS.find((a) => a.value === book.audience);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="min-h-screen min-w-0 bg-background"
    >
      {/* Header */}
      <header className="sticky top-0 z-40 glass border-b">
        <div className="mx-auto w-full max-w-6xl px-4 py-3 sm:py-4 lg:max-w-[calc(100vw-16rem)]">
          <div className="flex min-w-0 items-center gap-3 sm:gap-4">
            <Button variant="ghost" size="icon" onClick={onBack} aria-label="Back to book" className="shrink-0">
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <div className="min-w-0">
              <h1 className="text-xl font-serif font-semibold">Book Settings</h1>
              <p className="truncate text-sm text-muted-foreground">{book.title}</p>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full min-w-0 max-w-6xl px-4 py-4 pb-8 sm:py-6 lg:max-w-[calc(100vw-16rem)]">
          <div className="min-w-0 space-y-4 sm:space-y-6">
            <ModelConfigCard bookId={book.id} writerId={writerId ?? bestWriterFor(book.bookType).id} />
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Writing speed</CardTitle>
                <p className="text-xs text-muted-foreground">Fast draft writes each section with the quick model and lets story memory update in the background. Studio audit uses the deep-thinking writer and re-checks every section after it is written.</p>
              </CardHeader>
              <CardContent>
                <div className="flex gap-2">
                  {(["fast", "studio"] as const).map((m) => {
                    const active = ((book.controls as { writingSpeed?: string }).writingSpeed ?? "fast") === m;
                    return (
                      <Button key={m} variant={active ? "default" : "outline"} size="sm" className="rounded-full"
                        onClick={async () => {
                          const next = { ...book.controls, writingSpeed: m };
                          const { error } = await supabase.from("books").update({ controls: next as never }).eq("id", book.id);
                          if (!error) (book.controls as { writingSpeed?: string }).writingSpeed = m;
                        }}>
                        {m === "fast" ? "Fast draft" : "Studio audit"}
                      </Button>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
            <NaturalnessSettingsCard bookId={book.id} controls={book.controls as unknown as Record<string, unknown>} />
            <LiteraryReviserSettingsCard bookId={book.id} controls={book.controls as unknown as Record<string, unknown>} />
            <WriterVersionLockCard bookId={book.id} writerId={writerId ?? bestWriterFor(book.bookType).id} controls={book.controls as unknown as Record<string, unknown>} />
            <Card>
              <CardHeader className="pb-3">
                 <CardTitle className="text-base">Writer</CardTitle>
                <p className="text-xs text-muted-foreground">The virtual author whose voice shapes this book. Applies to sections written from now on.</p>
              </CardHeader>
              <CardContent>
                <WriterPicker bookType={book.bookType} value={writerId} onChange={saveWriter} />
              </CardContent>
            </Card>
            <p className="text-xs text-muted-foreground">Your API keys apply to all books — manage them in <Link to="/settings" className="text-primary underline">Settings</Link>.</p>
            {/* Book Type Section */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <BookOpen className="w-4 h-4 text-primary" />
                  Book Type
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg">
                  <span className="text-3xl">{typeInfo.icon}</span>
                  <div>
                    <p className="font-medium">{typeInfo.label}</p>
                    <p className="text-sm text-muted-foreground">{typeInfo.description}</p>
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
                  <InfoRow label="Category" value={typeInfo.category.replace("-", " ")} />
                  {book.genre && <InfoRow label="Genre" value={book.genre} />}
                </div>
              </CardContent>
            </Card>

            {/* Book Details Section */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-primary" />
                  Book Details
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-3">
                  <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-wide">Title</p>
                    <p className="font-serif text-lg font-medium">{book.title}</p>
                  </div>
                  {book.subtitle && (
                    <div>
                      <p className="text-xs text-muted-foreground uppercase tracking-wide">Subtitle</p>
                      <p className="text-muted-foreground">{book.subtitle}</p>
                    </div>
                  )}
                  <Separator />
                  <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-wide">Theme / Prompt</p>
                    <p className="mt-1 p-3 bg-muted/50 rounded-lg text-sm">{book.theme}</p>
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
                  <InfoRow 
                    label="Target Audience" 
                    value={audienceOption?.label || book.audience} 
                  />
                  <InfoRow 
                    label="Depth Level" 
                    value={depthOption?.label || book.controls.depthLevel} 
                  />
                  <InfoRow 
                    label="Automation" 
                    value={automationOption?.label || book.controls.automationLevel} 
                  />
                </div>
              </CardContent>
            </Card>

            {/* Voice & Tone Section */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Palette className="w-4 h-4 text-primary" />
                  Voice & Tone
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-wide mb-2">Point of View</p>
                    <Badge variant="secondary" className="text-sm">
                      {povOption?.label || book.pov}
                    </Badge>
                    {povOption && (
                      <p className="text-xs text-muted-foreground mt-1">{povOption.description}</p>
                    )}
                    {book.pov === "first-person" && (
                      <div className="mt-3 space-y-1.5">
                        <p className="text-xs text-muted-foreground uppercase tracking-wide">When is the story told?</p>
                        <div className="flex flex-wrap gap-1.5">
                          {NARRATIVE_VANTAGE_OPTIONS.map((o) => (
                            <Button key={o.value} size="sm" variant={vantage === o.value ? "default" : "outline"}
                              disabled={vantageLocked} onClick={() => saveVantage(o.value)} title={o.description}>
                              {o.label}
                            </Button>
                          ))}
                        </div>
                        {vantageLocked && <p className="text-xs text-muted-foreground">Locked once writing has started.</p>}
                      </div>
                    )}
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-wide mb-2">Primary Tone</p>
                    <Badge variant="amber" className="text-sm">
                      {primaryTone?.emoji} {primaryTone?.label || book.toneProfile.primary}
                    </Badge>
                    {primaryTone && (
                      <p className="text-xs text-muted-foreground mt-1">{primaryTone.description}</p>
                    )}
                  </div>
                </div>
                {secondaryTone && (
                  <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-wide mb-2">Secondary Tone</p>
                    <Badge variant="outline" className="text-sm">
                      {secondaryTone.emoji} {secondaryTone.label}
                    </Badge>
                  </div>
                )}
                <Separator />
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">
                  {SLIDERS.filter((x) => x.group === "tone").map((x) => <ToneSlider key={x.key} label={x.label} value={sliders[x.key]} />)}
                </div>
              </CardContent>
            </Card>

            {/* Dynamism Controls Section */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Sliders className="w-4 h-4 text-primary" />
                  Dynamism Controls
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-4">
                  {SLIDERS.filter((x) => x.group === "dynamism").map((x) => <ControlSlider key={x.key} label={x.label} value={sliders[x.key]} description={x.hint} />)}
                </div>
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide mb-2">Story Divergence</p>
                  <Badge variant={divergence === "strict" ? "secondary" : "success"}>{DIVERGENCE_OPTIONS.find((d) => d.value === divergence)?.label}</Badge>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide mb-2">Memory Mode (test)</p>
                  <div className="flex flex-wrap gap-2">
                    {(["legacy", "adaptive"] as const).map((m) => (
                      <Button key={m} size="sm" variant={contextEngine === m ? "default" : "outline"} onClick={() => saveEngine(m)}>
                        {m === "legacy" ? "Standard" : "Adaptive"}
                      </Button>
                    ))}
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">Adaptive picks only the most relevant earlier material for each new section. Used for side-by-side testing.</p>
                </div>
              </CardContent>
            </Card>

            {/* Temporal & Spatial Section */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Clock className="w-4 h-4 text-primary" />
                  Temporal & Spatial Context
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
                  <InfoRow label="Era" value={eraOption?.label || book.controls.temporalContext?.era} />
                  <InfoRow label="Timeline Structure" value={timelineOption?.label || book.controls.temporalContext.timelineStructure} />
                  {book.controls.temporalContext.specificPeriod && (
                    <InfoRow label="Specific Period" value={book.controls.temporalContext.specificPeriod} />
                  )}
                </div>
                <Separator />
                <div className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
                  <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-wide mb-2">Spatial Scope</p>
                    <div className="flex items-center gap-2">
                      <Globe className="w-4 h-4 text-muted-foreground" />
                      <span className="font-medium">{spatialOption?.label || book.controls.spatialScope}</span>
                    </div>
                    {spatialOption && (
                      <p className="text-xs text-muted-foreground mt-1">{spatialOption.description}</p>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Structure & Generation Section */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Settings2 className="w-4 h-4 text-primary" />
                  Structure & Generation
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2 md:grid-cols-3">
                  <InfoRow 
                    label="Chapter Count" 
                    value={book.controls.structureControls.chapterCount === "fixed" 
                      ? `Fixed (${book.controls.structureControls.targetChapters || "N/A"})` 
                      : "Flexible"} 
                  />
                  <InfoRow 
                    label="Subsection Count" 
                    value={book.controls.structureControls.subsectionCount === "fixed" 
                      ? `Fixed (${book.controls.structureControls.targetSubsections || "N/A"})` 
                      : "Flexible"} 
                  />
                  <InfoRow 
                    label="Titles Required" 
                    value={book.controls.structureControls.titlesRequired ? "Yes" : "No"} 
                  />
                  {book.controls.structureControls.targetWordCount && (
                    <InfoRow 
                      label="Target Word Count" 
                      value={book.controls.structureControls.targetWordCount.toLocaleString()} 
                    />
                  )}
                </div>
                <Separator />
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <ToggleBadge label="Image Generation" enabled={book.controls.imageGeneration} />
                  <ToggleBadge label="Auto Resume" enabled={book.controls.autoResume} />
                  
                </div>
              </CardContent>
            </Card>

            {/* Additional Metadata */}
            {(book.tonalAnchors.length > 0 || book.entities.length > 0 || book.concepts.length > 0) && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Layers className="w-4 h-4 text-primary" />
                    Extracted Metadata
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {book.tonalAnchors.length > 0 && (
                    <div>
                      <p className="text-xs text-muted-foreground uppercase tracking-wide mb-2">Tonal Anchors</p>
                      <div className="flex flex-wrap gap-1">
                        {book.tonalAnchors.map((anchor, i) => (
                          <Badge key={i} variant="outline" className="max-w-full break-words whitespace-normal text-xs">{anchor}</Badge>
                        ))}
                      </div>
                    </div>
                  )}
                  {book.entities.length > 0 && (
                    <div>
                      <p className="text-xs text-muted-foreground uppercase tracking-wide mb-2">Entities</p>
                      <div className="flex flex-wrap gap-1">
                        {book.entities.map((entity, i) => (
                          <Badge key={i} variant="secondary" className="max-w-full break-words whitespace-normal text-xs">{entity}</Badge>
                        ))}
                      </div>
                    </div>
                  )}
                  {book.concepts.length > 0 && (
                    <div>
                      <p className="text-xs text-muted-foreground uppercase tracking-wide mb-2">Concepts</p>
                      <div className="flex flex-wrap gap-1">
                        {book.concepts.map((concept, i) => (
                          <Badge key={i} variant="default" className="max-w-full break-words whitespace-normal text-xs">{concept}</Badge>
                        ))}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </div>
      </main>
    </motion.div>
  );
};

// Helper components
const InfoRow = ({ label, value }: { label: string; value: string }) => (
  <div className="min-w-0">
    <p className="text-xs text-muted-foreground">{label}</p>
    <p className="break-words font-medium capitalize">{value}</p>
  </div>
);

const ToneSlider = ({ label, value }: { label: string; value: number }) => (
  <div>
    <div className="flex justify-between text-xs mb-1">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}/10</span>
    </div>
    <Progress value={value * 10} className="h-1.5" />
  </div>
);

const ControlSlider = ({ label, value, description }: { label: string; value: number; description: string }) => (
  <div>
    <p className="text-xs text-muted-foreground uppercase tracking-wide">{label}</p>
    <div className="flex items-baseline gap-2">
      <span className="text-2xl font-bold text-primary">{value}</span>
      <span className="text-xs text-muted-foreground">/10</span>
    </div>
    <p className="text-xs text-muted-foreground">{description}</p>
    <Progress value={value * 10} className="h-1 mt-1" />
  </div>
);

const ToggleBadge = ({ label, enabled }: { label: string; enabled: boolean }) => (
  <div className="text-center">
    <p className="text-xs text-muted-foreground mb-1">{label}</p>
    <Badge variant={enabled ? "success" : "secondary"} className="text-xs">
      {enabled ? "On" : "Off"}
    </Badge>
  </div>
);

export default BookSettings;
