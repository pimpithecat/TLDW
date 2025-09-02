"use client";

import { useState, useEffect, useImperativeHandle, forwardRef } from "react";
import { TranscriptViewer } from "@/components/transcript-viewer";
import { AIChat } from "@/components/ai-chat";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FileText, MessageSquare, FileEdit } from "lucide-react";
import { TranscriptSegment, Topic, Citation } from "@/lib/types";
import { cn } from "@/lib/utils";
import { BlogPostViewer } from "@/components/blog-post-viewer";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";

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
  onGenerateBlog?: () => void;
  blogContent?: string | null;
  isGeneratingBlog?: boolean;
  blogError?: string;
  showBlogTab?: boolean;
}

export interface RightColumnTabsHandle {
  switchToTranscript: () => void;
  switchToBlog?: () => void;
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
  onGenerateBlog,
  blogContent,
  isGeneratingBlog,
  blogError,
  showBlogTab,
}, ref) => {
  const [activeTab, setActiveTab] = useState<"transcript" | "chat" | "blog">("transcript");

  // Expose methods to parent to switch tabs
  useImperativeHandle(ref, () => ({
    switchToTranscript: () => {
      setActiveTab("transcript");
    },
    switchToBlog: () => {
      if (showBlogTab) {
        setActiveTab("blog");
      }
    }
  }));

  return (
    <TooltipProvider delayDuration={0}>
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
        {showBlogTab && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setActiveTab("blog")}
            className={cn(
              "flex-1 justify-center gap-2",
              activeTab === "blog" 
                ? "bg-accent text-accent-foreground" 
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <FileEdit className="h-4 w-4" />
            Blog Post
          </Button>
        )}
        {transcript.length > 0 && !showBlogTab && onGenerateBlog && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                onClick={onGenerateBlog}
                className="ml-auto px-2"
                disabled={isGeneratingBlog}
              >
                <FileEdit className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <p>Generate Blog Post</p>
            </TooltipContent>
          </Tooltip>
        )}
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
        <div className={cn("absolute inset-0", activeTab !== "blog" && "hidden")}>
          {isGeneratingBlog ? (
            <div className="p-6 space-y-4">
              <Skeleton className="h-8 w-3/4" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
              <Skeleton className="h-6 w-2/3 mt-4" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-4/5" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-6 w-1/2 mt-4" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
            </div>
          ) : blogError ? (
            <div className="p-6">
              <p className="text-destructive">{blogError}</p>
            </div>
          ) : blogContent ? (
            <BlogPostViewer content={blogContent} />
          ) : null}
        </div>
      </div>
    </Card>
    </TooltipProvider>
  );
});

RightColumnTabs.displayName = "RightColumnTabs";