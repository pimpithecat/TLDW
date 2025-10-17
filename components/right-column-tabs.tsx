"use client";

import { useState, useEffect, useImperativeHandle, forwardRef, useMemo } from "react";
import { TranscriptViewer } from "@/components/transcript-viewer";
import { AIChat } from "@/components/ai-chat";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FileText, Lightbulb, Loader2, PenLine } from "lucide-react";
import { TranscriptSegment, Topic, Citation, Note, NoteSource, NoteMetadata } from "@/lib/types";
import { SelectionActionPayload } from "@/components/selection-actions";
import { NotesPanel, EditingNote } from "@/components/notes-panel";
import { cn } from "@/lib/utils";
import { SummaryViewer } from "@/components/summary-viewer";
import { Skeleton } from "@/components/ui/skeleton";
import { TooltipProvider } from "@/components/ui/tooltip";

interface RightColumnTabsProps {
  transcript: TranscriptSegment[];
  selectedTopic: Topic | null;
  onTimestampClick: (seconds: number, endSeconds?: number, isCitation?: boolean, citationText?: string, isWithinHighlightReel?: boolean, isWithinCitationHighlight?: boolean) => void;
  onTakeawayTimestampClick?: (seconds: number) => void;
  currentTime?: number;
  topics?: Topic[];
  citationHighlight?: Citation | null;
  videoId: string;
  videoTitle?: string;
  onCitationClick: (citation: Citation) => void;
  onPlayAllCitations?: (citations: Citation[]) => void;
  takeawaysContent?: string | null;
  isGeneratingTakeaways?: boolean;
  takeawaysError?: string;
  showTakeawaysTab?: boolean;
  cachedSuggestedQuestions?: string[] | null;
  onRetryTakeaways?: () => void;
  notes?: Note[];
  onSaveNote?: (payload: { text: string; source: NoteSource; sourceId?: string | null; metadata?: NoteMetadata | null }) => Promise<void>;
  onTakeNoteFromSelection?: (payload: SelectionActionPayload) => void;
  editingNote?: EditingNote | null;
  onSaveEditingNote?: (noteText: string) => void;
  onCancelEditing?: () => void;
  isAuthenticated?: boolean;
  onRequestSignIn?: () => void;
}

export interface RightColumnTabsHandle {
  switchToTranscript: () => void;
  switchToTakeaways?: () => void;
  switchToNotes: () => void;
}

export const RightColumnTabs = forwardRef<RightColumnTabsHandle, RightColumnTabsProps>(({
  transcript,
  selectedTopic,
  onTimestampClick,
  onTakeawayTimestampClick,
  currentTime,
  topics,
  citationHighlight,
  videoId,
  videoTitle,
  onCitationClick,
  onPlayAllCitations,
  takeawaysContent,
  isGeneratingTakeaways,
  takeawaysError,
  showTakeawaysTab,
  cachedSuggestedQuestions,
  onRetryTakeaways,
  notes,
  onSaveNote,
  onTakeNoteFromSelection,
  editingNote,
  onSaveEditingNote,
  onCancelEditing,
  isAuthenticated,
  onRequestSignIn,
}, ref) => {
  const [activeTab, setActiveTab] = useState<"transcript" | "takeaways" | "notes">(showTakeawaysTab ? "takeaways" : "transcript");
  const [hasShownTakeaways, setHasShownTakeaways] = useState<boolean>(!!showTakeawaysTab);

  // Expose methods to parent to switch tabs
  useImperativeHandle(ref, () => ({
    switchToTranscript: () => {
      setActiveTab("transcript");
    },
    switchToTakeaways: () => {
      if (showTakeawaysTab) {
        setActiveTab("takeaways");
      }
    },
    switchToNotes: () => {
      setActiveTab("notes");
    }
  }));

  useEffect(() => {
    if (showTakeawaysTab && !hasShownTakeaways) {
      setActiveTab("takeaways");
      setHasShownTakeaways(true);
    }
    if (!showTakeawaysTab && activeTab === "takeaways") {
      setActiveTab("transcript");
    }
  }, [showTakeawaysTab, hasShownTakeaways, activeTab]);

  const takeawaysSection = useMemo(() => {
    if (!showTakeawaysTab) {
      return null;
    }

    const handleTimestamp = onTakeawayTimestampClick || onTimestampClick;

    if (isGeneratingTakeaways) {
      return (
        <div className="space-y-2">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-11/12" />
          <Skeleton className="h-4 w-4/5" />
        </div>
      );
    }

    if (takeawaysError) {
      return (
        <p className="text-sm text-destructive">
          {takeawaysError}
        </p>
      );
    }

    if (takeawaysContent) {
      return (
        <SummaryViewer
          content={takeawaysContent}
          onTimestampClick={handleTimestamp}
          collapsibleSections={false}
          onRetry={onRetryTakeaways}
          showActions={true}
          onSaveNote={onSaveNote}
        />
      );
    }

    return (
      <p className="text-sm text-muted-foreground">
        Takeaways will appear here once ready.
      </p>
    );
  }, [showTakeawaysTab, isGeneratingTakeaways, takeawaysError, takeawaysContent, onTakeawayTimestampClick, onTimestampClick, onRetryTakeaways, onSaveNote]);

  return (
    <Card className="h-full flex flex-col overflow-hidden p-0 gap-0 border-0">
      <div className="flex items-center gap-2 p-2 rounded-t-3xl border-b">
        {showTakeawaysTab && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setActiveTab("takeaways")}
            className={cn(
              "flex-1 justify-center gap-2 rounded-2xl",
              activeTab === "takeaways"
                ? "bg-neutral-100 text-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-white/50"
            )}
          >
            {isGeneratingTakeaways ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Lightbulb className="h-4 w-4" />
            )}
            Takeaways
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setActiveTab("transcript")}
          className={cn(
            "flex-1 justify-center gap-2 rounded-2xl",
            activeTab === "transcript"
              ? "bg-neutral-100 text-foreground"
              : "text-muted-foreground hover:text-foreground hover:bg-white/50"
          )}
        >
          <FileText className="h-4 w-4" />
          Transcript
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setActiveTab("notes")}
          className={cn(
            "flex-1 justify-center gap-2 rounded-2xl",
            activeTab === "notes"
              ? "bg-neutral-100 text-foreground"
              : "text-muted-foreground hover:text-foreground hover:bg-white/50",
            notes?.length ? undefined : "opacity-75"
          )}
        >
          <PenLine className="h-4 w-4" />
          Notes
        </Button>
      </div>
      
      <div className="flex-1 overflow-hidden relative">
        {/* Keep both components mounted but toggle visibility */}
        <div className={cn("absolute inset-0", activeTab !== "transcript" && "hidden")}>
          <TranscriptViewer
            transcript={transcript}
            selectedTopic={selectedTopic}
            onTimestampClick={onTimestampClick}
            currentTime={currentTime}
            topics={topics}
            citationHighlight={citationHighlight}
            onTakeNoteFromSelection={onTakeNoteFromSelection}
            videoId={videoId}
          />
        </div>
        <div className={cn("absolute inset-0", (activeTab !== "takeaways" || !showTakeawaysTab) && "hidden")}>
          <AIChat
            transcript={transcript}
            topics={topics || []}
            videoId={videoId}
            videoTitle={videoTitle}
            onCitationClick={onCitationClick}
            onTimestampClick={onTimestampClick}
            onPlayAllCitations={onPlayAllCitations}
            cachedSuggestedQuestions={cachedSuggestedQuestions}
            pinnedContent={takeawaysSection}
            onSaveNote={onSaveNote}
            onTakeNoteFromSelection={onTakeNoteFromSelection}
          />
        </div>
        <div className={cn("absolute inset-0", activeTab !== "notes" && "hidden")}
        >
          <TooltipProvider delayDuration={0}>
            <NotesPanel
              notes={notes}
              editingNote={editingNote}
              onSaveEditingNote={onSaveEditingNote}
              onCancelEditing={onCancelEditing}
              isAuthenticated={isAuthenticated}
              onSignInClick={onRequestSignIn}
            />
          </TooltipProvider>
        </div>
      </div>
    </Card>
  );
});

RightColumnTabs.displayName = "RightColumnTabs";
