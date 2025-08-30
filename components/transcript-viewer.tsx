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

  const getHighlightedText = (segment: TranscriptSegment, segmentIndex: number): { highlightedParts: Array<{ text: string; highlighted: boolean }> } | null => {
    if (!selectedTopic) return null;
    
    // Helper function to split text into sentences
    const splitIntoSentences = (text: string): { sentence: string; startPos: number; endPos: number }[] => {
      const sentences: { sentence: string; startPos: number; endPos: number }[] = [];
      // Handle common abbreviations that shouldn't be treated as sentence ends
      const abbreviations = ['Mr', 'Mrs', 'Dr', 'Ms', 'Prof', 'Sr', 'Jr', 'Inc', 'Ltd', 'Corp', 'Co', 'vs', 'etc', 'i.e', 'e.g'];
      let processedText = text;
      
      // Temporarily replace abbreviations to avoid false sentence breaks
      abbreviations.forEach(abbr => {
        const regex = new RegExp(`\\b${abbr}\\.`, 'gi');
        processedText = processedText.replace(regex, `${abbr}<!DOT!>`);
      });
      
      // Find sentence boundaries
      const regex = /[.!?](?:\s+|$)/g;
      let lastIndex = 0;
      let match;
      
      while ((match = regex.exec(processedText)) !== null) {
        const endIndex = match.index + match[0].length;
        const sentence = text.substring(lastIndex, endIndex).trim();
        if (sentence) {
          sentences.push({
            sentence: sentence,
            startPos: lastIndex,
            endPos: endIndex
          });
        }
        lastIndex = endIndex;
      }
      
      // Add any remaining text as the last sentence
      if (lastIndex < text.length) {
        const remainingText = text.substring(lastIndex).trim();
        if (remainingText) {
          sentences.push({
            sentence: remainingText,
            startPos: lastIndex,
            endPos: text.length
          });
        }
      }
      
      return sentences;
    };
    
    // Find which topic segments this transcript segment overlaps with
    let highlightedParts: Array<{ text: string; highlighted: boolean }> = [];
    let anyHighlight = false;
    
    for (const topicSeg of selectedTopic.segments) {
      // Check if this segment should be partially or fully highlighted
      if (topicSeg.startSegmentIdx !== undefined && topicSeg.endSegmentIdx !== undefined) {
        // Case 1: This segment is fully within the topic segment range
        if (segmentIndex > topicSeg.startSegmentIdx && segmentIndex < topicSeg.endSegmentIdx) {
          // Highlight the entire segment
          return { 
            highlightedParts: [{ text: segment.text, highlighted: true }] 
          };
        }
        
        // Case 2: This is the start segment - may need partial highlighting
        if (segmentIndex === topicSeg.startSegmentIdx) {
          // Check if we need to highlight the entire segment or just part of it
          if (segmentIndex === topicSeg.endSegmentIdx) {
            // This segment is both start and end - need to find the matching portion
            // Try to match the topic segment text with the transcript segment text
            const topicText = topicSeg.text.toLowerCase().trim();
            const segmentText = segment.text.toLowerCase();
            
            // If the topic text is contained within this segment, highlight just that portion
            const index = segmentText.indexOf(topicText.substring(0, Math.min(50, topicText.length)));
            if (index !== -1) {
              // Find sentence boundaries around the match
              const sentences = splitIntoSentences(segment.text);
              const matchStart = index;
              const matchEnd = index + topicText.length;
              
              let startSentenceIdx = 0;
              let endSentenceIdx = sentences.length - 1;
              
              // Find which sentences contain the match
              for (let i = 0; i < sentences.length; i++) {
                if (sentences[i].startPos <= matchStart && sentences[i].endPos > matchStart) {
                  startSentenceIdx = i;
                }
                if (sentences[i].startPos < matchEnd && sentences[i].endPos >= matchEnd) {
                  endSentenceIdx = i;
                  break;
                }
              }
              
              // Build the highlighted parts
              let parts: Array<{ text: string; highlighted: boolean }> = [];
              let currentPos = 0;
              
              for (let i = 0; i < sentences.length; i++) {
                if (i < startSentenceIdx) {
                  // Before highlight
                  if (sentences[i].startPos > currentPos) {
                    parts.push({ text: segment.text.substring(currentPos, sentences[i].startPos), highlighted: false });
                  }
                  parts.push({ text: sentences[i].sentence, highlighted: false });
                  currentPos = sentences[i].endPos;
                } else if (i >= startSentenceIdx && i <= endSentenceIdx) {
                  // Within highlight
                  if (sentences[i].startPos > currentPos) {
                    parts.push({ text: segment.text.substring(currentPos, sentences[i].startPos), highlighted: true });
                  }
                  parts.push({ text: sentences[i].sentence, highlighted: true });
                  currentPos = sentences[i].endPos;
                  anyHighlight = true;
                } else {
                  // After highlight
                  if (sentences[i].startPos > currentPos) {
                    parts.push({ text: segment.text.substring(currentPos, sentences[i].startPos), highlighted: false });
                  }
                  parts.push({ text: sentences[i].sentence, highlighted: false });
                  currentPos = sentences[i].endPos;
                }
              }
              
              // Add any remaining text
              if (currentPos < segment.text.length) {
                parts.push({ text: segment.text.substring(currentPos), highlighted: false });
              }
              
              if (anyHighlight) {
                return { highlightedParts: parts };
              }
            }
          }
          
          // Default: highlight from the beginning of the first complete sentence
          const sentences = splitIntoSentences(segment.text);
          if (sentences.length > 0) {
            // Find where to start highlighting - look for sentence that best matches the topic text start
            const topicTextStart = topicSeg.text.substring(0, 100).toLowerCase();
            let bestMatchIdx = 0;
            let bestMatchScore = 0;
            
            for (let i = 0; i < sentences.length; i++) {
              const sentenceText = sentences[i].sentence.toLowerCase();
              // Simple matching: count common words
              const commonWords = topicTextStart.split(/\s+/).filter(word => 
                word.length > 3 && sentenceText.includes(word)
              ).length;
              if (commonWords > bestMatchScore) {
                bestMatchScore = commonWords;
                bestMatchIdx = i;
              }
            }
            
            // Highlight from the best matching sentence onwards
            let parts: Array<{ text: string; highlighted: boolean }> = [];
            for (let i = 0; i < sentences.length; i++) {
              if (i < bestMatchIdx) {
                parts.push({ text: sentences[i].sentence + ' ', highlighted: false });
              } else {
                parts.push({ text: sentences[i].sentence + ' ', highlighted: true });
                anyHighlight = true;
              }
            }
            
            if (anyHighlight) {
              return { highlightedParts: parts };
            }
          }
        }
        
        // Case 3: This is the end segment - may need partial highlighting
        if (segmentIndex === topicSeg.endSegmentIdx) {
          const sentences = splitIntoSentences(segment.text);
          if (sentences.length > 0) {
            // Find where to end highlighting - look for sentence that best matches the topic text end
            const topicTextEnd = topicSeg.text.substring(Math.max(0, topicSeg.text.length - 100)).toLowerCase();
            let bestMatchIdx = sentences.length - 1;
            let bestMatchScore = 0;
            
            for (let i = sentences.length - 1; i >= 0; i--) {
              const sentenceText = sentences[i].sentence.toLowerCase();
              // Simple matching: count common words
              const commonWords = topicTextEnd.split(/\s+/).filter(word => 
                word.length > 3 && sentenceText.includes(word)
              ).length;
              if (commonWords > bestMatchScore) {
                bestMatchScore = commonWords;
                bestMatchIdx = i;
              }
            }
            
            // Highlight up to and including the best matching sentence
            let parts: Array<{ text: string; highlighted: boolean }> = [];
            for (let i = 0; i < sentences.length; i++) {
              if (i <= bestMatchIdx) {
                parts.push({ text: sentences[i].sentence + ' ', highlighted: true });
                anyHighlight = true;
              } else {
                parts.push({ text: sentences[i].sentence + ' ', highlighted: false });
              }
            }
            
            if (anyHighlight) {
              return { highlightedParts: parts };
            }
          }
        }
      }
    }
    
    // Fallback to time-based highlighting if segment indices aren't available
    if (!anyHighlight) {
      const segmentEnd = segment.start + segment.duration;
      const shouldHighlight = selectedTopic.segments.some(topicSeg => {
        const overlapStart = Math.max(segment.start, topicSeg.start);
        const overlapEnd = Math.min(segmentEnd, topicSeg.end);
        const overlapDuration = Math.max(0, overlapEnd - overlapStart);
        const overlapRatio = overlapDuration / segment.duration;
        return overlapRatio > 0.9;
      });
      
      if (shouldHighlight) {
        return { 
          highlightedParts: [{ text: segment.text, highlighted: true }] 
        };
      }
    }
    
    return null;
  };
  
  

  const getCitationHighlightedText = (segment: TranscriptSegment): { highlightedParts: Array<{ text: string; highlighted: boolean; isCitation: boolean }> } | null => {
    if (!citationHighlight) return null;
    
    const segmentEnd = segment.start + segment.duration;
    const citationEnd = citationHighlight.end || citationHighlight.start + 30;
    
    // Check if segment overlaps significantly with citation time range
    const overlapStart = Math.max(segment.start, citationHighlight.start);
    const overlapEnd = Math.min(segmentEnd, citationEnd);
    const overlapDuration = Math.max(0, overlapEnd - overlapStart);
    const overlapRatio = overlapDuration / segment.duration;
    
    // Only highlight if there's significant overlap
    if (overlapRatio > 0.8) {
      return { 
        highlightedParts: [{ text: segment.text, highlighted: true, isCitation: true }] 
      };
    }
    
    return null;
  };
  
  const isCitationHighlighted = (segment: TranscriptSegment): boolean => {
    return getCitationHighlightedText(segment) !== null;
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
                const citationHighlightedText = getCitationHighlightedText(segment);
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
                      if (hasHighlight) {
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
                      borderLeft: hasHighlight && topicInfo && !citationHighlightedText
                        ? `3px solid hsl(${getTopicHSLColor(topicInfo.index)})`
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
                                    : topicInfo
                                    ? {
                                        backgroundColor: `hsl(${getTopicHSLColor(topicInfo.index)} / 0.2)`,
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