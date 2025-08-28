"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { TranscriptSegment, Topic } from "@/lib/types";
import { getTopicHSLColor } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Play, Eye, EyeOff } from "lucide-react";
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
  const [autoScroll, setAutoScroll] = useState(true);
  const [hoveredSegment, setHoveredSegment] = useState<number | null>(null);
  const currentSegmentRef = useRef<HTMLDivElement | null>(null);

  // Clear refs when topic changes
  useEffect(() => {
    highlightedRefs.current = [];
  }, [selectedTopic]);

  // Scroll to first highlighted segment
  useEffect(() => {
    if (selectedTopic && highlightedRefs.current[0] && autoScroll) {
      setTimeout(() => {
        highlightedRefs.current[0]?.scrollIntoView({
          behavior: "smooth",
          block: "center",
        });
      }, 100);
    }
  }, [selectedTopic, autoScroll]);

  // Auto-scroll to current playing segment
  useEffect(() => {
    if (autoScroll && currentTime && currentSegmentRef.current) {
      const scrollTimeout = setTimeout(() => {
        currentSegmentRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "center",
        });
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

  return (
    <div className="h-full flex flex-col rounded-lg border bg-card">
      {/* Controls */}
      <div className="p-3 border-b flex items-center justify-between bg-muted/50">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-xs">
            {transcript.length} segments
          </Badge>
          {selectedTopic && (
            <Badge 
              className="text-xs"
              style={{
                backgroundColor: `hsl(${getTopicHSLColor(topics.indexOf(selectedTopic))} / 0.2)`,
                color: `hsl(${getTopicHSLColor(topics.indexOf(selectedTopic))})`,
                borderColor: `hsl(${getTopicHSLColor(topics.indexOf(selectedTopic))})`,
              }}
            >
              Highlighting: {selectedTopic.title}
            </Badge>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setAutoScroll(!autoScroll)}
          className="text-xs"
        >
          {autoScroll ? (
            <>
              <Eye className="w-3 h-3 mr-1" />
              Auto-follow
            </>
          ) : (
            <>
              <EyeOff className="w-3 h-3 mr-1" />
              Manual
            </>
          )}
        </Button>
      </div>

      {/* Transcript content */}
      <ScrollArea className="flex-1" ref={scrollAreaRef}>
        <div className="p-4 space-y-1">
          {transcript.map((segment, index) => {
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
                onMouseEnter={() => setHoveredSegment(index)}
                onMouseLeave={() => setHoveredSegment(null)}
              >
                {/* Play indicator on hover */}
                {isHovered && (
                  <div className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-full pr-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Play className="w-4 h-4 text-primary" />
                  </div>
                )}

                {/* Topic badge */}
                {topicInfo && (
                  <Badge
                    variant="outline"
                    className="absolute right-2 top-2 text-xs opacity-70"
                    style={{
                      backgroundColor: `hsl(${getTopicHSLColor(topicInfo.index)} / 0.1)`,
                      borderColor: `hsl(${getTopicHSLColor(topicInfo.index)})`,
                      color: `hsl(${getTopicHSLColor(topicInfo.index)})`,
                    }}
                  >
                    {topicInfo.topic.title}
                  </Badge>
                )}

                {/* Transcript text */}
                <p 
                  className={cn(
                    "text-sm leading-relaxed pr-24",
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
          })}
        </div>
      </ScrollArea>
    </div>
  );
}