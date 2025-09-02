"use client";

import { useState, useEffect, useImperativeHandle, forwardRef } from "react";
import { TranscriptViewer } from "@/components/transcript-viewer";
import { AIChat } from "@/components/ai-chat";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FileText, MessageSquare } from "lucide-react";
import { TranscriptSegment, Topic, Citation } from "@/lib/types";
import { cn } from "@/lib/utils";

interface RightColumnTabsProps {
  transcript: TranscriptSegment[];
  selectedTopic: Topic | null;
  onTimestampClick: (seconds: number, endSeconds?: number, isCitation?: boolean, citationText?: string, isWithinHighlightReel?: boolean, isWithinCitationHighlight?: boolean) => void;
  currentTime?: number;
  topics?: Topic[];
  citationHighlight?: Citation | null;
  videoId: string;
  videoTitle?: string;
  onCitationClick: (citation: Citation) => void;
  onPlayAllCitations?: (citations: Citation[]) => void;
  switchToTranscriptTab?: boolean;
  onTabSwitch?: () => void;
}

export interface RightColumnTabsHandle {
  switchToTranscript: () => void;
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
  onCitationClick,
  onPlayAllCitations,
  switchToTranscriptTab,
  onTabSwitch,
}, ref) => {
  const [activeTab, setActiveTab] = useState<"transcript" | "chat">("transcript");

  // Expose method to parent to switch to transcript tab
  useImperativeHandle(ref, () => ({
    switchToTranscript: () => {
      setActiveTab("transcript");
    }
  }));

  // Switch to transcript tab when requested
  useEffect(() => {
    if (switchToTranscriptTab) {
      setActiveTab("transcript");
      onTabSwitch?.();
    }
  }, [switchToTranscriptTab, onTabSwitch]);

  return (
    <Card className="h-full flex flex-col overflow-hidden p-0 gap-0">
      <div className="flex items-center gap-1 p-1.5 border-b">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setActiveTab("transcript")}
          className={cn(
            "flex-1 justify-center gap-2",
            activeTab === "transcript" 
              ? "bg-accent text-accent-foreground" 
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          <FileText className="h-4 w-4" />
          Transcript
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setActiveTab("chat")}
          className={cn(
            "flex-1 justify-center gap-2",
            activeTab === "chat" 
              ? "bg-accent text-accent-foreground" 
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          <MessageSquare className="h-4 w-4" />
          AI Chat
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
          />
        </div>
        <div className={cn("absolute inset-0", activeTab !== "chat" && "hidden")}>
          <AIChat
            transcript={transcript}
            topics={topics || []}
            videoId={videoId}
            videoTitle={videoTitle}
            onCitationClick={onCitationClick}
            onTimestampClick={onTimestampClick}
            onPlayAllCitations={onPlayAllCitations}
          />
        </div>
      </div>
    </Card>
  );
});

RightColumnTabs.displayName = "RightColumnTabs";