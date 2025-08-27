"use client";

import { useEffect, useRef } from "react";
import { TranscriptSegment, Topic } from "@/lib/types";
import { formatDuration } from "@/lib/utils";
import { cn } from "@/lib/utils";

interface TranscriptViewerProps {
  transcript: TranscriptSegment[];
  selectedTopic: Topic | null;
  onTimestampClick: (seconds: number) => void;
}

export function TranscriptViewer({
  transcript,
  selectedTopic,
  onTimestampClick,
}: TranscriptViewerProps) {
  const highlightedRefs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    // Clear the refs array when topic changes
    highlightedRefs.current = [];
  }, [selectedTopic]);

  useEffect(() => {
    // Scroll to first highlighted segment after refs are set
    if (selectedTopic && highlightedRefs.current[0]) {
      // Small delay to ensure refs are properly set
      setTimeout(() => {
        highlightedRefs.current[0]?.scrollIntoView({
          behavior: "smooth",
          block: "center",
        });
      }, 100);
    }
  }, [selectedTopic]);

  const isSegmentHighlighted = (segment: TranscriptSegment): boolean => {
    if (!selectedTopic) return false;
    
    return selectedTopic.segments.some(
      (topicSeg) =>
        segment.start >= topicSeg.start && segment.start < topicSeg.end
    );
  };

  return (
    <div className="h-full overflow-y-auto p-4 bg-gray-50 rounded-lg">
      <div className="space-y-2">
        {transcript.map((segment, index) => {
          const isHighlighted = isSegmentHighlighted(segment);
          
          return (
            <div
              key={index}
              ref={(el) => {
                if (isHighlighted) {
                  const highlightIndex = highlightedRefs.current.length;
                  highlightedRefs.current[highlightIndex] = el;
                }
              }}
              className={cn(
                "flex gap-3 p-2 rounded transition-all",
                isHighlighted && "bg-yellow-100 border-l-4 border-yellow-400"
              )}
            >
              <button
                onClick={() => onTimestampClick(segment.start)}
                className="text-blue-600 hover:text-blue-800 font-mono text-sm shrink-0"
              >
                {formatDuration(segment.start)}
              </button>
              <p className="text-gray-700 leading-relaxed">
                {segment.text}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}