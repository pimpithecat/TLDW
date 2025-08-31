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
  onTimestampClick: (seconds: number, endSeconds?: number, isCitation?: boolean, citationText?: string) => void;
  currentTime?: number;
  topics?: Topic[];
  citationHighlight?: { start: number; end?: number; text?: string } | null;
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
    
    // Debug: Verify segment indices match content
    if (selectedTopic && selectedTopic.segments.length > 0 && transcript.length > 0) {
      console.log(`🎯 [Topic Selected] "${selectedTopic.title}"`);
      
      const firstSeg = selectedTopic.segments[0];
      if (firstSeg.startSegmentIdx !== undefined && firstSeg.endSegmentIdx !== undefined) {
        console.log(`🔍 Verifying segment index alignment:`);
        console.log(`  Topic expects indices: ${firstSeg.startSegmentIdx}-${firstSeg.endSegmentIdx}`);
        console.log(`  Quote text starts with: "${firstSeg.text.substring(0, 60)}..."`);        
        
        // Check what's actually at those indices
        if (transcript[firstSeg.startSegmentIdx]) {
          console.log(`  Segment at index ${firstSeg.startSegmentIdx}: "${transcript[firstSeg.startSegmentIdx].text.substring(0, 60)}..."`);
          
          // Try to find where the quote actually is
          const quoteStart = firstSeg.text.substring(0, 30).toLowerCase().replace(/[^a-z0-9 ]/g, '');
          let foundAt = -1;
          
          for (let i = Math.max(0, firstSeg.startSegmentIdx - 5); i <= Math.min(firstSeg.startSegmentIdx + 5, transcript.length - 1); i++) {
            const segText = transcript[i]?.text || '';
            const segTextNorm = segText.toLowerCase().replace(/[^a-z0-9 ]/g, '');
            if (segTextNorm.includes(quoteStart)) {
              foundAt = i;
              console.log(`  ✅ Found quote at index ${i}: "${segText.substring(0, 50)}..."`);
              break;
            }
          }
          
          if (foundAt !== -1 && foundAt !== firstSeg.startSegmentIdx) {
            console.log(`  ⚠️ INDEX MISMATCH: Quote is at index ${foundAt} but expected at ${firstSeg.startSegmentIdx} (off by ${foundAt - firstSeg.startSegmentIdx})`);
          }
        }
      }
    }
  }, [selectedTopic, transcript]);

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

  const getHighlightedText = (segment: TranscriptSegment, segmentIndex: number): { highlightedParts: Array<{ text: string; highlighted: boolean }> } | null => {
    if (!selectedTopic) return null;
    
    // Check each topic segment to see if this transcript segment should be highlighted
    for (const topicSeg of selectedTopic.segments) {
      // Use segment indices with character offsets for precise matching
      if (topicSeg.startSegmentIdx !== undefined && topicSeg.endSegmentIdx !== undefined) {
        
        // Skip this debug logging - removed for cleaner output
        
        // Skip segments that are before the start or after the end
        if (segmentIndex < topicSeg.startSegmentIdx || segmentIndex > topicSeg.endSegmentIdx) {
          continue;
        }
        
        // Case 1: This segment is between start and end (not at boundaries)
        if (segmentIndex > topicSeg.startSegmentIdx && segmentIndex < topicSeg.endSegmentIdx) {
          return { 
            highlightedParts: [{ text: segment.text, highlighted: true }] 
          };
        }
        
        // Case 2: This is the start segment - may need partial highlighting
        if (segmentIndex === topicSeg.startSegmentIdx) {
          if (topicSeg.startCharOffset !== undefined && topicSeg.startCharOffset > 0) {
            // Partial highlight from character offset to end
            const beforeHighlight = segment.text.substring(0, topicSeg.startCharOffset);
            const highlighted = segment.text.substring(topicSeg.startCharOffset);
            
            // If this is also the end segment, apply end offset
            if (segmentIndex === topicSeg.endSegmentIdx && topicSeg.endCharOffset !== undefined) {
              const actualHighlighted = segment.text.substring(
                topicSeg.startCharOffset, 
                Math.min(topicSeg.endCharOffset, segment.text.length)
              );
              const afterHighlight = segment.text.substring(Math.min(topicSeg.endCharOffset, segment.text.length));
              
              const parts: Array<{ text: string; highlighted: boolean }> = [];
              if (beforeHighlight) parts.push({ text: beforeHighlight, highlighted: false });
              if (actualHighlighted) parts.push({ text: actualHighlighted, highlighted: true });
              if (afterHighlight) parts.push({ text: afterHighlight, highlighted: false });
              return { highlightedParts: parts };
            }
            
            const parts: Array<{ text: string; highlighted: boolean }> = [];
            if (beforeHighlight) parts.push({ text: beforeHighlight, highlighted: false });
            if (highlighted) parts.push({ text: highlighted, highlighted: true });
            return { highlightedParts: parts };
          } else {
            // No offset or offset is 0, highlight from beginning
            if (segmentIndex === topicSeg.endSegmentIdx && topicSeg.endCharOffset !== undefined) {
              // This is both start and end segment
              const highlighted = segment.text.substring(0, topicSeg.endCharOffset);
              const afterHighlight = segment.text.substring(topicSeg.endCharOffset);
              
              const parts: Array<{ text: string; highlighted: boolean }> = [];
              if (highlighted) parts.push({ text: highlighted, highlighted: true });
              if (afterHighlight) parts.push({ text: afterHighlight, highlighted: false });
              return { highlightedParts: parts };
            }
            // Highlight entire segment
            return { 
              highlightedParts: [{ text: segment.text, highlighted: true }] 
            };
          }
        }
        
        // Case 3: This is the end segment (only if different from start) - may need partial highlighting
        if (segmentIndex === topicSeg.endSegmentIdx && segmentIndex !== topicSeg.startSegmentIdx) {
          if (topicSeg.endCharOffset !== undefined && topicSeg.endCharOffset < segment.text.length) {
            // Partial highlight from beginning to character offset
            const highlighted = segment.text.substring(0, topicSeg.endCharOffset);
            const afterHighlight = segment.text.substring(topicSeg.endCharOffset);
            
            const parts: Array<{ text: string; highlighted: boolean }> = [];
            if (highlighted) parts.push({ text: highlighted, highlighted: true });
            if (afterHighlight) parts.push({ text: afterHighlight, highlighted: false });
            return { highlightedParts: parts };
          } else {
            // No offset or offset covers entire segment
            return { 
              highlightedParts: [{ text: segment.text, highlighted: true }] 
            };
          }
        }
      }
    }
    
    // Only use time-based highlighting if NO segments have index information
    const hasAnySegmentIndices = selectedTopic.segments.some(seg => 
      seg.startSegmentIdx !== undefined && seg.endSegmentIdx !== undefined
    );
    
    if (!hasAnySegmentIndices) {
      // Fallback to time-based highlighting only if segment indices aren't available at all
      const segmentEnd = segment.start + segment.duration;
      const shouldHighlight = selectedTopic.segments.some(topicSeg => {
        const overlapStart = Math.max(segment.start, topicSeg.start);
        const overlapEnd = Math.min(segmentEnd, topicSeg.end);
        const overlapDuration = Math.max(0, overlapEnd - overlapStart);
        const overlapRatio = overlapDuration / segment.duration;
        // Highlight if there's significant overlap (more than 50% of the segment)
        return overlapRatio > 0.5;
      });
      
      if (shouldHighlight) {
        return { 
          highlightedParts: [{ text: segment.text, highlighted: true }] 
        };
      }
    }
    
    return null;
  };
  
  

  const getCitationHighlightedText = (segment: TranscriptSegment, segmentIndex: number): { highlightedParts: Array<{ text: string; highlighted: boolean; isCitation: boolean }> } | null => {
    if (!citationHighlight) return null;
    
    const segmentEnd = segment.start + segment.duration;
    const citationEnd = citationHighlight.end || citationHighlight.start + 30;
    
    // Check if segment overlaps with citation time range
    const overlapStart = Math.max(segment.start, citationHighlight.start);
    const overlapEnd = Math.min(segmentEnd, citationEnd);
    const overlapDuration = Math.max(0, overlapEnd - overlapStart);
    const overlapRatio = overlapDuration / segment.duration;
    
    // For citations, we can be more lenient with partial overlaps
    // since we don't have character-level offsets for citations yet
    if (overlapRatio > 0.5) {
      // Try to find sentence boundaries within the segment
      // This is a simplified approach for citations
      const sentences = segment.text.split(/(?<=[.!?])\s+/);
      if (sentences.length > 1 && overlapRatio < 0.9) {
        // Partial segment - try to highlight only relevant sentences
        const parts: Array<{ text: string; highlighted: boolean; isCitation: boolean }> = [];
        let currentPos = 0;
        
        for (const sentence of sentences) {
          const sentenceStart = segment.text.indexOf(sentence, currentPos);
          if (sentenceStart === -1) continue;
          
          // Estimate time position of this sentence within the segment
          const sentenceTimeRatio = sentenceStart / segment.text.length;
          const sentenceTime = segment.start + (segment.duration * sentenceTimeRatio);
          
          // Check if this sentence falls within citation range
          const shouldHighlight = sentenceTime >= citationHighlight.start && sentenceTime <= citationEnd;
          
          if (shouldHighlight) {
            // Add any text before this sentence as non-highlighted
            if (sentenceStart > currentPos) {
              parts.push({ 
                text: segment.text.substring(currentPos, sentenceStart), 
                highlighted: false, 
                isCitation: false 
              });
            }
            parts.push({ text: sentence, highlighted: true, isCitation: true });
          } else if (parts.length === 0) {
            // Haven't started highlighting yet
            parts.push({ text: sentence, highlighted: false, isCitation: false });
          }
          
          currentPos = sentenceStart + sentence.length;
        }
        
        // Add any remaining text
        if (currentPos < segment.text.length && parts.length > 0) {
          parts.push({ 
            text: segment.text.substring(currentPos), 
            highlighted: false, 
            isCitation: false 
          });
        }
        
        if (parts.some(p => p.highlighted)) {
          return { highlightedParts: parts };
        }
      } else {
        // Highlight entire segment
        return { 
          highlightedParts: [{ text: segment.text, highlighted: true, isCitation: true }] 
        };
      }
    }
    
    return null;
  };
  
  const isCitationHighlighted = (segment: TranscriptSegment, segmentIndex: number): boolean => {
    return getCitationHighlightedText(segment, segmentIndex) !== null;
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
      onTimestampClick(segment.start, undefined, false);
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
                const topicHighlightedText = getHighlightedText(segment, index);
                const citationHighlightedText = getCitationHighlightedText(segment, index);
                const isCurrent = index === currentSegmentIndex;
                const topicInfo = getSegmentTopic(segment);
                const isHovered = hoveredSegment === index;
                
                // Merge highlights if both exist
                let finalHighlightedParts: Array<{ text: string; highlighted: boolean; isCitation?: boolean }> | null = null;
                
                if (citationHighlightedText) {
                  // Citation takes priority
                  finalHighlightedParts = citationHighlightedText.highlightedParts;
                } else if (topicHighlightedText) {
                  // Use topic highlights
                  finalHighlightedParts = topicHighlightedText.highlightedParts.map(part => ({
                    ...part,
                    isCitation: false
                  }));
                }
                
                const hasHighlight = finalHighlightedParts !== null;

            return (
              <Tooltip key={index} delayDuration={300}>
                <TooltipTrigger asChild>
                  <div
                    ref={(el) => {
                      // Store refs properly
                      if (el) {
                        if (hasHighlight && !highlightedRefs.current.includes(el)) {
                          highlightedRefs.current.push(el);
                        }
                        if (isCurrent) {
                          currentSegmentRef.current = el;
                        }
                      }
                    }}
                    className={cn(
                      "group relative px-3 py-2 rounded-lg transition-all duration-200 cursor-pointer select-none",
                      "hover:bg-muted/50",
                      isHovered && "bg-muted"
                    )}
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


                    {/* Transcript text with partial highlighting */}
                    <p 
                      className={cn(
                        "text-sm leading-relaxed",
                        isCurrent ? "text-foreground font-medium" : "text-muted-foreground"
                      )}
                    >
                      {finalHighlightedParts ? (
                        finalHighlightedParts.map((part, partIndex) => {
                          const isCitation = 'isCitation' in part && part.isCitation;
                          
                          return (
                            <span
                              key={partIndex}
                              className={part.highlighted ? "text-foreground" : ""}
                              style={
                                part.highlighted
                                  ? isCitation
                                    ? {
                                        backgroundColor: 'hsl(48, 100%, 85%)',
                                        padding: '1px 3px',
                                        borderRadius: '3px',
                                        boxShadow: '0 0 0 1px hsl(48, 100%, 50%, 0.3)',
                                      }
                                    : selectedTopic
                                    ? {
                                        backgroundColor: `hsl(${getTopicHSLColor(topics.indexOf(selectedTopic))} / 0.2)`,
                                        padding: '0 2px',
                                        borderRadius: '2px',
                                      }
                                    : undefined
                                  : undefined
                              }
                            >
                              {part.text}
                            </span>
                          );
                        })
                      ) : (
                        segment.text
                      )}
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