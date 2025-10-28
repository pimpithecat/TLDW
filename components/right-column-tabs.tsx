"use client";

import { useState, useEffect, useImperativeHandle, forwardRef } from "react";
import { TranscriptViewer } from "@/components/transcript-viewer";
import { AIChat } from "@/components/ai-chat";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FileText, MessageSquare, PenLine } from "lucide-react";
import { TranscriptSegment, Topic, Citation, Note, NoteSource, NoteMetadata, VideoInfo } from "@/lib/types";
import { SelectionActionPayload } from "@/components/selection-actions";
import { NotesPanel, EditingNote } from "@/components/notes-panel";
import { cn } from "@/lib/utils";
import { TooltipProvider } from "@/components/ui/tooltip";

interface RightColumnTabsProps {
  transcript: TranscriptSegment[];
  selectedTopic: Topic | null;
  onTimestampClick: (seconds: number, endSeconds?: number, isCitation?: boolean, citationText?: string, isWithinHighlightReel?: boolean, isWithinCitationHighlight?: boolean) => void;
  currentTime?: number;
  topics?: Topic[];
  citationHighlight?: Citation | null;
  videoId: string;
  videoTitle?: string;
  videoInfo?: VideoInfo | null;
  onCitationClick: (citation: Citation) => void;
  showChatTab?: boolean;
  cachedSuggestedQuestions?: string[] | null;
  notes?: Note[];
  onSaveNote?: (payload: { text: string; source: NoteSource; sourceId?: string | null; metadata?: NoteMetadata | null }) => Promise<void>;
  onDeleteNote?: (noteId: string) => Promise<void>;
  onTakeNoteFromSelection?: (payload: SelectionActionPayload) => void;
  editingNote?: EditingNote | null;
  onSaveEditingNote?: (noteText: string) => void;
  onCancelEditing?: () => void;
  isAuthenticated?: boolean;
  onRequestSignIn?: () => void;
  youtubeId?: string;
  cachedTranslations?: Record<string, TranscriptSegment[]>;
  onTranslationUpdate?: (translations: Record<string, TranscriptSegment[]>) => void;
  bookmarkedMessageIds?: Set<string>;
}

export interface RightColumnTabsHandle {
  switchToTranscript: () => void;
  switchToChat?: () => void;
  switchToNotes: () => void;
}

export const RightColumnTabs = forwardRef<RightColumnTabsHandle, RightColumnTabsProps>(({
  transcript,
  selectedTopic,
  onTimestampClick,
  currentTime,
  topics,
  citationHighlight,
  videoId,
  videoTitle,
  videoInfo,
  onCitationClick,
  showChatTab,
  cachedSuggestedQuestions,
  notes,
  onSaveNote,
  onDeleteNote,
  onTakeNoteFromSelection,
  editingNote,
  onSaveEditingNote,
  onCancelEditing,
  isAuthenticated,
  onRequestSignIn,
  youtubeId,
  cachedTranslations,
  onTranslationUpdate,
  bookmarkedMessageIds,
}, ref) => {
  const [activeTab, setActiveTab] = useState<"transcript" | "chat" | "notes">("transcript");
  const [currentLanguage, setCurrentLanguage] = useState<string>('en');

  // Expose methods to parent to switch tabs
  useImperativeHandle(ref, () => ({
    switchToTranscript: () => {
      setActiveTab("transcript");
    },
    switchToChat: () => {
      if (showChatTab) {
        setActiveTab("chat");
      }
    },
    switchToNotes: () => {
      setActiveTab("notes");
    }
  }));

  useEffect(() => {
    // If chat tab is removed while active, switch to transcript
    if (!showChatTab && activeTab === "chat") {
      setActiveTab("transcript");
    }
  }, [showChatTab, activeTab]);

  return (
    <Card className="h-full flex flex-col overflow-hidden p-0 gap-0 border-0">
      <div className="flex items-center gap-2 p-2 rounded-t-3xl border-b">
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
        {showChatTab && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setActiveTab("chat")}
            className={cn(
              "flex-1 justify-center gap-2 rounded-2xl",
              activeTab === "chat"
                ? "bg-neutral-100 text-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-white/50"
            )}
          >
            <MessageSquare className="h-4 w-4" />
            Chat
          </Button>
        )}
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
            youtubeId={youtubeId}
            cachedTranslations={cachedTranslations}
            onTranslationUpdate={onTranslationUpdate}
            onLanguageChange={setCurrentLanguage}
          />
        </div>
        <div className={cn("absolute inset-0", (activeTab !== "chat" || !showChatTab) && "hidden")}>
          <AIChat
            transcript={transcript}
            topics={topics || []}
            videoId={videoId}
            videoTitle={videoTitle}
            videoInfo={videoInfo}
            onCitationClick={onCitationClick}
            onTimestampClick={onTimestampClick}
            cachedSuggestedQuestions={cachedSuggestedQuestions}
            onSaveNote={onSaveNote}
            onTakeNoteFromSelection={onTakeNoteFromSelection}
            currentLanguage={currentLanguage}
            translatedTranscripts={cachedTranslations}
            bookmarkedMessageIds={bookmarkedMessageIds}
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
              onDeleteNote={onDeleteNote}
              onTimestampClick={(seconds) => onTimestampClick(seconds)}
            />
          </TooltipProvider>
        </div>
      </div>
    </Card>
  );
});

RightColumnTabs.displayName = "RightColumnTabs";
