"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { TranscriptSegment, Topic, Citation, TranscriptLanguage, TranslationCache } from "@/lib/types";
import { getTopicHSLColor, formatDuration } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Eye, EyeOff, ChevronDown, Languages, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import { SelectionActions, triggerExplainSelection, SelectionActionPayload } from "@/components/selection-actions";
import { NoteMetadata } from "@/lib/types";
import { toast } from "sonner";

interface TranscriptViewerProps {
  transcript: TranscriptSegment[];
  selectedTopic: Topic | null;
  onTimestampClick: (seconds: number, endSeconds?: number, isCitation?: boolean, citationText?: string, isWithinHighlightReel?: boolean, isWithinCitationHighlight?: boolean) => void;
  currentTime?: number;
  topics?: Topic[];
  citationHighlight?: Citation | null;
  onTakeNoteFromSelection?: (payload: SelectionActionPayload) => void;
  videoId?: string;
  youtubeId?: string;
  cachedTranslations?: Record<string, TranscriptSegment[]>;
  onTranslationUpdate?: (translations: Record<string, TranscriptSegment[]>) => void;
  onLanguageChange?: (language: string) => void;
}

export function TranscriptViewer({
  transcript,
  selectedTopic,
  onTimestampClick,
  currentTime = 0,
  topics = [],
  citationHighlight,
  onTakeNoteFromSelection,
  videoId,
  youtubeId,
  cachedTranslations = {},
  onTranslationUpdate,
  onLanguageChange
}: TranscriptViewerProps) {
  const highlightedRefs = useRef<(HTMLDivElement | null)[]>([]);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const scrollViewportRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const currentSegmentRef = useRef<HTMLDivElement | null>(null);
  const [showScrollToCurrentButton, setShowScrollToCurrentButton] = useState(false);
  const lastUserScrollTime = useRef<number>(0);
  const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const selectedTopicIndex = selectedTopic
    ? topics.findIndex((topic) => topic.id === selectedTopic.id)
    : -1;
  const selectedTopicColor =
    selectedTopicIndex >= 0 ? getTopicHSLColor(selectedTopicIndex, videoId) : null;
  
  const [currentLanguage, setCurrentLanguage] = useState<TranscriptLanguage>('en');
  const [translationCache, setTranslationCache] = useState<TranslationCache>(() => ({
    en: transcript,
    ...cachedTranslations
  }));
  const translationCacheRef = useRef(translationCache);
  const [isTranslating, setIsTranslating] = useState(false);
  
  const displayedTranscript = translationCache[currentLanguage] || transcript;
  
  useEffect(() => {
    translationCacheRef.current = translationCache;
  }, [translationCache]);

  useEffect(() => {
    console.log('[TranscriptViewer] Loading cached translations:', cachedTranslations);
    setTranslationCache({ 
      en: transcript,
      ...cachedTranslations 
    });
    setCurrentLanguage('en');
  }, [transcript, cachedTranslations]);

  const handleLanguageToggle = useCallback(async () => {
    const targetLang: TranscriptLanguage = currentLanguage === 'en' ? 'id' : 'en';
    const cache = translationCacheRef.current;
    
    console.log('[TranscriptViewer] Toggle to:', targetLang);
    console.log('[TranscriptViewer] Translation cache keys:', Object.keys(cache));
    console.log('[TranscriptViewer] Has target lang in cache:', !!cache[targetLang]);
    
    if (cache[targetLang]) {
      console.log('[TranscriptViewer] Using existing translation');
      setCurrentLanguage(targetLang);
      if (onLanguageChange) {
        onLanguageChange(targetLang);
      }
      return;
    }

    console.log('[TranscriptViewer] Cache miss, fetching translation from API');
    setIsTranslating(true);
    
    try {
      const response = await fetch('/api/translate-transcript', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          segments: transcript,
          targetLanguage: targetLang,
        }),
      });

      if (!response.ok) {
        throw new Error('Translation failed');
      }

      const data = await response.json();
      
      const updatedCache = {
        ...cache,
        [targetLang]: data.segments,
      };
      
      setTranslationCache(updatedCache);
      setCurrentLanguage(targetLang);
      
      if (onLanguageChange) {
        onLanguageChange(targetLang);
      }
      
      if (onTranslationUpdate) {
        onTranslationUpdate(updatedCache);
      }
      
      if (youtubeId) {
        fetch('/api/update-video-analysis', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            videoId: youtubeId,
            translatedTranscripts: updatedCache,
          }),
        }).catch(err => {
          console.error('Failed to save translation to database:', err);
        });
      }
      
      toast.success(targetLang === 'id' ? 'Diterjemahkan ke Bahasa Indonesia' : 'Translated to English');
    } catch (error) {
      console.error('Translation error:', error);
      toast.error('Gagal menerjemahkan transkrip');
    } finally {
      setIsTranslating(false);
    }
  }, [currentLanguage, transcript, youtubeId, onTranslationUpdate, onLanguageChange]);

  // Clear refs when topic changes
  useEffect(() => {
    highlightedRefs.current = [];
    
    // Debug: Verify segment indices match content
    if (selectedTopic && selectedTopic.segments.length > 0 && transcript.length > 0) {
      
      const firstSeg = selectedTopic.segments[0];
      if (firstSeg.startSegmentIdx !== undefined && firstSeg.endSegmentIdx !== undefined) {
        // Segment indices are already correct, no need to verify
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
    
    // Position the element in the top 1/3 of the viewport
    const scrollPosition = relativeTop - (viewportRect.height / 3);
    
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
        
        // Check if element is outside the top 1/3 area (25% to 40% of viewport)
        const topThreshold = viewportRect.top + viewportRect.height * 0.25;
        const bottomThreshold = viewportRect.top + viewportRect.height * 0.40;
        
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


  const getHighlightedText = (segment: TranscriptSegment, segmentIndex: number): { highlightedParts: Array<{ text: string; highlighted: boolean; isCitation?: boolean }> } | null => {
    // Determine what segments to highlight based on citation or topic
    const segmentsToHighlight = citationHighlight 
      ? [citationHighlight]
      : selectedTopic?.segments || [];
    
    if (segmentsToHighlight.length === 0) return null;
    
    const isCitation = !!citationHighlight;
    
    // Check each segment to see if this transcript segment should be highlighted
    for (const highlightSeg of segmentsToHighlight) {
      // Use segment indices with character offsets for precise matching
      if (highlightSeg.startSegmentIdx !== undefined && highlightSeg.endSegmentIdx !== undefined) {
        
        // Skip this debug logging - removed for cleaner output
        
        // Skip segments that are before the start or after the end
        if (segmentIndex < highlightSeg.startSegmentIdx || segmentIndex > highlightSeg.endSegmentIdx) {
          continue;
        }
        
        // Case 1: This segment is between start and end (not at boundaries)
        if (segmentIndex > highlightSeg.startSegmentIdx && segmentIndex < highlightSeg.endSegmentIdx) {
          return { 
            highlightedParts: [{ text: segment.text, highlighted: true, isCitation }] 
          };
        }
        
        // Case 2: This is the start segment - may need partial highlighting
        if (segmentIndex === highlightSeg.startSegmentIdx) {
          if (highlightSeg.startCharOffset !== undefined && highlightSeg.startCharOffset > 0) {
            // Partial highlight from character offset to end
            const beforeHighlight = segment.text.substring(0, highlightSeg.startCharOffset);
            const highlighted = segment.text.substring(highlightSeg.startCharOffset);
            
            // If this is also the end segment, apply end offset
            if (segmentIndex === highlightSeg.endSegmentIdx && highlightSeg.endCharOffset !== undefined) {
              const actualHighlighted = segment.text.substring(
                highlightSeg.startCharOffset, 
                Math.min(highlightSeg.endCharOffset, segment.text.length)
              );
              const afterHighlight = segment.text.substring(Math.min(highlightSeg.endCharOffset, segment.text.length));
              
              const parts: Array<{ text: string; highlighted: boolean; isCitation?: boolean }> = [];
              if (beforeHighlight) parts.push({ text: beforeHighlight, highlighted: false });
              if (actualHighlighted) parts.push({ text: actualHighlighted, highlighted: true, isCitation });
              if (afterHighlight) parts.push({ text: afterHighlight, highlighted: false });
              return { highlightedParts: parts };
            }
            
            const parts: Array<{ text: string; highlighted: boolean; isCitation?: boolean }> = [];
            if (beforeHighlight) parts.push({ text: beforeHighlight, highlighted: false });
            if (highlighted) parts.push({ text: highlighted, highlighted: true, isCitation });
            return { highlightedParts: parts };
          } else {
            // No offset or offset is 0, highlight from beginning
            if (segmentIndex === highlightSeg.endSegmentIdx && highlightSeg.endCharOffset !== undefined) {
              // This is both start and end segment
              const highlighted = segment.text.substring(0, highlightSeg.endCharOffset);
              const afterHighlight = segment.text.substring(highlightSeg.endCharOffset);
              
              const parts: Array<{ text: string; highlighted: boolean; isCitation?: boolean }> = [];
              if (highlighted) parts.push({ text: highlighted, highlighted: true, isCitation });
              if (afterHighlight) parts.push({ text: afterHighlight, highlighted: false });
              return { highlightedParts: parts };
            }
            // Highlight entire segment
            return { 
              highlightedParts: [{ text: segment.text, highlighted: true, isCitation }] 
            };
          }
        }
        
        // Case 3: This is the end segment (only if different from start) - may need partial highlighting
        if (segmentIndex === highlightSeg.endSegmentIdx && segmentIndex !== highlightSeg.startSegmentIdx) {
          if (highlightSeg.endCharOffset !== undefined && highlightSeg.endCharOffset < segment.text.length) {
            // Partial highlight from beginning to character offset
            const highlighted = segment.text.substring(0, highlightSeg.endCharOffset);
            const afterHighlight = segment.text.substring(highlightSeg.endCharOffset);
            
            const parts: Array<{ text: string; highlighted: boolean; isCitation?: boolean }> = [];
            if (highlighted) parts.push({ text: highlighted, highlighted: true, isCitation });
            if (afterHighlight) parts.push({ text: afterHighlight, highlighted: false });
            return { highlightedParts: parts };
          } else {
            // No offset or offset covers entire segment
            return { 
              highlightedParts: [{ text: segment.text, highlighted: true, isCitation }] 
            };
          }
        }
      }
    }
    
    // Only use time-based highlighting if NO segments have index information
    const hasAnySegmentIndices = segmentsToHighlight.some(seg => 
      seg.startSegmentIdx !== undefined && seg.endSegmentIdx !== undefined
    );
    
    if (!hasAnySegmentIndices) {
      // Fallback to time-based highlighting only if segment indices aren't available at all
      const segmentEnd = segment.start + segment.duration;
      const shouldHighlight = segmentsToHighlight.some(highlightSeg => {
        const overlapStart = Math.max(segment.start, highlightSeg.start);
        const overlapEnd = Math.min(segmentEnd, highlightSeg.end);
        const overlapDuration = Math.max(0, overlapEnd - overlapStart);
        const overlapRatio = overlapDuration / segment.duration;
        // Highlight if there's significant overlap (more than 50% of the segment)
        return overlapRatio > 0.5;
      });
      
      if (shouldHighlight) {
        return { 
          highlightedParts: [{ text: segment.text, highlighted: true, isCitation }] 
        };
      }
    }
    
    return null;
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


  return (
    <TooltipProvider delayDuration={300}>
      <div className="h-full max-h-full flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-5 py-1.5 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 shadow-[0_4px_6px_-1px_rgba(0,0,0,0.03)]">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              {selectedTopic && !selectedTopic.isCitationReel && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div
                      className="h-2.5 w-2.5 rounded-full cursor-help"
                      style={{
                        backgroundColor: selectedTopicColor
                          ? `hsl(${selectedTopicColor})`
                          : undefined,
                      }}
                    />
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="max-w-[180px]">
                    <p className="text-[11px]">{selectedTopic.title}</p>
                  </TooltipContent>
                </Tooltip>
              )}
              {(citationHighlight || selectedTopic?.isCitationReel) && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div
                      className="h-2.5 w-2.5 rounded-full cursor-help"
                      style={{
                        backgroundColor: 'hsl(48, 100%, 50%)',
                      }}
                    />
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    <p className="text-[11px]">
                      {selectedTopic?.isCitationReel ? 'Cited Clips' : 'AI Chat Citation'}
                    </p>
                  </TooltipContent>
                </Tooltip>
              )}
            </div>

            <div className="flex items-center gap-2">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleLanguageToggle}
                    disabled={isTranslating}
                    className="text-[11px] h-6 shadow-none min-w-[48px]"
                  >
                    {isTranslating ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <>
                        <Languages className="w-2.5 h-2.5 mr-1" />
                        {currentLanguage.toUpperCase()}
                      </>
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  <p className="text-[11px]">
                    {currentLanguage === 'en' ? 'Translate to Indonesian' : 'Translate to English'}
                  </p>
                </TooltipContent>
              </Tooltip>

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
                className="text-[11px] h-6 shadow-none"
              >
                {autoScroll ? (
                  <>
                    <Eye className="w-2.5 h-2.5 mr-1" />
                    Auto
                  </>
                ) : (
                  <>
                    <EyeOff className="w-2.5 h-2.5 mr-1" />
                    Manual
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>

      {/* Jump to current button with improved positioning */}
      {showScrollToCurrentButton && currentTime > 0 && (
        <div className="absolute top-14 left-1/2 -translate-x-1/2 z-10 animate-in fade-in slide-in-from-top-2 duration-300">
          <Button
            size="sm"
            onClick={jumpToCurrent}
            className="shadow-lg bg-primary/95 hover:bg-primary text-[11px]"
          >
            <ChevronDown className="w-3.5 h-3.5 mr-1 animate-bounce" />
            Jump to Current
          </Button>
        </div>
      )}

      {/* Transcript content */}
      <ScrollArea className="flex-1 min-h-0" ref={scrollAreaRef}>
        <div
          className="p-6 space-y-1" 
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
          <SelectionActions
            containerRef={scrollViewportRef}
            onExplain={(payload) => {
              triggerExplainSelection({
                ...payload,
                source: 'transcript'
              });
            }}
            onTakeNote={(payload) => {
              onTakeNoteFromSelection?.({
                ...payload,
                source: 'transcript'
              });
            }}
            getMetadata={(range) => {
              const metadata: NoteMetadata = {};
              const startNode = range.startContainer.parentElement;
              const segmentElement = startNode?.closest('[data-segment-index]') as HTMLElement | null;
              if (segmentElement) {
                const segmentIndex = segmentElement.dataset.segmentIndex;
                if (segmentIndex) {
                  const index = parseInt(segmentIndex, 10);
                  const segment = transcript[index];
                  if (segment) {
                    metadata.transcript = {
                      start: segment.start,
                      end: segment.start + segment.duration,
                      segmentIndex: index,
                      topicId: selectedTopic?.id
                    };
                    metadata.timestampLabel = `${formatDuration(segment.start)} - ${formatDuration(segment.start + segment.duration)}`;
                  }
                }
              }
              if (selectedTopic?.title) {
                metadata.selectionContext = selectedTopic.title;
              }
              return metadata;
            }}
            source="transcript"
          />
          {transcript.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">
              No transcript available
            </div>
           ) : (
            (() => {
              // Calculate current segment index once for all segments
              const currentSegmentIndex = getCurrentSegmentIndex();
              
              return displayedTranscript.map((segment, index) => {
                const highlightedText = getHighlightedText(segment, index);
                const isCurrent = index === currentSegmentIndex;
                getSegmentTopic(segment);
                
                const hasHighlight = highlightedText !== null;

            return (
                  <div
                    key={index}
                    data-segment-index={index}
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
                    onClick={() => {
                      lastUserScrollTime.current = Date.now() + 1000;
                      onTimestampClick(segment.start, segment.start + segment.duration);
                    }}
                    className={cn(
                      "group relative px-2.5 py-1.5 rounded-xl transition-all duration-200 cursor-pointer hover:bg-accent/50"
                    )}
                  >
                    {/* Transcript text with partial highlighting */}
                    <p 
                      className={cn(
                        "text-sm leading-relaxed",
                        isCurrent ? "text-foreground font-medium" : "text-muted-foreground"
                      )}
                    >
                      {highlightedText ? (
                        highlightedText.highlightedParts.map((part, partIndex) => {
                          const isCitation = 'isCitation' in part && part.isCitation;
                          
                          return (
                            <span
                              key={partIndex}
                              className={part.highlighted ? "text-foreground" : ""}
                              style={
                                part.highlighted
                                  ? isCitation || selectedTopic?.isCitationReel
                                  ? {
                                      backgroundColor: 'hsl(48, 100%, 85%)',
                                      padding: '1px 3px',
                                      borderRadius: '3px',
                                      boxShadow: '0 0 0 1px hsl(48, 100%, 50%, 0.3)',
                                    }
                                    : selectedTopicColor
                                    ? {
                                        backgroundColor: `hsl(${selectedTopicColor} / 0.2)`,
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
