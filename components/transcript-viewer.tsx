"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { TranscriptSegment, Topic } from "@/lib/types";
import { getTopicHSLColor } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Play, Eye, EyeOff, ChevronDown } from "lucide-react";
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
  const [showScrollToCurrentButton, setShowScrollToCurrentButton] = useState(false);
  const lastUserScrollTime = useRef<number>(0);
  const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Clear refs when topic changes
  useEffect(() => {
    highlightedRefs.current = [];
  }, [selectedTopic]);

  // Detect user scroll and temporarily disable auto-scroll
  const handleUserScroll = useCallback(() => {
    const now = Date.now();
    // Only consider it user scroll if enough time has passed since last programmatic scroll
    if (now - lastUserScrollTime.current > 200) {
      if (autoScroll) {
        setAutoScroll(false);
        setShowScrollToCurrentButton(true);
        
        // Clear existing timeout
        if (scrollTimeoutRef.current) {
          clearTimeout(scrollTimeoutRef.current);
        }
        
        // Re-enable auto-scroll after 5 seconds of inactivity
        scrollTimeoutRef.current = setTimeout(() => {
          setAutoScroll(true);
          setShowScrollToCurrentButton(false);
        }, 5000);
      }
    }
  }, [autoScroll]);

  // Custom scroll function that only scrolls within the container
  const scrollToElement = useCallback((element: HTMLElement | null, smooth = true) => {
    if (!element || !scrollViewportRef.current) return;
    
    lastUserScrollTime.current = Date.now();
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
      behavior: smooth ? 'smooth' : 'auto'
    });
  }, []);

  const jumpToCurrent = useCallback(() => {
    if (currentSegmentRef.current) {
      setAutoScroll(true);
      setShowScrollToCurrentButton(false);
      scrollToElement(currentSegmentRef.current);
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
    }
  }, [scrollToElement]);

  // Scroll to first highlighted segment
  useEffect(() => {
    if (selectedTopic && highlightedRefs.current[0] && autoScroll) {
      setTimeout(() => {
        scrollToElement(highlightedRefs.current[0]);
      }, 100);
    }
  }, [selectedTopic, autoScroll, scrollToElement]);

  // Auto-scroll to current playing segment with smooth tracking
  useEffect(() => {
    if (autoScroll && currentSegmentRef.current && currentTime > 0) {
      // Check if current segment is visible
      const viewport = scrollViewportRef.current;
      if (viewport) {
        const element = currentSegmentRef.current;
        const elementRect = element.getBoundingClientRect();
        const viewportRect = viewport.getBoundingClientRect();
        
        // Check if element is outside the center third of viewport
        const topThreshold = viewportRect.top + viewportRect.height * 0.3;
        const bottomThreshold = viewportRect.top + viewportRect.height * 0.7;
        
        if (elementRect.top < topThreshold || elementRect.bottom > bottomThreshold) {
          scrollToElement(currentSegmentRef.current, true);
        }
      }
    }
  }, [currentTime, autoScroll, scrollToElement]);

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
    return currentTime >= segment.start && currentTime < segment.start + segment.duration;
  };

  const handleSegmentClick = useCallback(
    (segment: TranscriptSegment) => {
      onTimestampClick(segment.start);
    },
    [onTimestampClick]
  );

  return (
    <div className="h-full flex flex-col rounded-lg border bg-card shadow-sm">
      {/* Header */}
      <div className="p-3 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-sm">Transcript</h3>
            <Badge variant="outline" className="text-xs">
              {transcript.length} segments
            </Badge>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant={autoScroll ? "default" : "outline"}
              size="sm"
              onClick={() => {
                setAutoScroll(!autoScroll);
                if (!autoScroll) {
                  setShowScrollToCurrentButton(false);
                  jumpToCurrent();
                }
              }}
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

      {/* Jump to current button */}
      {showScrollToCurrentButton && currentTime > 0 && (
        <div className="absolute top-20 left-1/2 -translate-x-1/2 z-10">
          <Button
            size="sm"
            onClick={jumpToCurrent}
            className="shadow-lg"
          >
            <ChevronDown className="w-4 h-4 mr-1" />
            Jump to Current
          </Button>
        </div>
      )}

      {/* Transcript content */}
      <ScrollArea className="flex-1" ref={scrollAreaRef}>
        <div 
          className="p-4 space-y-1" 
          ref={(el) => {
            // Get the viewport element from ScrollArea
            if (el?.parentElement) {
              scrollViewportRef.current = el.parentElement;
              // Add scroll listener
              el.parentElement.addEventListener('scroll', handleUserScroll);
              return () => {
                el.parentElement?.removeEventListener('scroll', handleUserScroll);
              };
            }
          }}
        >
          {transcript.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">
              No transcript available
            </div>
          ) : (
            transcript.map((segment, index) => {
              const isHighlighted = isSegmentHighlighted(segment);
              const isCurrent = isCurrentSegment(segment);
              const topicInfo = getSegmentTopic(segment);
              const isHovered = hoveredSegment === index;

            return (
              <div
                key={index}
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
                  isHovered && "bg-muted"
                )}
                style={{
                  backgroundColor: isCurrent 
                    ? "hsl(var(--primary) / 0.15)"
                    : isHighlighted && topicInfo
                    ? `hsl(${getTopicHSLColor(topicInfo.index)} / 0.1)`
                    : undefined,
                  borderLeft: isCurrent
                    ? "4px solid hsl(var(--primary))"
                    : isHighlighted && topicInfo
                    ? `3px solid hsl(${getTopicHSLColor(topicInfo.index)})`
                    : undefined,
                  boxShadow: isCurrent ? "0 0 0 1px hsl(var(--primary) / 0.2)" : undefined,
                }}
                onClick={() => handleSegmentClick(segment)}
                onMouseEnter={() => setHoveredSegment(index)}
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

                {/* Current playback indicator with pulse animation */}
                {isCurrent && (
                  <>
                    <div className="absolute left-0 top-0 bottom-0 w-1 bg-primary rounded-l-lg" />
                    <div className="absolute left-0 top-0 bottom-0 w-1 bg-primary rounded-l-lg animate-pulse opacity-50" />
                  </>
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