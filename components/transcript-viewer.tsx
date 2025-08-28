"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { TranscriptSegment, Topic } from "@/lib/types";
import { getTopicHSLColor } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Play, Eye, EyeOff, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";

interface TranscriptViewerProps {
  transcript: TranscriptSegment[];
  selectedTopic: Topic | null;
  onTimestampClick: (seconds: number) => void;
  currentTime?: number;
  topics?: Topic[];
}

export function TranscriptViewer({
  transcript,
  selectedTopic,
  onTimestampClick,
  currentTime = 0,
  topics = [],
}: TranscriptViewerProps) {
  const highlightedRefs = useRef<(HTMLDivElement | null)[]>([]);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const scrollViewportRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [hoveredSegment, setHoveredSegment] = useState<number | null>(null);
  const currentSegmentRef = useRef<HTMLDivElement | null>(null);
  const [showAll, setShowAll] = useState(false);
  
  // Time window for filtering segments (seconds before and after current time)
  const TIME_WINDOW_BEFORE = 30;
  const TIME_WINDOW_AFTER = 60;
  const INITIAL_SEGMENTS = 15;

  // Clear refs when topic changes
  useEffect(() => {
    highlightedRefs.current = [];
  }, [selectedTopic]);

  // Custom scroll function that only scrolls within the container
  const scrollToElement = (element: HTMLElement | null) => {
    if (!element || !scrollViewportRef.current) return;
    
    const viewport = scrollViewportRef.current;
    const elementRect = element.getBoundingClientRect();
    const viewportRect = viewport.getBoundingClientRect();
    
    // Calculate the element's position relative to the viewport
    const relativeTop = elementRect.top - viewportRect.top + viewport.scrollTop;
    
    // Center the element in the viewport
    const scrollPosition = relativeTop - (viewportRect.height / 2) + (elementRect.height / 2);
    
    // Smooth scroll to the calculated position
    viewport.scrollTo({
      top: Math.max(0, scrollPosition),
      behavior: 'smooth'
    });
  };

  // Scroll to first highlighted segment
  useEffect(() => {
    if (selectedTopic && highlightedRefs.current[0] && autoScroll) {
      setTimeout(() => {
        scrollToElement(highlightedRefs.current[0]);
      }, 100);
    }
  }, [selectedTopic, autoScroll]);

  // Auto-scroll to current playing segment
  useEffect(() => {
    if (autoScroll && currentTime && currentSegmentRef.current) {
      const scrollTimeout = setTimeout(() => {
        scrollToElement(currentSegmentRef.current);
      }, 100);
      return () => clearTimeout(scrollTimeout);
    }
  }, [currentTime, autoScroll]);

  const getSegmentTopic = (segment: TranscriptSegment): { topic: Topic; index: number } | null => {
    for (let i = 0; i < topics.length; i++) {
      const topic = topics[i];
      const hasSegment = topic.segments.some(
        (topicSeg) => segment.start >= topicSeg.start && segment.start < topicSeg.end
      );
      if (hasSegment) {
        return { topic, index: i };
      }
    }
    return null;
  };

  const isSegmentHighlighted = (segment: TranscriptSegment): boolean => {
    if (!selectedTopic) return false;
    return selectedTopic.segments.some(
      (topicSeg) => segment.start >= topicSeg.start && segment.start < topicSeg.end
    );
  };

  const isCurrentSegment = (segment: TranscriptSegment): boolean => {
    if (!currentTime) return false;
    return currentTime >= segment.start && currentTime < segment.start + segment.duration;
  };

  const handleSegmentClick = useCallback(
    (segment: TranscriptSegment) => {
      onTimestampClick(segment.start);
    },
    [onTimestampClick]
  );
  
  // Filter segments to show only relevant ones
  const getVisibleSegments = useCallback(() => {
    if (showAll) return transcript;
    
    return transcript.filter((segment, index) => {
      // Always show segments that are part of the selected topic
      if (selectedTopic && isSegmentHighlighted(segment)) {
        return true;
      }
      
      // If video is playing, show segments around current time
      if (currentTime > 0) {
        const segmentEnd = segment.start + segment.duration;
        return segment.start >= (currentTime - TIME_WINDOW_BEFORE) && 
               segment.start <= (currentTime + TIME_WINDOW_AFTER);
      }
      
      // Show initial segments when no playback has started
      return index < INITIAL_SEGMENTS;
    });
  }, [transcript, selectedTopic, currentTime, showAll]);
  
  const visibleSegments = getVisibleSegments();

  return (
    <div className="h-full flex flex-col rounded-lg border bg-card shadow-sm">
      {/* Header */}
      <div className="p-3 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-sm">Transcript</h3>
            <Badge variant="outline" className="text-xs">
              {visibleSegments.length === transcript.length 
                ? `${transcript.length} segments`
                : `${visibleSegments.length} of ${transcript.length}`}
            </Badge>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant={showAll ? "default" : "outline"}
              size="sm"
              onClick={() => setShowAll(!showAll)}
              className="text-xs h-7"
            >
              {showAll ? "Show Context" : "Show All"}
            </Button>
            <Button
              variant={autoScroll ? "default" : "outline"}
              size="sm"
              onClick={() => setAutoScroll(!autoScroll)}
              className="text-xs h-7"
            >
              {autoScroll ? (
                <>
                  <Eye className="w-3 h-3 mr-1" />
                  Auto
                </>
              ) : (
                <>
                  <EyeOff className="w-3 h-3 mr-1" />
                  Manual
                </>
              )}
            </Button>
          </div>
        </div>
        {selectedTopic && (
          <div className="flex items-center gap-2">
            <div
              className="h-2 w-2 rounded-full"
              style={{
                backgroundColor: `hsl(${getTopicHSLColor(topics.indexOf(selectedTopic))})`,
              }}
            />
            <span className="text-xs text-muted-foreground truncate">
              Highlighting: {selectedTopic.title}
            </span>
          </div>
        )}
      </div>

      {/* Transcript content */}
      <ScrollArea className="flex-1" ref={scrollAreaRef}>
        <div className="p-4 space-y-1" ref={(el) => {
          // Get the viewport element from ScrollArea
          if (el?.parentElement) {
            scrollViewportRef.current = el.parentElement;
          }
        }}>
          {/* Show indicator when content is filtered */}
          {!showAll && visibleSegments.length < transcript.length && visibleSegments.length > 0 && (
            <div className="text-center py-2 mb-3">
              <Badge variant="secondary" className="text-xs">
                <FileText className="w-3 h-3 mr-1" />
                Showing context around {currentTime > 0 ? 'current playback' : 'beginning'}
              </Badge>
            </div>
          )}
          
          {visibleSegments.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">
              No segments to display in current time range
            </div>
          ) : (
            visibleSegments.map((segment, index) => {
              const originalIndex = transcript.indexOf(segment);
              const isHighlighted = isSegmentHighlighted(segment);
              const isCurrent = isCurrentSegment(segment);
              const topicInfo = getSegmentTopic(segment);
              const isHovered = hoveredSegment === originalIndex;

            return (
              <div
                key={originalIndex}
                ref={(el) => {
                  if (isHighlighted) {
                    const highlightIndex = highlightedRefs.current.length;
                    highlightedRefs.current[highlightIndex] = el;
                  }
                  if (isCurrent) {
                    currentSegmentRef.current = el;
                  }
                }}
                className={cn(
                  "group relative px-3 py-2 rounded-lg transition-all duration-200 cursor-pointer",
                  "hover:bg-muted/50",
                  isCurrent && "bg-primary/10 ring-2 ring-primary/20",
                  isHovered && "bg-muted"
                )}
                style={{
                  backgroundColor: isHighlighted && topicInfo
                    ? `hsl(${getTopicHSLColor(topicInfo.index)} / 0.1)`
                    : undefined,
                  borderLeft: isHighlighted && topicInfo
                    ? `3px solid hsl(${getTopicHSLColor(topicInfo.index)})`
                    : undefined,
                }}
                onClick={() => handleSegmentClick(segment)}
                onMouseEnter={() => setHoveredSegment(originalIndex)}
                onMouseLeave={() => setHoveredSegment(null)}
              >
                {/* Play indicator on hover */}
                {isHovered && (
                  <div className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-full pr-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Play className="w-4 h-4 text-primary" />
                  </div>
                )}


                {/* Transcript text */}
                <p 
                  className={cn(
                    "text-sm leading-relaxed",
                    isCurrent ? "text-foreground font-medium" : "text-muted-foreground",
                    isHighlighted && "text-foreground"
                  )}
                >
                  {segment.text}
                </p>

                {/* Current playback indicator */}
                {isCurrent && (
                  <div className="absolute left-0 top-0 bottom-0 w-1 bg-primary rounded-l-lg animate-pulse" />
                )}
              </div>
            );
          })
          )}
        </div>
      </ScrollArea>
    </div>
  );
}