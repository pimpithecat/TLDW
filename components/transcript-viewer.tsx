"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { TranscriptSegment, Topic } from "@/lib/types";
import { getTopicHSLColor, formatDuration } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Play, Eye, EyeOff, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";

interface TranscriptViewerProps {
  transcript: TranscriptSegment[];
  selectedTopic: Topic | null;
  onTimestampClick: (seconds: number) => void;
  currentTime?: number;
  topics?: Topic[];
  citationHighlight?: { start: number; end?: number } | null;
}

export function TranscriptViewer({
  transcript,
  selectedTopic,
  onTimestampClick,
  currentTime = 0,
  topics = [],
  citationHighlight,
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

  // Scroll to citation highlight when it changes
  useEffect(() => {
    if (citationHighlight && highlightedRefs.current.length > 0) {
      const firstHighlighted = highlightedRefs.current[0];
      if (firstHighlighted && scrollViewportRef.current) {
        const viewport = scrollViewportRef.current;
        const elementTop = firstHighlighted.offsetTop;
        const viewportHeight = viewport.clientHeight;
        const scrollPosition = elementTop - viewportHeight / 3; // Position in upper third
        
        viewport.scrollTo({
          top: scrollPosition,
          behavior: 'smooth'
        });
        
        // Temporarily disable auto-scroll
        lastUserScrollTime.current = Date.now();
      }
    }
  }, [citationHighlight]);

  // Detect user scroll and temporarily disable auto-scroll with debouncing
  const handleUserScroll = useCallback(() => {
    const now = Date.now();
    // Only consider it user scroll if enough time has passed since last programmatic scroll
    if (now - lastUserScrollTime.current > 300) {
      if (autoScroll) {
        setAutoScroll(false);
        setShowScrollToCurrentButton(true);
        
        // Clear existing timeout
        if (scrollTimeoutRef.current) {
          clearTimeout(scrollTimeoutRef.current);
        }
        
        // Re-enable auto-scroll after 8 seconds of inactivity for better UX
        scrollTimeoutRef.current = setTimeout(() => {
          setAutoScroll(true);
          setShowScrollToCurrentButton(false);
        }, 8000);
      }
    }
  }, [autoScroll]);

  // Custom scroll function that only scrolls within the container
  const scrollToElement = useCallback((element: HTMLElement | null, smooth = true) => {
    if (!element || !scrollViewportRef.current) return;
    
    const viewport = scrollViewportRef.current;
    const elementRect = element.getBoundingClientRect();
    const viewportRect = viewport.getBoundingClientRect();
    
    // Calculate the element's position relative to the viewport
    const relativeTop = elementRect.top - viewportRect.top + viewport.scrollTop;
    
    // Center the element in the viewport with improved calculation
    const scrollPosition = relativeTop - (viewportRect.height / 2) + (elementRect.height / 2);
    
    // Mark this as programmatic scroll
    lastUserScrollTime.current = Date.now() + 500; // Add buffer to prevent detecting as user scroll
    
    // Use requestAnimationFrame for smoother scrolling
    requestAnimationFrame(() => {
      viewport.scrollTo({
        top: Math.max(0, scrollPosition),
        behavior: smooth ? 'smooth' : 'auto'
      });
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

  // Auto-scroll to current playing segment with improved smooth tracking
  useEffect(() => {
    if (autoScroll && currentSegmentRef.current && currentTime > 0) {
      // Check if current segment is visible
      const viewport = scrollViewportRef.current;
      if (viewport) {
        const element = currentSegmentRef.current;
        const elementRect = element.getBoundingClientRect();
        const viewportRect = viewport.getBoundingClientRect();
        
        // Improved thresholds for better centering - check if element is outside the center 40% of viewport
        const topThreshold = viewportRect.top + viewportRect.height * 0.35;
        const bottomThreshold = viewportRect.top + viewportRect.height * 0.65;
        
        // Also check if element is completely out of view
        const isOutOfView = elementRect.bottom < viewportRect.top || elementRect.top > viewportRect.bottom;
        
        if (isOutOfView || elementRect.top < topThreshold || elementRect.bottom > bottomThreshold) {
          scrollToElement(currentSegmentRef.current, true);
        }
      }
    }
  }, [currentTime, autoScroll, scrollToElement]);

  // Add scroll event listener
  useEffect(() => {
    const viewport = scrollViewportRef.current;
    if (viewport) {
      viewport.addEventListener('scroll', handleUserScroll);
      return () => {
        viewport.removeEventListener('scroll', handleUserScroll);
      };
    }
  }, [handleUserScroll]);

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

  const isCitationHighlighted = (segment: TranscriptSegment): boolean => {
    if (!citationHighlight) return false;
    const segmentEnd = segment.start + segment.duration;
    const citationEnd = citationHighlight.end || citationHighlight.start + 30; // Default 30 second range if no end
    
    // Check if segment overlaps with citation highlight range
    return (
      (segment.start >= citationHighlight.start && segment.start < citationEnd) ||
      (segmentEnd > citationHighlight.start && segmentEnd <= citationEnd) ||
      (segment.start <= citationHighlight.start && segmentEnd >= citationEnd)
    );
  };

  // Find the single best matching segment for the current time
  const getCurrentSegmentIndex = (): number => {
    if (currentTime === 0) return -1;
    
    // Find all segments that contain the current time
    const matchingIndices: number[] = [];
    transcript.forEach((segment, index) => {
      if (currentTime >= segment.start && currentTime < segment.start + segment.duration) {
        matchingIndices.push(index);
      }
    });
    
    // If no matches, return -1
    if (matchingIndices.length === 0) return -1;
    
    // If only one match, return it
    if (matchingIndices.length === 1) return matchingIndices[0];
    
    // If multiple matches, return the one whose start time is closest to current time
    return matchingIndices.reduce((closest, current) => {
      const closestDiff = Math.abs(transcript[closest].start - currentTime);
      const currentDiff = Math.abs(transcript[current].start - currentTime);
      return currentDiff < closestDiff ? current : closest;
    });
  };

  const handleSegmentClick = useCallback(
    (segment: TranscriptSegment) => {
      onTimestampClick(segment.start);
    },
    [onTimestampClick]
  );

  return (
    <TooltipProvider delayDuration={300}>
      <div className="h-full max-h-full flex flex-col rounded-lg border bg-card shadow-sm overflow-hidden">
        {/* Header */}
        <div className="p-3 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-sm">Transcript</h3>
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

      {/* Jump to current button with improved positioning */}
      {showScrollToCurrentButton && currentTime > 0 && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-10 animate-in fade-in slide-in-from-top-2 duration-300">
          <Button
            size="sm"
            onClick={jumpToCurrent}
            className="shadow-lg bg-primary/95 hover:bg-primary"
          >
            <ChevronDown className="w-4 h-4 mr-1 animate-bounce" />
            Jump to Current
          </Button>
        </div>
      )}

      {/* Transcript content */}
      <ScrollArea className="flex-1 min-h-0" ref={scrollAreaRef}>
        <div 
          className="p-4 space-y-1" 
          ref={(el) => {
            // Get the viewport element from ScrollArea - it's the data-radix-scroll-area-viewport element
            if (el) {
              const viewport = el.closest('[data-radix-scroll-area-viewport]');
              if (viewport && viewport instanceof HTMLElement) {
                scrollViewportRef.current = viewport as HTMLDivElement;
              }
            }
          }}
        >
          {transcript.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">
              No transcript available
            </div>
          ) : (
            (() => {
              // Calculate current segment index once for all segments
              const currentSegmentIndex = getCurrentSegmentIndex();
              
              return transcript.map((segment, index) => {
                const isHighlighted = isSegmentHighlighted(segment);
                const isCurrent = index === currentSegmentIndex;
                const isCitationHighlight = isCitationHighlighted(segment);
                const topicInfo = getSegmentTopic(segment);
                const isHovered = hoveredSegment === index;

            return (
              <Tooltip key={index} delayDuration={300}>
                <TooltipTrigger asChild>
                  <div
                    ref={(el) => {
                      if (isHighlighted || isCitationHighlight) {
                        const highlightIndex = highlightedRefs.current.length;
                        highlightedRefs.current[highlightIndex] = el;
                      }
                      if (isCurrent) {
                        currentSegmentRef.current = el;
                      }
                    }}
                    className={cn(
                      "group relative px-3 py-2 rounded-lg transition-all duration-200 cursor-pointer select-none",
                      "hover:bg-muted/50",
                      isHovered && "bg-muted"
                    )}
                    style={{
                      backgroundColor: isCitationHighlight
                        ? "hsl(48, 100%, 80%)" // Yellow highlight for citations
                        : isHighlighted && topicInfo
                        ? `hsl(${getTopicHSLColor(topicInfo.index)} / 0.1)`
                        : undefined,
                      borderLeft: isCitationHighlight
                        ? "4px solid hsl(48, 100%, 50%)" // Yellow border for citations
                        : isHighlighted && topicInfo
                        ? `3px solid hsl(${getTopicHSLColor(topicInfo.index)})`
                        : undefined,
                      boxShadow: isCitationHighlight
                        ? "0 0 0 1px hsl(48, 100%, 50%, 0.5), 0 2px 8px hsl(48, 100%, 50%, 0.3)" // Yellow glow for citations
                        : undefined,
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

                  </div>
                </TooltipTrigger>
                <TooltipContent side="top" className="font-mono text-xs">
                  {formatDuration(segment.start)} - {formatDuration(segment.start + segment.duration)}
                </TooltipContent>
              </Tooltip>
            );
          });
            })()
          )}
        </div>
      </ScrollArea>
    </div>
    </TooltipProvider>
  );
}